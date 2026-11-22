import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createBackgroundTaskTracker, normalizeFileUri, deriveTranscriptPathFromLogFile, extractToolOutputText } from '../background-tasks.ts';

const command = (id = 'conv/task-1', extra = {}) => ({ toolCallId: `call:${id}`, title: 'run_command', status: 'completed', content: [{ type: 'text', text: `Tool is running as a background task with task id: ${id}\nTask Description: build\n` }], ...extra });
const agent = (id = 'agent-1') => ({ toolCallId: `call:${id}`, title: 'invoke_subagent', status: 'completed', rawInput: { Role: 'Research' }, rawOutput: { conversationId: id } });
const manage = (title, Action, input = {}, text = '') => ({ toolCallId: 'manage', title, status: 'completed', rawInput: { Action, ...input }, content: text });
function tracker(t, options = {}) { const value = createBackgroundTaskTracker({ pollIntervalMs: 0, ...options }); t.after(() => value.dispose()); return value; }

test('file normalization, transcript derivation, and nested output extraction', () => {
  assert.equal(normalizeFileUri(' file:///C:/brain/task.log '), 'C:/brain/task.log');
  assert.equal(normalizeFileUri('file:///tmp/task.log'), '/tmp/task.log');
  assert.equal(normalizeFileUri('/tmp/task.log'), '/tmp/task.log');
  assert.equal(deriveTranscriptPathFromLogFile('C:\\brain\\.system_generated\\tasks\\task-1.log'), 'C:/brain/.system_generated/logs/transcript.jsonl');
  assert.equal(deriveTranscriptPathFromLogFile('/other.log'), null);
  assert.equal(extractToolOutputText({ toolCallId: 'x', content: [{ text: 'one' }, { content: [{ text: 'two' }] }], rawOutput: { output: 'three' } }), 'one\ntwo\nthree');
});
test('command opens with full BB shape and duplicates are ignored', t => {
  const tr = tracker(t);
  const [open] = tr.handleToolEventForThread('thread', command());
  assert.deepEqual(open, {
    kind: 'item.open', attach: 'currentOrLast', key: { providerItemId: 'task:conv/task-1', parentRef: 'call:conv/task-1' },
    item: { type: 'backgroundTask', familyId: 'conv/task-1', taskType: 'local_bash', description: 'build', status: 'pending', taskStatus: 'running', skipTranscript: false, foreground: false },
    presentation: { label: { pending: 'Running background command', completed: 'Background command finished' }, icon: { glyph: 'Terminal' }, title: 'build' },
  });
  assert.deepEqual(tr.handleToolEventForThread('thread', command()), []);
  assert.deepEqual(tr.handleToolEventForThread('thread', command('pending', { status: 'in_progress' })), []);
  const [close] = tr.clearThread('thread', true);
  assert.equal(close.status, 'interrupted'); assert.equal(close.item.taskStatus, 'stopped');
  assert.deepEqual(close.key, open.key); assert.deepEqual(close.presentation, open.presentation);
});
test('description priority and alternate command format', t => {
  const tr = tracker(t);
  for (const [input, expected] of [[{ toolSummary: 'summary', CommandLine: 'cmd' }, 'summary'], [{ toolSummary: ' ', CommandLine: 'cmd' }, 'cmd'], [{ command: 'lower' }, 'lower'], [{ Prompt: 'prompt' }, 'prompt'], [{}, 'id']]) {
    const [open] = tr.handleToolEventForThread('t', command('id', { title: 'schedule', rawInput: input, content: 'Background command ID: id' }));
    assert.equal(open.item.description, expected); tr.clearThread('t');
  }
  const [open] = tr.handleToolEventForThread('t', command('id', { kind: 'run_command', title: 'Custom title', content: 'Background command ID: id\nTask logs are available at: file:///C:/brain/.system_generated/tasks/task-1.log' }));
  assert.equal(open.item.description, 'Custom title'); assert.equal(open.item.outputFile, 'C:/brain/.system_generated/tasks/task-1.log');
});
test('native subagent detection variants and description priorities', t => {
  const tr = tracker(t);
  for (const extra of [{ rawOutput: { conversationId: 'a' } }, { content: '{"conversationId": "a"}' }, { content: 'Subagent spawned with conversationId: a' }]) {
    const [open] = tr.handleToolEventForThread('t', { toolCallId: 'call', title: 'invoke_subagent', status: 'completed', rawInput: { TypeName: 'worker' }, ...extra });
    assert.equal(open.key.providerItemId, 'subagent:a'); assert.equal(open.item.description, 'worker');
    assert.equal(open.item.taskType, 'local_subagent'); assert.equal(open.presentation.icon.glyph, 'Bot'); tr.clearThread('t');
  }
});
test('manage_task status recognizes terminal outcomes and rejects running reports', t => {
  const tr = tracker(t);
  for (const [text, status, taskStatus] of [
    ['Command exited with code 0', 'completed', 'completed'], ['Command exited with code 12', 'failed', 'failed'],
    ['SCHEDULE_FINISHED', 'completed', 'completed'], ['Step was canceled', 'interrupted', 'killed'],
    ['status=ERROR', 'failed', 'failed'], ['status: FAILED', 'failed', 'failed'], ['status=KILLED', 'interrupted', 'killed'],
    ['status=STOPPED', 'completed', 'completed'], ['not running', 'completed', 'completed'], ['not found', 'completed', 'completed'],
    ['unknown task', 'completed', 'completed'], ['finished with result', 'completed', 'completed'],
  ]) {
    tr.handleToolEventForThread('t', command('id'));
    const [close] = tr.handleToolEventForThread('t', manage('manage_task', 'STATUS', { TaskId: 'id' }, text));
    assert.equal(close.status, status, text); assert.equal(close.item.taskStatus, taskStatus);
  }
  tr.handleToolEventForThread('t', command('id'));
  for (const text of ['Step is still running; Command exited with code 0', 'status=RUNNING; status=DONE', 'unrecognized']) assert.deepEqual(tr.handleToolEventForThread('t', manage('manage_task', 'status', { TaskId: 'id' }, text)), []);
  assert.equal(tr.handleToolEventForThread('t', manage('manage_task', 'kill', { TaskId: 'id' }))[0].item.taskStatus, 'killed');
});
test('list reconciliation respects thread and task type', t => {
  const tr = tracker(t);
  for (const thread of ['a', 'b']) { tr.handleToolEventForThread(thread, command('keep')); tr.handleToolEventForThread(thread, command('gone')); tr.handleToolEventForThread(thread, agent()); }
  assert.deepEqual(tr.handleToolEventForThread('a', manage('manage_task', 'list', {}, 'unrecognized')), []);
  const closed = tr.handleToolEventForThread('a', manage('manage_task', 'list', {}, '| Start Time | Task ID | Tool | Description |\nkeep'));
  assert.equal(closed.length, 1); assert.equal(closed[0].item.familyId, 'gone'); assert.equal(tr.getActiveTasks('b').length, 3);
  assert.equal(tr.handleToolEventForThread('a', manage('manage_task', 'list', {}, 'No running tasks')).length, 1);
  assert.equal(tr.getActiveTasks('a')[0].taskType, 'local_subagent');
});
test('subagent management handles selective kill, kill_all, and lists', t => {
  const tr = tracker(t);
  for (const id of ['a', 'b', 'c']) tr.handleToolEventForThread('t', agent(id));
  assert.equal(tr.handleToolEventForThread('t', manage('manage_subagents', 'kill', { ConversationIds: ['a'] }))[0].status, 'interrupted');
  assert.equal(tr.handleToolEventForThread('t', manage('manage_subagents', 'list', {}, 'b idle\nc running'))[0].item.familyId, 'b');
  assert.equal(tr.handleToolEventForThread('t', manage('manage_subagents', 'kill_all'))[0].item.familyId, 'c');
  for (const text of ['No active direct subagents', 'No active subagents', '[]']) {
    tr.handleToolEventForThread('t', agent()); assert.equal(tr.handleToolEventForThread('t', manage('manage_subagents', 'list', {}, text)).length, 1);
  }
});
test('completion announcements settle once and bound each result', t => {
  const tr = tracker(t);
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) tr.handleToolEventForThread('t', command(id));
  tr.handleToolEventForThread('t', agent('native'));
  const results = tr.inspectTextForCompletions('t', 'Task id "a" finished with result: success\nTask id "b" finished with result: Command exited with code 3\nTask id "c" was canceled\nTask id "d" failed\nTask id "e" finished with result: Step was canceled\nTask id "f" finished with result: Encountered error\nSubagent native has gone idle');
  assert.deepEqual(results.map(d => d.status), ['completed', 'failed', 'interrupted', 'failed', 'interrupted', 'failed', 'completed']);
  assert.deepEqual(tr.inspectTextForCompletions('t', 'Task id "a" terminated'), []);
  assert.equal(tr.getActiveTasks('t').length, 0);
});
test('bridge correlation consumes queued events and inspects all text fields', t => {
  const tr = tracker(t);
  tr.recordToolEvent(command('id', { status: 'in_progress' })); tr.recordToolEvent(command('id'));
  const line = JSON.stringify({ jsonrpc: '2.0', method: 'thread/delta', params: { threadId: 't', deltas: [{ key: { providerItemId: 'call:id' } }] } });
  assert.equal(JSON.parse(tr.processStdoutLine(line)[0]).params.deltas.length, 1);
  assert.equal(JSON.parse(tr.processStdoutLine(line)[0]).params.deltas[1].kind, 'item.open');
  assert.equal(JSON.parse(tr.processStdoutLine(line)[0]).params.deltas.length, 1);
  for (const field of ['delta', 'output', 'text']) {
    tr.handleToolEventForThread('t', command('id'));
    const entry = field === 'delta' ? { delta: { text: 'Task id "id" was killed' } } : { item: { [field]: 'Task id "id" was killed' } };
    const result = tr.processStdoutLine(JSON.stringify({ method: 'thread/delta', params: { threadId: 't', deltas: [entry] } }));
    assert.equal(JSON.parse(result[0]).params.deltas.at(-1).status, 'interrupted');
  }
  for (const value of ['not json', 'null', '{}']) assert.deepEqual(tr.processStdoutLine(value), [value]);
});
test('inbound stop/discard and dispose clear tracking; snapshots cannot mutate state', t => {
  const tr = tracker(t);
  for (const method of ['thread/stop', 'thread/discard']) {
    tr.handleToolEventForThread('t', command()); const snapshot = tr.getActiveTasks('t'); snapshot[0].description = 'mutated';
    assert.equal(tr.getActiveTasks('t')[0].description, 'build');
    const [close] = tr.handleInboundRequest({ method, params: { threadId: 't' } });
    assert.equal(close.kind, 'item.close'); assert.equal(close.status, 'interrupted'); assert.equal(close.item.taskStatus, 'stopped');
    assert.equal(tr.getActiveTasks('t').length, 0);
  }
  assert.deepEqual(tr.handleInboundRequest(null), []); tr.dispose(); assert.deepEqual(tr.handleToolEventForThread('t', command()), []);
});
test('polling tails only new complete JSONL records and stops after settlement', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'background-tasks-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const logs = join(dir, '.system_generated', 'logs'); mkdirSync(logs, { recursive: true });
  const path = join(logs, 'transcript.jsonl'); writeFileSync(path, 'Task id "id" was killed\n');
  const received = [];
  const tr = tracker(t, { pollIntervalMs: 10, onAsyncDeltas: (thread, deltas) => received.push({ thread, deltas }) });
  tr.handleToolEventForThread('t', command('id', { content: `Background command ID: id\nTask logs are available at: ${join(dir, '.system_generated', 'tasks', 'task-1.log')}` }));
  await new Promise(r => setTimeout(r, 35)); assert.equal(received.length, 0);
  const record = JSON.stringify({ message: 'Task id "id" finished with result: success' });
  appendFileSync(path, record.slice(0, 20)); await new Promise(r => setTimeout(r, 25)); assert.equal(received.length, 0);
  appendFileSync(path, record.slice(20) + '\n');
  for (let i = 0; i < 50 && !received.length; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(received.length, 1); assert.equal(received[0].thread, 't'); assert.equal(received[0].deltas[0].status, 'completed');
  assert.equal(tr.getActiveTasks('t').length, 0);
  appendFileSync(path, record + '\n'); await new Promise(r => setTimeout(r, 25)); assert.equal(received.length, 1);
});
test('polling handles late transcript creation and cleans up on clear and dispose', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'background-late-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const logs = join(dir, '.system_generated', 'logs'); mkdirSync(logs, { recursive: true });
  const path = join(logs, 'transcript.jsonl');
  const received = [];
  const tr = tracker(t, { pollIntervalMs: 5, onAsyncDeltas: (_, deltas) => received.push(...deltas) });
  const event = id => command(id, { content: `Background command ID: ${id}\nTask logs are available at: ${join(dir, '.system_generated', 'tasks', 'task.log')}` });
  tr.handleToolEventForThread('t', event('late'));
  await new Promise(r => setTimeout(r, 15));
  writeFileSync(path, 'Task id "late" finished with result: success\n');
  for (let i = 0; i < 50 && !received.length; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(received.length, 1);
  tr.handleToolEventForThread('t', event('cleared')); tr.clearThread('t');
  appendFileSync(path, 'Task id "cleared" failed\n');
  tr.handleToolEventForThread('t', event('disposed')); tr.dispose();
  appendFileSync(path, 'Task id "disposed" failed\n');
  await new Promise(r => setTimeout(r, 20)); assert.equal(received.length, 1);
  const disabled = tracker(t, { onAsyncDeltas: () => assert.fail('disabled polling fired') });
  disabled.handleToolEventForThread('t', event('disabled'));
  appendFileSync(path, 'Task id "disabled" failed\n');
  await new Promise(r => setTimeout(r, 20)); assert.equal(disabled.getActiveTasks('t').length, 1);
});
test('structured empty subagent list closes active native agents', t => {
  const tr = tracker(t); tr.handleToolEventForThread('t', agent());
  const event = { ...manage('manage_subagents', 'list'), rawOutput: [] };
  assert.equal(tr.handleToolEventForThread('t', event)[0].status, 'completed');
});

