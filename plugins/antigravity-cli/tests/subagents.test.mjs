import test from 'node:test';
import assert from 'node:assert/strict';
import { ANTIGRAVITY_SUBAGENT_TOOLS, BB_SUBAGENT_DELEGATION_INSTRUCTIONS as instructions, isNativeSubagentTool, resolveProviderSubagentsEnabled, mergeSubagentInstructions, createSubagentController } from '../subagents.ts';

const request = (method, threadId, options = {}) => JSON.stringify({ jsonrpc: '2.0', method, params: { threadId, options } });
const approval = (threadId, subject = { kind: 'tool_use', tool: 'invoke_subagent' }, decisions = ['allow_once', 'deny']) => ({ jsonrpc: '2.0', id: 7, method: 'interaction/request', params: { threadId, payload: { kind: 'approval', subject, availableDecisions: decisions } } });

test('recognizes only native names and known presentation titles', () => {
  for (const name of [...ANTIGRAVITY_SUBAGENT_TOOLS, 'Invoke subagent', 'Running subagent', 'Subagent launched', 'Define subagent', 'Defining subagent', 'Manage subagents', 'Listing subagents', 'Stopping subagents', 'Send message', 'Messaging subagent']) assert.equal(isNativeSubagentTool(`  ${name.toUpperCase()}  `), true);
  for (const name of [null, {}, 'send_message_extra', 'other subagent', '']) assert.equal(isNativeSubagentTool(name), false);
});

test('resolves settings with disabled taking precedence and merges instructions idempotently', () => {
  assert.equal(resolveProviderSubagentsEnabled(undefined), true);
  assert.equal(resolveProviderSubagentsEnabled({}, false), false);
  assert.equal(resolveProviderSubagentsEnabled({ subagentsDisabled: true, providerSubagentsEnabled: true }), false);
  assert.equal(resolveProviderSubagentsEnabled({ providerSubagentsEnabled: false, subagentsDisabled: false }), false);
  assert.equal(resolveProviderSubagentsEnabled({ subagentsDisabled: false }, false), true);
  assert.equal(resolveProviderSubagentsEnabled({ providerSubagentsEnabled: true }, false), true);
  assert.equal(mergeSubagentInstructions(null, true), undefined);
  assert.equal(mergeSubagentInstructions('', true), '');
  assert.equal(mergeSubagentInstructions('', false), instructions);
  assert.equal(mergeSubagentInstructions('hello', false), `hello\n\n${instructions}`);
  assert.equal(mergeSubagentInstructions(`hello\n\n${instructions}`, false), `hello\n\n${instructions}`);
});

test('tracks and transforms partial requests independently, including cleanup', () => {
  const c = createSubagentController();
  const original = request('thread/start', 'a', { instructions: 'hello', providerOptions: { subagentsDisabled: true } });
  const result = c.rememberAndTransformRequest(original);
  assert.equal(result.providerSubagentsEnabled, false);
  assert.equal(result.parsed.params.options.instructions, `hello\n\n${instructions}`);
  assert.equal(JSON.parse(original).params.options.instructions, 'hello');
  assert.equal(c.isSubagentsDisabled('a'), true);
  assert.equal(c.rememberAndTransformRequest(request('turn/start', 'a')).providerSubagentsEnabled, false);
  assert.equal(c.rememberAndTransformRequest(request('turn/start', 'b')).providerSubagentsEnabled, true);
  assert.equal(c.rememberAndTransformRequest(request('turn/start', 'a', { providerOptions: { providerSubagentsEnabled: true } })).providerSubagentsEnabled, true);
  c.rememberAndTransformRequest(request('thread/resume', 'a', { providerOptions: { providerSubagentsEnabled: false } }));
  c.rememberAndTransformRequest(request('thread/stop', 'a'));
  assert.equal(c.isSubagentsDisabled('a'), false);
  c.rememberAndTransformRequest(request('thread/start', 'a', { providerOptions: { subagentsDisabled: true } }));
  c.rememberAndTransformRequest(request('thread/discard', 'a'));
  assert.equal(c.isSubagentsDisabled('a'), false);
  assert.equal(c.rememberAndTransformRequest('not json').line, 'not json');
});

test('denies matching approvals only when disabled and denial is available', () => {
  const replies = [];
  const c = createSubagentController({ replyToBridge: line => replies.push(JSON.parse(line)) });
  c.rememberAndTransformRequest(request('thread/start', 'a', { providerOptions: { subagentsDisabled: true, autoApprove: true } }));
  for (const subject of [{ kind: 'tool_use', tool: 'send_message' }, { kind: 'tool_use', presentation: { title: 'Running subagent' } }, { kind: 'tool_use', presentation: { label: { pending: 'Listing subagents' } } }]) {
    assert.equal(c.interceptSubagentApproval(JSON.stringify(approval('a', subject))), true);
  }
  assert.deepEqual(replies, Array(3).fill({ jsonrpc: '2.0', id: 7, result: { decision: 'deny', grantedPermissions: null } }));
  for (const message of [approval('b'), approval('a', { kind: 'command', tool: 'send_message' }), approval('a', { kind: 'tool_use', tool: 'other' }), approval('a', undefined, ['allow_once']), { ...approval('a'), id: null }, { ...approval('a'), method: 'other' }]) assert.equal(c.isBlockedSubagentApproval(message), false);
  assert.equal(c.interceptSubagentApproval('bad json'), false);
  c.clearThread('a');
  assert.equal(c.interceptSubagentApproval(JSON.stringify(approval('a'))), false);
});

test('recognizes dynamic titles and distinguishes approvals without a deny option', () => {
  const replies = [];
  const c = createSubagentController({ replyToBridge: line => replies.push(JSON.parse(line)) });
  c.rememberAndTransformRequest(request('thread/start', 'a', { providerOptions: { subagentsDisabled: true } }));
  for (const title of ['Define subagent reviewer', 'Message agent_42', 'List subagents', 'Stop subagents', 'Stop subagent', 'Manage subagents']) {
    assert.equal(isNativeSubagentTool(`  ${title.toUpperCase()}  `), true);
    const message = approval('a', { kind: 'tool_use', presentation: { title } });
    assert.equal(c.interceptSubagentApproval(JSON.stringify(message)), true);
    message.params.payload.availableDecisions = ['allow_once'];
    assert.equal(c.isSubagentApprovalForDisabledThread(message), true);
    assert.equal(c.isBlockedSubagentApproval(message), false);
    assert.equal(c.interceptSubagentApproval(JSON.stringify(message)), false);
  }
  assert.equal(replies.length, 6);
  assert.equal(c.isSubagentApprovalForDisabledThread(approval('b', undefined, ['allow_once'])), false);
  const invalid = approval('a');
  invalid.params.payload.availableDecisions = null;
  assert.equal(c.isSubagentApprovalForDisabledThread(invalid), false);
});
