import test from 'node:test';
import assert from 'node:assert/strict';
import { rememberApprovalSetting, interceptApproval } from '../host.ts';
import { rememberSubagentSetting } from '../subagents.ts';

const options = (autoApprove, permissionEscalation = 'ask', extraProviderOptions = {}) => ({
  permissionMode: 'accept-edits', permissionScope: 'workspace', approvalReviewer: 'user', permissionEscalation,
  providerOptions: { autoApprove, ...extraProviderOptions },
});
function start(threadId, enabled, escalation, extraProviderOptions = {}) {
  const req = { method: 'thread/start', params: { threadId, cwd: process.cwd(), instructionMode: 'append', options: options(enabled, escalation, extraProviderOptions) } };
  rememberSubagentSetting(JSON.stringify(req), req);
  rememberApprovalSetting(req);
}
function request(threadId, payload, id = 1) {
  return JSON.stringify({ jsonrpc: '2.0', id, method: 'interaction/request', params: { threadId, payload } });
}
function approval(kind, decisions = ['allow_once', 'deny'], toolName = 'tool') {
  const extra = kind === 'command' ? { command: 'test', cwd: null, actions: [], sessionGrant: null }
    : kind === 'file_change' ? { writeScope: null, sessionGrant: null }
    : { tool: toolName, presentation: { icon: { glyph: 'terminal' }, label: { pending: 'Pending', completed: 'Done' } } };
  return { kind: 'approval', subject: { kind, itemId: 'tool', ...extra }, reason: null, availableDecisions: decisions };
}

test('approval is opt-in, isolated by thread and honors denied escalation', () => {
  start('enabled', true);
  start('disabled', false);
  start('denied', true, 'deny');
  for (const kind of ['command', 'file_change', 'tool_use']) {
    assert.equal(interceptApproval(request('enabled', approval(kind))), true);
    assert.equal(interceptApproval(request('disabled', approval(kind))), false);
    assert.equal(interceptApproval(request('denied', approval(kind))), false);
  }
  assert.equal(interceptApproval(request('enabled', approval('tool_use', ['allow_for_session']))), true);
  assert.equal(interceptApproval(request('enabled', approval('tool_use', ['deny']))), false);
  assert.equal(interceptApproval(request('enabled', approval('permission_grant'))), false);
  assert.equal(interceptApproval(request('enabled', { kind: 'user_question' })), false);
  assert.equal(interceptApproval(request('enabled', { kind: 'approval' })), false);
  assert.equal(interceptApproval('invalid'), false);
  rememberApprovalSetting({ method: 'turn/start', params: { threadId: 'enabled', providerThreadId: 'session', clientRequestId: 'creq_23456789ab', input: [], options: options(false) } });
  assert.equal(interceptApproval(request('enabled', approval('tool_use'))), false);

  // When subagentsDisabled is true and autoApprove is true:
  // - If 'deny' is available, interceptApproval intercepts to deny (returns true).
  // - If 'deny' is NOT available (only 'allow_once'), interceptApproval MUST NOT auto-approve (returns false).
  start('no-subagents', true, 'ask', { subagentsDisabled: true });
  assert.equal(interceptApproval(request('no-subagents', approval('tool_use', ['allow_once'], 'invoke_subagent'))), false);
  assert.equal(interceptApproval(request('no-subagents', approval('tool_use', ['allow_once'], 'regular_tool'))), true);
});