const stdout = (tr, threadId, ...deltas) => JSON.parse(tr.processStdoutLine(JSON.stringify({ method: 'thread/delta', params: { threadId, deltas } }))[0]).params.deltas;
test('short and qualified IDs settle the same task without matching prefixes in lists', t => {
  const tr = tracker(t);
  for (const action of ['status', 'kill']) {
    tr.handleToolEventForThread('t', command('conv/task-1'));
    const [close] = tr.handleToolEventForThread('t', manage('manage_task', action, { TaskId: 'task-1' }, 'Command exited with code 0'));
    assert.equal(close.item.familyId, 'conv/task-1');
    assert.equal(close.status, action === 'kill' ? 'interrupted' : 'completed');
  }
  tr.handleToolEventForThread('t', command('task-1'));
  assert.equal(tr.inspectTextForCompletions('t', 'Task id "conv/task-1" was killed')[0].item.familyId, 'task-1');
  const header = '| Start Time | Task ID | Tool | Description |\n';
  for (const listed of ['task-10', 'conv/task-10']) {
    tr.handleToolEventForThread('t', command('conv/task-1')); tr.handleToolEventForThread('t', command('conv/task-10'));
    const closed = tr.handleToolEventForThread('t', manage('manage_task', 'list', {}, header + `| now | ${listed} | run_command | build |`));
    assert.deepEqual(closed.map(d => d.item.familyId), ['conv/task-1']);
    assert.deepEqual(tr.getActiveTasks('t').map(task => task.taskId), ['conv/task-10']); tr.clearThread('t');
  }
  tr.handleToolEventForThread('t', command('conv/task-1'));
  assert.deepEqual(tr.handleToolEventForThread('t', manage('manage_task', 'list', {}, header + '| now | task-1 | run_command | build |')), []);
  for (const id of ['agent-1', 'agent-10', 'agent.x']) tr.handleToolEventForThread('t', agent(id));
  const closed = tr.handleToolEventForThread('t', manage('manage_subagents', 'list', {}, 'agent-10 idle\nagent-1 running\nagentXx idle'));
  assert.deepEqual(closed.map(d => d.item.familyId), ['agent-10']);
});
test('FIFO correlation keeps reused tool IDs and partial input isolated per thread', t => {
  const tr = tracker(t);
  const key = { providerItemId: 'shared' };
  for (const thread of ['a', 'b']) tr.recordToolEvent({ toolCallId: 'shared', title: 'run_command', status: 'in_progress', rawInput: { toolSummary: thread } });
  for (const thread of ['a', 'b']) assert.equal(stdout(tr, thread, { kind: 'item.open', key }).length, 1);
  for (const thread of ['a', 'b']) tr.recordToolEvent({ toolCallId: 'shared', status: 'completed', content: `Background command ID: ${thread}/task-1` });
  for (const thread of ['a', 'b']) {
    const deltas = stdout(tr, thread, { kind: 'item.close', key });
    assert.equal(deltas.at(-1).item.familyId, `${thread}/task-1`);
    assert.equal(deltas.at(-1).item.description, thread);
  }
  tr.inspectTextForCompletions('a', 'Task id "task-1" was killed');
  assert.equal(tr.getActiveTasks('a').length, 0); assert.equal(tr.getActiveTasks('b').length, 1);
});
test('thread-scoped fallback updates work without hooks and override unscoped events', t => {
  const tr = tracker(t);
  const entry = update => ({ kind: 'item.close', key: { providerItemId: 'shared' }, noTurnFallback: { raw: { params: { update } } } });
  for (const thread of ['a', 'b']) {
    stdout(tr, thread, entry({ toolCallId: 'shared', title: 'run_command', status: 'in_progress', rawInput: { toolSummary: thread } }));
  }
  tr.recordToolEvent(command('wrong', { toolCallId: 'shared' }));
  for (const thread of ['b', 'a']) {
    const deltas = stdout(tr, thread, entry({ toolCallId: 'shared', status: 'completed', content: `Background command ID: ${thread}/task-1` }));
    assert.equal(deltas.at(-1).item.description, thread);
    assert.equal(deltas.at(-1).item.familyId, `${thread}/task-1`);
  }
  tr.clearThread('a');
  assert.equal(stdout(tr, 'a', entry({ toolCallId: 'shared', status: 'completed', content: 'Background command ID: new' })).length, 1);
});
test('stream completion buffers span chunks, remain isolated, and flush at text close or boundary', t => {
  const tr = tracker(t);
  for (const flush of ['item.textClose', 'turn.boundary']) {
    for (const thread of ['a', 'b']) tr.handleToolEventForThread(thread, command('id'));
    for (const text of ['Task i', 'd "id" finished with result:\n', 'Command exited with code ', '1']) {
      assert.equal(stdout(tr, 'a', { kind: 'item.textDelta', text }).length, 1);
      assert.equal(tr.getActiveTasks('a').length, 1);
    }
    assert.equal(stdout(tr, 'b', { kind: flush }).length, 1);
    const deltas = stdout(tr, 'a', { kind: flush });
    assert.equal(deltas.at(-1).status, 'failed'); assert.equal(tr.getActiveTasks('b').length, 1);
    assert.equal(stdout(tr, 'a', { kind: flush }).length, 1);
    tr.clearThread('b');
  }
  tr.handleToolEventForThread('a', command('id'));
  stdout(tr, 'a', { kind: 'item.textDelta', text: 'Task id "id" failed' }); tr.clearThread('a');
  tr.handleToolEventForThread('a', command('id'));
  assert.equal(stdout(tr, 'a', { kind: 'turn.boundary' }).length, 1);
  for (const field of ['resultText', 'aggregatedOutput', 'message']) {
    tr.handleToolEventForThread('a', command(field));
    assert.equal(stdout(tr, 'a', { [field]: `Task id "${field}" failed` }).at(-1).status, 'failed');
  }
});

