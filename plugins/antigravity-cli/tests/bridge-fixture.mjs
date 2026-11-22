import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { experimental_providerBridge as bridge } from '../host.ts';

const enabled = process.argv[2] === 'true';
const originalWrite = process.stdout.write.bind(process.stdout);
const messages = [];
let pending = '';
process.stdout.write = chunk => {
  pending += String(chunk);
  let end;
  while ((end = pending.indexOf('\n')) >= 0) {
    messages.push(JSON.parse(pending.slice(0, end)));
    pending = pending.slice(end + 1);
  }
  return true;
};
const send = (id, method, params) => bridge.handleLine(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
const wait = async predicate => {
  const end = Date.now() + 8000;
  while (Date.now() < end) {
    const match = messages.find(predicate);
    if (match) return match;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out: ' + JSON.stringify(messages));
};
const options = { permissionMode: 'accept-edits', permissionScope: 'workspace', approvalReviewer: 'user', permissionEscalation: 'ask', providerOptions: { autoApprove: enabled, acpLaunchSpec: { displayName: 'Fake', command: process.execPath, args: [fileURLToPath(new URL('./fake-acp.mjs', import.meta.url))], env: {} } } };
try {
  send(1, 'initialize', { protocolVersion: 1, client: { name: 'test', version: '1' } });
  assert.ok((await wait(m => m.id === 1)).result);
  send(2, 'thread/start', { threadId: 'thread', cwd: process.cwd(), instructionMode: 'append', options });
  const started = await wait(m => m.id === 2);
  assert.ok(started.result?.providerThreadId, JSON.stringify(started));
  send(3, 'turn/start', { threadId: 'thread', providerThreadId: started.result.providerThreadId, clientRequestId: 'creq_23456789ab', input: [{ type: 'text', text: 'test' }], options });
  if (!enabled) {
    const interaction = await wait(m => m.method === 'interaction/request');
    bridge.handleLine(JSON.stringify({ jsonrpc: '2.0', id: interaction.id, result: { decision: 'allow_once', grantedPermissions: null } }));
  }
  await wait(m => JSON.stringify(m).includes('optionId'));
  assert.equal(messages.some(m => m.method === 'interaction/request'), !enabled);
  assert.match(JSON.stringify(messages), /yes/);
  assert.match(JSON.stringify(messages), /"type":"backgroundTask"/);
  assert.match(JSON.stringify(messages), /"familyId":"fake-session\/task-1"/);
  assert.match(JSON.stringify(messages), /"Outside of sandbox"/);

  if (enabled) {
    const subagentOptions = {
      ...options,
      providerOptions: { ...options.providerOptions, subagentsDisabled: true },
    };
    send(4, 'turn/start', {
      threadId: 'thread',
      providerThreadId: started.result.providerThreadId,
      clientRequestId: 'creq_3456789abc',
      input: [{ type: 'text', text: 'subagent-test' }],
      options: subagentOptions,
    });
    await wait(m => JSON.stringify(m).includes('\\"optionId\\":\\"no\\"'));
  }

  bridge.onClose?.();
  originalWrite('verified\n');
} catch (error) {
  process.stderr.write(String(error.stack || error) + '\n');
  bridge.onClose?.();
  process.exitCode = 1;
}
