import { createInterface } from 'node:readline';
const send = message => process.stdout.write(JSON.stringify(message) + '\n');
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
let promptId;
createInterface({ input: process.stdin }).on('line', line => {
  const m = JSON.parse(line);
  if (m.method === 'initialize') reply(m.id, { protocolVersion: 1, agentCapabilities: { loadSession: true }, agentInfo: { name: 'fake', version: '1' } });
  if (m.method === 'session/new') reply(m.id, { sessionId: 'fake-session' });
  if (m.method === 'session/prompt') {
    promptId = m.id;
    const promptText = Array.isArray(m.params?.prompt) ? m.params.prompt.map(p => p.text || '').join('\n') : '';
    if (promptText.includes('subagent-test')) {
      send({
        jsonrpc: '2.0',
        id: 200,
        method: 'session/request_permission',
        params: {
          sessionId: 'fake-session',
          toolCall: { toolCallId: 'sub-tool', title: 'invoke_subagent', kind: 'other', rawInput: { TypeName: 'research', Role: 'Researcher', Prompt: 'hi' } },
          options: [{ optionId: 'yes', name: 'Allow', kind: 'allow_once' }, { optionId: 'no', name: 'Deny', kind: 'reject_once' }],
        },
      });
      return;
    }
    send({ jsonrpc: '2.0', id: 100, method: 'session/request_permission', params: { sessionId: 'fake-session', toolCall: { toolCallId: 'tool', title: 'Run command', kind: 'execute' }, options: [{ optionId: 'yes', name: 'Allow', kind: 'allow_once' }, { optionId: 'no', name: 'Deny', kind: 'reject_once' }] } });
  }
  if ((m.id === 100 || m.id === 200) && m.result) {
    if (m.id === 100) {
      send({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: 'fake-session',
          update: {
            sessionUpdate: 'tool_call',
            toolCallId: 'bg-call-1',
            title: 'run_command',
            kind: 'execute',
            status: 'in_progress',
            rawInput: { CommandLine: 'bun run release:prod:check', toolSummary: 'Dry-run release check', BypassSandbox: true },
          },
        },
      });
      send({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: 'fake-session',
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'bg-call-1',
            status: 'completed',
            content: [{ type: 'content', content: { type: 'text', text: 'Tool is running as a background task with task id: fake-session/task-1\nTask Description: Dry-run release check\n' } }],
          },
        },
      });
    }
    send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'fake-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: JSON.stringify(m.result) } } } });
    reply(promptId, { stopReason: 'end_turn' });
  }
});