const statePath = t => { const dir = mkdtempSync(join(tmpdir(), 'background-state-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return join(dir, 'background-tasks.json'); };

test('registration persists a versioned record and settling removes it', t => {
  const path = statePath(t);
  const tr = tracker(t, { persistPath: path });
  const [open] = tr.handleToolEventForThread('thread', command('task-42'));
  const file = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(file.version, 1);
  assert.equal(file.tasks.length, 1);
  const [record] = file.tasks;
  assert.equal(record.threadId, 'thread'); assert.equal(record.taskId, 'task-42'); assert.equal(record.taskType, 'local_bash');
  assert.equal(record.description, 'build'); assert.equal(record.parentToolCallId, open.key.parentRef);
  assert.ok(Number.isFinite(record.startedAt) && Math.abs(record.startedAt - Date.now()) < 60_000);
  tr.handleToolEventForThread('thread', command('task-42')); // duplicate registration does not duplicate the record
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).tasks.length, 1);
  const [close] = tr.inspectTextForCompletions('thread', 'Task id "task-42" finished with result: success');
  assert.equal(close.status, 'completed');
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).tasks.length, 0);
});

test('simulated host restart emits interrupted close deltas on resume and drops the records', t => {
  const path = statePath(t);
  const first = tracker(t, { persistPath: path });
  first.handleToolEventForThread('thread', command('task-7'));
  first.handleToolEventForThread('thread', agent('worker-1'));
  first.handleToolEventForThread('other', command('untouched'));
  first.dispose(); // Host death: in-memory state is lost, the file keeps the records.
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).tasks.length, 3);
  const restarted = tracker(t, { persistPath: path }); // Restarted plugin host.
  const deltas = restarted.handleInboundRequest({ method: 'thread/resume', params: { threadId: 'thread' } });
  assert.equal(deltas.length, 2);
  for (const close of deltas) {
    assert.equal(close.kind, 'item.close'); assert.equal(close.status, 'interrupted'); assert.equal(close.item.taskStatus, 'stopped');
  }
  assert.deepEqual(deltas.map(d => d.key.providerItemId).sort(), ['subagent:worker-1', 'task:task-7']);
  assert.deepEqual(deltas.map(d => d.key.parentRef).sort(), ['call:task-7', 'call:worker-1']);
  // Reconciled records drop, other threads' records survive untouched, and a second resume finds nothing.
  const file = JSON.parse(readFileSync(path, 'utf8'));
  assert.deepEqual(file.tasks.map(r => r.threadId), ['other']);
  assert.deepEqual(restarted.handleInboundRequest({ method: 'thread/resume', params: { threadId: 'thread' } }), []);
  assert.deepEqual(restarted.handleInboundRequest({ method: 'turn/start', params: { threadId: 'thread' } }), []);
  assert.equal(restarted.handleInboundRequest({ method: 'thread/resume', params: { threadId: 'other' } })[0].key.providerItemId, 'task:untouched');
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).tasks.length, 0);
});

test('resume and turn/start leave tasks that are still tracked in memory alone', t => {
  const path = statePath(t);
  const tr = tracker(t, { persistPath: path });
  tr.handleToolEventForThread('t', command('live'));
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).tasks.length, 1);
  assert.deepEqual(tr.handleInboundRequest({ method: 'thread/resume', params: { threadId: 't' } }), []);
  assert.deepEqual(tr.handleInboundRequest({ method: 'turn/start', params: { threadId: 't' } }), []);
  tr.inspectTextForCompletions('t', 'Task id "live" finished with result: done');
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).tasks.length, 0);
  tr.dispose();
  const restarted = tracker(t, { persistPath: path });
  assert.deepEqual(restarted.handleInboundRequest({ method: 'thread/resume', params: { threadId: 't' } }), []);
});

test('corrupt, truncated, or invalid state files degrade to empty state and get repaired', t => {
  const path = statePath(t);
  mkdirSync(dirname(path), { recursive: true });
  for (const corrupt of ['noise{{{', JSON.stringify({ version: 1, tasks: 'nope' }), JSON.stringify({ version: 2, tasks: [] }),
    JSON.stringify({ version: 1, tasks: [{ threadId: 't' }, null, 42] }), '']) {
    writeFileSync(path, corrupt);
    const tr = tracker(t, { persistPath: path }); // must not throw and must treat the file as empty
    assert.deepEqual(tr.handleInboundRequest({ method: 'thread/resume', params: { threadId: 't' } }), []);
    tr.handleToolEventForThread('t', command('ok')); // registration still works and rewrites a valid file
    const file = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(file.version, 1); assert.equal(file.tasks.length, 1); assert.equal(file.tasks[0].taskId, 'ok');
    tr.clearThread('t');
  }
});

test('stale persisted records are garbage-collected on startup and cannot reconcile', t => {
  const path = statePath(t);
  mkdirSync(dirname(path), { recursive: true });
  const record = (threadId, taskId, startedAt) => ({ threadId, taskId, taskType: 'local_bash', description: 'build', parentToolCallId: `call:${taskId}`, startedAt });
  writeFileSync(path, JSON.stringify({ version: 1, tasks: [
    record('stale', 'task-old', Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days, beyond the default max age
    record('fresh', 'task-new', Date.now() - 60_000),
  ] }));
  const tr = tracker(t, { persistPath: path }); // Startup load prunes the stale record already.
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')).tasks.map(r => r.threadId), ['fresh']);
  assert.deepEqual(tr.handleInboundRequest({ method: 'thread/resume', params: { threadId: 'stale' } }), []);
  const [close] = tr.handleInboundRequest({ method: 'thread/resume', params: { threadId: 'fresh' } });
  assert.equal(close.key.providerItemId, 'task:task-new'); assert.equal(close.status, 'interrupted');
});

test('stale-record max age is configurable via taskStateMaxAgeMs', t => {
  const path = statePath(t);
  const tr = tracker(t, { persistPath: path, taskStateMaxAgeMs: 0 }); // Every record is immediately stale.
  tr.handleToolEventForThread('t', command('fleeting'));
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).tasks.length, 1); // Live tasks still persist their record.
  tr.dispose();
  // Expiry must not depend on whether restart crosses a millisecond boundary.
  const state = JSON.parse(readFileSync(path, 'utf8'));
  state.tasks[0].startedAt = Date.now() - 1000;
  writeFileSync(path, JSON.stringify(state));
  const restarted = tracker(t, { persistPath: path, taskStateMaxAgeMs: 0 });
  assert.deepEqual(restarted.handleInboundRequest({ method: 'thread/resume', params: { threadId: 't' } }), []);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).tasks.length, 0);
});

// Silent turn detection: a turn that ends with a failed command with empty output and no
// agent text at all is surfaced with a synthetic agent-visible message (issue #16).
const failedEmptyCommand = (extra = {}) => ({ kind: 'item.close', status: 'failed', key: { providerItemId: 'call:failed-cmd' }, item: { type: 'command', command: 'rebuild', cwd: '' }, exitCode: 1, ...extra });
const boundary = (status = 'completed') => ({ kind: 'turn.boundary', status });
const visibleAgentText = text => ({ kind: 'item.textDelta', key: { channel: 'assistant' }, channel: 'agentMessage', text });
const injectedMessage = deltas => deltas.find(d => d.kind === 'item.textClose');
test('failed empty-output command with no agent text injects a visible message before the boundary', t => {
  const tr = tracker(t);
  const deltas = stdout(tr, 't', failedEmptyCommand(), boundary());
  assert.deepEqual(deltas.map(d => d.kind), ['item.close', 'item.textDelta', 'item.textClose', 'turn.boundary']);
  const open = deltas[1];
  const message = injectedMessage(deltas);
  assert.equal(open.channel, 'agentMessage'); assert.deepEqual(open.key, { channel: 'assistant' });
  assert.equal(open.text, message.text); assert.equal(message.channel, 'agentMessage');
  assert.match(message.text, /ended this turn without a response/);
  assert.match(message.text, /reload|restart/i);
});
test('no injection for turns without empty-output failures or with agent text', t => {
  const tr = tracker(t);
  assert.deepEqual(stdout(tr, 't', boundary()), [boundary()]);
  const noisyFailure = failedEmptyCommand({ aggregatedOutput: 'permission denied', resultText: 'permission denied' });
  assert.deepEqual(stdout(tr, 't', noisyFailure, boundary()), [noisyFailure, boundary()]);
  const completed = { ...failedEmptyCommand(), status: 'completed', exitCode: 0 };
  assert.deepEqual(stdout(tr, 't', completed, boundary()), [completed, boundary()]);
  const textTurn = [failedEmptyCommand(), visibleAgentText('I hit an error'), boundary()];
  assert.deepEqual(stdout(tr, 't', ...textTurn), textTurn);
  // reasoning-only text is not visible agent output, so it is still a silent give-up
  const thinking = { kind: 'item.textDelta', key: { channel: 'thought' }, channel: 'reasoningText', text: 'thinking only' };
  const injected = injectedMessage(stdout(tr, 't', failedEmptyCommand(), thinking, boundary()));
  assert.ok(injected); assert.match(injected.text, /without a response/);
});
test('escalation after consecutive silent turns and reset on healthy turns', t => {
  const tr = tracker(t);
  const first = injectedMessage(stdout(tr, 't', failedEmptyCommand(), boundary()));
  assert.match(first.text, /without a response|reload|restart/i);
  assert.doesNotMatch(first.text, /broken in this session/);
  const second = injectedMessage(stdout(tr, 't', failedEmptyCommand(), boundary()));
  assert.match(second.text, /broken in this session/);
  assert.match(second.text, /restart the thread runtime/i);
  const third = injectedMessage(stdout(tr, 't', failedEmptyCommand(), boundary()));
  assert.match(third.text, /3 consecutive turns/);
  // a turn with a healthy command (no failure) resets the streak
  assert.equal(stdout(tr, 't', boundary()).length, 1);
  const afterReset = injectedMessage(stdout(tr, 't', failedEmptyCommand(), boundary()));
  assert.doesNotMatch(afterReset.text, /broken in this session/);
});
test('interrupted boundaries are never injected and leave the streak intact', t => {
  const tr = tracker(t);
  assert.deepEqual(stdout(tr, 't', failedEmptyCommand(), boundary('interrupted')), [failedEmptyCommand(), boundary('interrupted')]);
  const next = injectedMessage(stdout(tr, 't', failedEmptyCommand(), boundary()));
  assert.doesNotMatch(next.text, /broken in this session/);
});
test('recorded failed run_command events with empty output also count as the silent signature', t => {
  const tr = tracker(t);
  tr.recordToolEvent({ toolCallId: 'call:empty', title: 'run_command', status: 'failed', content: [{ type: 'text', text: '   ' }] });
  assert.equal(stdout(tr, 't', { kind: 'item.close', key: { providerItemId: 'call:empty' } }).length, 1);
  const message = injectedMessage(stdout(tr, 't', boundary()));
  assert.ok(message); assert.match(message.text, /without a response/);
});
test('silent-turn tracking is isolated per thread', t => {
  const tr = tracker(t);
  stdout(tr, 'a', failedEmptyCommand(), boundary());
  const bFirst = injectedMessage(stdout(tr, 'b', failedEmptyCommand(), boundary()));
  assert.doesNotMatch(bFirst.text, /broken in this session/);
  const aSecond = injectedMessage(stdout(tr, 'a', failedEmptyCommand(), boundary()));
  assert.match(aSecond.text, /broken in this session/);
});
