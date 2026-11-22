import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANTIGRAVITY_ACP_DIALECT_ID,
  CANONICAL_ANTIGRAVITY_TOOLS,
  antigravityAcpDialect,
  registerAntigravityAcpDialect,
  inferAntigravityToolName,
  mapAntigravityToolKind,
  toolIdentity,
  parseAntigravityCommandOutput,
  normalizeCommandEvent,
  commandResult,
  classifyToolCall,
  onToolUpdate,
  setToolUpdateListener,
  getCommandDescriptionsEnabled,
  setCommandDescriptionsEnabled,
  applyThreadCommandDescriptions,
} from '../dialect.ts';

test('exports the correct dialect id and registers idempotently', () => {
  assert.equal(ANTIGRAVITY_ACP_DIALECT_ID, 'antigravity');
  assert.equal(antigravityAcpDialect.id, 'antigravity');

  const registered1 = registerAntigravityAcpDialect();
  assert.equal(registered1, antigravityAcpDialect);

  // Calling multiple times should be idempotent and not throw
  const registered2 = registerAntigravityAcpDialect();
  assert.equal(registered2, antigravityAcpDialect);
});

test('canonical tools set contains expected Antigravity tools', () => {
  assert.ok(CANONICAL_ANTIGRAVITY_TOOLS.has('run_command'));
  assert.ok(CANONICAL_ANTIGRAVITY_TOOLS.has('read_file'));
  assert.ok(CANONICAL_ANTIGRAVITY_TOOLS.has('write_file'));
  assert.ok(CANONICAL_ANTIGRAVITY_TOOLS.has('edit_file'));
  assert.ok(CANONICAL_ANTIGRAVITY_TOOLS.has('grep_search'));
  assert.ok(CANONICAL_ANTIGRAVITY_TOOLS.has('search_web'));
  assert.ok(CANONICAL_ANTIGRAVITY_TOOLS.has('invoke_subagent'));
  assert.ok(CANONICAL_ANTIGRAVITY_TOOLS.has('define_subagent'));
  assert.ok(CANONICAL_ANTIGRAVITY_TOOLS.has('manage_subagents'));
  assert.ok(CANONICAL_ANTIGRAVITY_TOOLS.has('send_message'));
  assert.ok(CANONICAL_ANTIGRAVITY_TOOLS.has('manage_task'));
  assert.ok(CANONICAL_ANTIGRAVITY_TOOLS.has('schedule'));
  assert.ok(CANONICAL_ANTIGRAVITY_TOOLS.has('ask_question'));
});

test('infers tool name from _meta, name, and title', () => {
  // From _meta
  assert.equal(
    inferAntigravityToolName({ toolCallId: 't1', sessionUpdate: 'tool_call', _meta: { tool: 'run_command' } }),
    'run_command'
  );
  assert.equal(
    inferAntigravityToolName({ toolCallId: 't2', sessionUpdate: 'tool_call', _meta: { name: 'read_file' } }),
    'read_file'
  );
  assert.equal(
    inferAntigravityToolName({ toolCallId: 't3', sessionUpdate: 'tool_call', _meta: { toolName: 'write_file' } }),
    'write_file'
  );
  assert.equal(
    inferAntigravityToolName({ toolCallId: 't4', sessionUpdate: 'tool_call', _meta: { 'x.ai/tool': { name: 'grep_search' } } }),
    'grep_search'
  );

  // From direct name
  assert.equal(
    inferAntigravityToolName({ toolCallId: 't5', sessionUpdate: 'tool_call', name: 'search_web' }),
    'search_web'
  );
  assert.equal(
    inferAntigravityToolName({ toolCallId: 't6', sessionUpdate: 'tool_call', name: 'Ask Question' }),
    'ask_question'
  );

  // From title
  assert.equal(
    inferAntigravityToolName({ toolCallId: 't7', sessionUpdate: 'tool_call', title: 'run_command' }),
    'run_command'
  );
  assert.equal(
    inferAntigravityToolName({ toolCallId: 't8', sessionUpdate: 'tool_call', title: 'run_command: npm test' }),
    'run_command'
  );
  assert.equal(
    inferAntigravityToolName({ toolCallId: 't9', sessionUpdate: 'tool_call', title: 'read_file: /path/to/file.ts' }),
    'read_file'
  );
  assert.equal(
    inferAntigravityToolName({ toolCallId: 't10', sessionUpdate: 'tool_call', title: 'Define Subagent' }),
    'define_subagent'
  );
});

test('infers tool name from rawInput structural shapes', () => {
  // run_command
  assert.equal(
    inferAntigravityToolName({ toolCallId: 'r1', sessionUpdate: 'tool_call', rawInput: { CommandLine: 'npm test' } }),
    'run_command'
  );
  assert.equal(
    inferAntigravityToolName({ toolCallId: 'r2', sessionUpdate: 'tool_call', rawInput: { command: 'ls -la' } }),
    'run_command'
  );

  // invoke_subagent
  assert.equal(
    inferAntigravityToolName({
      toolCallId: 'r3',
      sessionUpdate: 'tool_call',
      rawInput: { TypeName: 'reviewer', Prompt: 'Check code' },
    }),
    'invoke_subagent'
  );

  // define_subagent
  assert.equal(
    inferAntigravityToolName({
      toolCallId: 'r4',
      sessionUpdate: 'tool_call',
      rawInput: { SystemPrompt: 'sys', Name: 'worker', Description: 'desc' },
    }),
    'define_subagent'
  );

  // manage_subagents
  assert.equal(
    inferAntigravityToolName({
      toolCallId: 'r5',
      sessionUpdate: 'tool_call',
      rawInput: { Action: 'kill_all' },
    }),
    'manage_subagents'
  );
  assert.equal(
    inferAntigravityToolName({
      toolCallId: 'r6',
      sessionUpdate: 'tool_call',
      rawInput: { Action: 'kill', ConversationIds: ['c1', 'c2'] },
    }),
    'manage_subagents'
  );

  // send_message
  assert.equal(
    inferAntigravityToolName({
      toolCallId: 'r7',
      sessionUpdate: 'tool_call',
      rawInput: { Recipient: 'agent_1', Message: 'status update' },
    }),
    'send_message'
  );

  // manage_task
  assert.equal(
    inferAntigravityToolName({
      toolCallId: 'r8',
      sessionUpdate: 'tool_call',
      rawInput: { Action: 'status', TaskId: 'task-1' },
    }),
    'manage_task'
  );
  assert.equal(
    inferAntigravityToolName({
      toolCallId: 'r9',
      sessionUpdate: 'tool_call',
      rawInput: { Action: 'list' },
    }),
    'manage_task'
  );
  assert.equal(
    inferAntigravityToolName({
      toolCallId: 'r10',
      sessionUpdate: 'tool_call',
      rawInput: { Action: 'send_input', Input: 'q\n' },
    }),
    'manage_task'
  );

  // schedule
  assert.equal(
    inferAntigravityToolName({
      toolCallId: 'r11',
      sessionUpdate: 'tool_call',
      rawInput: { Prompt: 'check build', DurationSeconds: 60 },
    }),
    'schedule'
  );
  assert.equal(
    inferAntigravityToolName({
      toolCallId: 'r12',
      sessionUpdate: 'tool_call',
      rawInput: { Prompt: 'nightly run', CronExpression: '0 0 * * *' },
    }),
    'schedule'
  );

  // ask_question
  assert.equal(
    inferAntigravityToolName({
      toolCallId: 'r13',
      sessionUpdate: 'tool_call',
      rawInput: { questions: [{ question: 'Are you sure?', options: ['Yes', 'No'] }] },
    }),
    'ask_question'
  );

  // edit_file
  assert.equal(
    inferAntigravityToolName({
      toolCallId: 'r14',
      sessionUpdate: 'tool_call',
      rawInput: { Path: 'app.ts', Target: 'old', Replacement: 'new' },
    }),
    'edit_file'
  );

  // write_file
  assert.equal(
    inferAntigravityToolName({
      toolCallId: 'r15',
      sessionUpdate: 'tool_call',
      rawInput: { Path: 'app.ts', Content: 'hello' },
    }),
    'write_file'
  );

  // read_file
  assert.equal(
    inferAntigravityToolName({
      toolCallId: 'r16',
      sessionUpdate: 'tool_call',
      rawInput: { Path: 'app.ts', StartLine: 1, EndLine: 20 },
    }),
    'read_file'
  );
  assert.equal(
    inferAntigravityToolName({
      toolCallId: 'r17',
      sessionUpdate: 'tool_call',
      rawInput: { Path: 'app.ts', ByteOffset: 50 },
    }),
    'read_file'
  );
  assert.equal(
    inferAntigravityToolName({
      toolCallId: 'r18',
      sessionUpdate: 'tool_call',
      kind: 'read',
      rawInput: { Path: 'app.ts' },
    }),
    'read_file'
  );

  // Unknown returns null
  assert.equal(
    inferAntigravityToolName({
      toolCallId: 'r19',
      sessionUpdate: 'tool_call',
      rawInput: { foo: 'bar' },
    }),
    null
  );
});

test('maps canonical tool names to correct AcpToolKind', () => {
  assert.equal(mapAntigravityToolKind('run_command'), 'execute');
  assert.equal(mapAntigravityToolKind('read_file'), 'read');
  assert.equal(mapAntigravityToolKind('view_file'), 'read');
  assert.equal(mapAntigravityToolKind('list_dir'), 'read');
  assert.equal(mapAntigravityToolKind('write_file'), 'edit');
  assert.equal(mapAntigravityToolKind('edit_file'), 'edit');
  assert.equal(mapAntigravityToolKind('grep_search'), 'search');
  assert.equal(mapAntigravityToolKind('code_search'), 'search');
  assert.equal(mapAntigravityToolKind('search_web'), 'fetch');
  assert.equal(mapAntigravityToolKind('read_url_content'), 'fetch');
  assert.equal(mapAntigravityToolKind('unknown_tool', 'other'), 'other');
});

test('toolIdentity identifies tools and sets canonical kind', () => {
  const result1 = toolIdentity({
    toolCallId: 'c1',
    sessionUpdate: 'tool_call',
    title: 'run_command: npm test',
  });
  assert.deepEqual(result1, { name: 'run_command', kind: 'execute' });

  const result2 = toolIdentity({
    toolCallId: 'c2',
    sessionUpdate: 'tool_call',
    title: 'read_file: /path/to/foo.txt',
  });
  assert.deepEqual(result2, { name: 'read_file', kind: 'read' });

  const result3 = toolIdentity({
    toolCallId: 'c3',
    sessionUpdate: 'tool_call',
    title: 'custom_tool',
    kind: 'other',
  });
  assert.deepEqual(result3, { kind: 'other' });
});

test('onToolUpdate registers listener and deduplicates same step', () => {
  const delivered = [];
  const unsubscribe = onToolUpdate(event => {
    delivered.push({ id: event.toolCallId, status: event.status });
  });

  const event1 = {
    toolCallId: 'dedup_1',
    sessionUpdate: 'tool_call',
    status: 'in_progress',
    title: 'run_command',
  };

  // Calling toolIdentity should notify
  toolIdentity(event1);
  assert.equal(delivered.length, 1);
  assert.deepEqual(delivered[0], { id: 'dedup_1', status: 'in_progress' });

  // Calling classifyToolCall for the same (toolCallId, status) should be deduplicated
  classifyToolCall(event1);
  assert.equal(delivered.length, 1);

  // An update with a new status (e.g. completed) should notify
  const event1Completed = { ...event1, status: 'completed' };
  toolIdentity(event1Completed);
  assert.equal(delivered.length, 2);
  assert.deepEqual(delivered[1], { id: 'dedup_1', status: 'completed' });

  // A different tool call id should notify
  const event2 = {
    toolCallId: 'dedup_2',
    sessionUpdate: 'tool_call',
    status: 'in_progress',
    title: 'read_file',
  };
  toolIdentity(event2);
  assert.equal(delivered.length, 3);
  assert.deepEqual(delivered[2], { id: 'dedup_2', status: 'in_progress' });

  // Unsubscribe should stop delivery
  unsubscribe();
  toolIdentity({ toolCallId: 'dedup_3', sessionUpdate: 'tool_call', status: 'in_progress' });
  assert.equal(delivered.length, 3);
});

test('setToolUpdateListener sets single listener or clears', () => {
  const delivered = [];
  setToolUpdateListener(e => delivered.push(e.toolCallId));

  toolIdentity({ toolCallId: 'set_1', sessionUpdate: 'tool_call' });
  assert.deepEqual(delivered, ['set_1']);

  // Setting null clears
  setToolUpdateListener(null);
  toolIdentity({ toolCallId: 'set_2', sessionUpdate: 'tool_call' });
  assert.deepEqual(delivered, ['set_1']);
});

test('command descriptions enabled setting', () => {
  assert.equal(getCommandDescriptionsEnabled(), true);

  setCommandDescriptionsEnabled(false);
  assert.equal(getCommandDescriptionsEnabled(), false);

  setCommandDescriptionsEnabled(true);
  assert.equal(getCommandDescriptionsEnabled(), true);
});

test('parseAntigravityCommandOutput extracts clean output, exit code, and background status', () => {
  // Successful command with wrapper
  const raw1 = `Created At: 2026-11-09T00:39:55+02:00
Completed At: 2026-11-09T00:40:06+02:00
Command exited with code 0.

Command output:
Hello World!
line 2
`;
  const parsed1 = parseAntigravityCommandOutput(raw1);
  assert.equal(parsed1.exitCode, 0);
  assert.equal(parsed1.isBackgrounded, false);
  assert.equal(parsed1.backgroundTaskId, null);
  assert.equal(parsed1.cleanOutput, 'Hello World!\nline 2\n');

  // Failed command with alternate wrapper format
  const raw2 = `The command exited with code 1.
Output:
syntax error on line 42
`;
  const parsed2 = parseAntigravityCommandOutput(raw2);
  assert.equal(parsed2.exitCode, 1);
  assert.equal(parsed2.isBackgrounded, false);
  assert.equal(parsed2.cleanOutput, 'syntax error on line 42\n');

  // Backgrounded command
  const raw3 = `Created At: 2026-11-09T00:51:03+02:00
Tool is running as a background task with task id: 7590ed26/task-72
Task logs are available at: file:///logs/task-72.log
`;
  const parsed3 = parseAntigravityCommandOutput(raw3);
  assert.equal(parsed3.exitCode, null);
  assert.equal(parsed3.isBackgrounded, true);
  assert.equal(parsed3.backgroundTaskId, '7590ed26/task-72');
  assert.ok(parsed3.cleanOutput.includes('Tool is running as a background task with task id: 7590ed26/task-72'));

  // Plain output without headers
  const raw4 = 'regular text output';
  const parsed4 = parseAntigravityCommandOutput(raw4);
  assert.equal(parsed4.exitCode, null);
  assert.equal(parsed4.isBackgrounded, false);
  assert.equal(parsed4.cleanOutput, 'regular text output');

  // Non-string input
  const parsed5 = parseAntigravityCommandOutput(null);
  assert.equal(parsed5.exitCode, null);
  assert.equal(parsed5.cleanOutput, '');
});

test('normalizeCommandEvent populates command, title, and cleans output', () => {
  const event = {
    toolCallId: 'norm_1',
    sessionUpdate: 'tool_call',
    title: 'run_command',
    rawInput: {
      CommandLine: 'npm test -- --coverage',
    },
    rawOutput: `Created At: 2026-11-09T00:00:00+00:00
Completed At: 2026-11-09T00:00:05+00:00
Command exited with code 0.

Command output:
All tests passed!
`,
  };

  const normalized = normalizeCommandEvent(event);
  assert.equal(normalized.title, 'npm test -- --coverage');
  assert.equal(normalized.rawInput.command, 'npm test -- --coverage');
  assert.equal(normalized.rawOutput, 'All tests passed!\n');
});

test('commandResult extracts exit code from rawOutput object or output text', () => {
  // From rawOutput object
  assert.deepEqual(
    commandResult({
      toolCallId: 'cr_1',
      sessionUpdate: 'tool_call',
      rawOutput: { exitCode: 0, stdout: 'ok' },
    }),
    { exitCode: 0 }
  );

  assert.deepEqual(
    commandResult({
      toolCallId: 'cr_2',
      sessionUpdate: 'tool_call',
      rawOutput: { exit_code: 2 },
    }),
    { exitCode: 2 }
  );

  // From output text
  assert.deepEqual(
    commandResult({
      toolCallId: 'cr_3',
      sessionUpdate: 'tool_call',
      rawOutput: 'Command exited with code 1.\n\nCommand output:\nerror',
    }),
    { exitCode: 1 }
  );

  // When no exit code is present
  assert.equal(
    commandResult({
      toolCallId: 'cr_4',
      sessionUpdate: 'tool_call',
      rawOutput: 'still running...',
    }),
    null
  );
});

test('classifyToolCall: run_command with descriptions enabled and disabled', () => {
  setCommandDescriptionsEnabled(true);
  const event1 = {
    toolCallId: 'cmd_1',
    sessionUpdate: 'tool_call',
    title: 'run_command',
    rawInput: {
      CommandLine: 'git status',
      toolSummary: 'Check git status',
      BypassSandbox: false,
    },
    rawOutput: 'Command exited with code 0.\nCommand output:\nClean',
  };

  const classified1 = classifyToolCall(event1);
  assert.equal(classified1.kind, 'command');
  assert.equal(classified1.presentation.icon.glyph, 'Terminal');
  assert.equal(classified1.presentation.label.pending, 'Running command');
  assert.equal(classified1.presentation.label.completed, 'Ran command');
  assert.equal(classified1.presentation.title, 'Check git status');
  assert.equal(classified1.presentation.detail, 'git status');
  assert.equal(classified1.presentation.subtitle, 'git status');
  assert.equal(classified1.presentation.badge, undefined);
  assert.equal(classified1.presentation.badges, undefined);

  // With BypassSandbox: true
  const event2 = {
    toolCallId: 'cmd_2',
    sessionUpdate: 'tool_call',
    rawInput: {
      CommandLine: 'curl https://example.com',
      toolSummary: 'Fetch example',
      BypassSandbox: true,
    },
  };
  const classified2 = classifyToolCall(event2);
  assert.deepEqual(classified2.presentation.badge, {
    glyph: 'ShieldAlert',
    label: 'Outside of sandbox',
    hint: 'Command runs outside the sandbox',
    tone: 'destructive',
  });
  assert.deepEqual(classified2.presentation.badges, [
    { label: 'Outside of sandbox', tone: 'destructive' },
  ]);

  // When command descriptions are disabled
  setCommandDescriptionsEnabled(false);
  const classified3 = classifyToolCall(event1);
  assert.equal(classified3.presentation.title, 'git status');
  assert.equal(classified3.presentation.detail, undefined);
  assert.equal(classified3.presentation.subtitle, undefined);

  // Backgrounded command
  setCommandDescriptionsEnabled(true);
  const event4 = {
    toolCallId: 'cmd_4',
    sessionUpdate: 'tool_call',
    rawInput: {
      CommandLine: 'pnpm dev',
    },
    rawOutput: 'Tool is running as a background task with task id: bg-1',
  };
  const classified4 = classifyToolCall(event4);
  assert.equal(classified4.presentation.label.completed, 'Started background command');
});

test('classifyToolCall: invoke_subagent builds delegation card', () => {
  const event = {
    toolCallId: 'sub_1',
    sessionUpdate: 'tool_call',
    rawInput: {
      Role: 'Code Reviewer',
      TypeName: 'reviewer',
      Model: 'gemini-1.5-pro',
      Workspace: 'branch',
      Prompt: 'Please review recent changes in auth module',
    },
    rawOutput: '{"conversationId": "conv_999888"}',
  };

  const classified = classifyToolCall(event);
  assert.equal(classified.kind, 'delegation');
  assert.equal(classified.label, 'Code Reviewer');
  assert.equal(classified.childRef, 'conv_999888');
  assert.equal(classified.background, true);
  assert.equal(classified.detail, 'reviewer · gemini-1.5-pro · branch');
  assert.equal(classified.presentation.icon.glyph, 'Bot');
  assert.equal(classified.presentation.label.pending, 'Running subagent');
  assert.equal(classified.presentation.label.completed, 'Subagent launched');
  assert.equal(classified.presentation.title, 'Code Reviewer');
  assert.equal(classified.presentation.subtitle, 'reviewer · gemini-1.5-pro · branch');

  // Fallback when Role is empty, Model/Workspace inherit
  const eventSimple = {
    toolCallId: 'sub_2',
    sessionUpdate: 'tool_call',
    rawInput: {
      TypeName: 'helper',
      Model: 'inherit',
      Workspace: 'inherit',
      Prompt: 'Do some quick research',
    },
  };
  const classifiedSimple = classifyToolCall(eventSimple);
  assert.equal(classifiedSimple.label, 'helper');
  assert.equal(classifiedSimple.detail, 'Do some quick research');
  assert.equal(classifiedSimple.childRef, undefined);
});

test('classifyToolCall: define_subagent', () => {
  const event = {
    toolCallId: 'def_1',
    sessionUpdate: 'tool_call',
    rawInput: {
      Name: 'test-runner',
      Description: 'Runs tests and collects failure reports',
      SystemPrompt: 'You are a test runner',
    },
  };

  const classified = classifyToolCall(event);
  assert.equal(classified.kind, 'tool_use');
  assert.equal(classified.tool, 'define_subagent');
  assert.equal(classified.detail, 'Runs tests and collects failure reports');
  assert.equal(classified.presentation.title, 'Define subagent test-runner');
  assert.equal(classified.presentation.subtitle, 'Runs tests and collects failure reports');
  assert.equal(classified.presentation.label.pending, 'Defining subagent');
  assert.equal(classified.presentation.label.completed, 'Defined subagent');
  assert.equal(classified.presentation.icon.glyph, 'Bot');
});

test('classifyToolCall: manage_subagents for list, kill, and kill_all', () => {
  // list
  const listEvent = {
    toolCallId: 'mng_1',
    sessionUpdate: 'tool_call',
    rawInput: { Action: 'list' },
    title: 'manage_subagents',
  };
  const listClassified = classifyToolCall(listEvent);
  assert.equal(listClassified.kind, 'tool_use');
  assert.equal(listClassified.tool, 'manage_subagents');
  assert.equal(listClassified.presentation.label.pending, 'Listing subagents');
  assert.equal(listClassified.presentation.label.completed, 'Listed subagents');
  assert.equal(listClassified.presentation.title, 'List subagents');

  // kill
  const killEvent = {
    toolCallId: 'mng_2',
    sessionUpdate: 'tool_call',
    rawInput: { Action: 'kill', ConversationIds: ['c1', 'c2'] },
  };
  const killClassified = classifyToolCall(killEvent);
  assert.equal(killClassified.presentation.label.pending, 'Stopping subagents');
  assert.equal(killClassified.presentation.label.completed, 'Stopped subagents');
  assert.equal(killClassified.presentation.title, 'Stop subagents');
  assert.equal(killClassified.presentation.subtitle, 'c1, c2');

  // kill_all
  const killAllEvent = {
    toolCallId: 'mng_3',
    sessionUpdate: 'tool_call',
    rawInput: { Action: 'kill_all' },
  };
  const killAllClassified = classifyToolCall(killAllEvent);
  assert.equal(killAllClassified.presentation.label.pending, 'Stopping subagents');
  assert.equal(killAllClassified.presentation.label.completed, 'Stopped subagents');
  assert.equal(killAllClassified.presentation.title, 'Stop subagents');
});

test('classifyToolCall: send_message', () => {
  const event = {
    toolCallId: 'msg_1',
    sessionUpdate: 'tool_call',
    rawInput: {
      Recipient: 'subagent_42',
      Message: 'Please stop execution and report findings.',
    },
  };

  const classified = classifyToolCall(event);
  assert.equal(classified.kind, 'tool_use');
  assert.equal(classified.tool, 'send_message');
  assert.equal(classified.detail, 'subagent_42');
  assert.equal(classified.presentation.title, 'Message subagent_42');
  assert.equal(classified.presentation.subtitle, 'Please stop execution and report findings.');
  assert.equal(classified.presentation.label.pending, 'Messaging subagent');
  assert.equal(classified.presentation.label.completed, 'Messaged subagent');
  assert.equal(classified.presentation.icon.glyph, 'Bot');
});

test('classifyToolCall: manage_task for all actions', () => {
  for (const [action, pending, completed] of [
    ['list', 'Listing background tasks', 'Listed background tasks'],
    ['status', 'Checking background task', 'Checked background task'],
    ['kill', 'Stopping background task', 'Stopped background task'],
    ['send_input', 'Sending input to task', 'Sent input to task'],
  ]) {
    const event = {
      toolCallId: `task_${action}`,
      sessionUpdate: 'tool_call',
      rawInput: { Action: action, TaskId: 'bg-task-99' },
    };
    const classified = classifyToolCall(event);
    assert.equal(classified.kind, 'tool_use');
    assert.equal(classified.tool, 'manage_task');
    assert.equal(classified.presentation.label.pending, pending);
    assert.equal(classified.presentation.label.completed, completed);
    assert.equal(classified.presentation.title, `${action}: bg-task-99`);
    assert.equal(classified.presentation.icon.glyph, 'Terminal');
  }
});

test('classifyToolCall: schedule duration and cron', () => {
  // Timer
  const timerEvent = {
    toolCallId: 'sched_1',
    sessionUpdate: 'tool_call',
    rawInput: { DurationSeconds: 45, Prompt: 'Check build status' },
  };
  const timerClassified = classifyToolCall(timerEvent);
  assert.equal(timerClassified.kind, 'tool_use');
  assert.equal(timerClassified.tool, 'schedule');
  assert.equal(timerClassified.detail, '45s timer');
  assert.equal(timerClassified.presentation.title, 'Schedule (45s timer)');
  assert.equal(timerClassified.presentation.subtitle, 'Check build status');
  assert.equal(timerClassified.presentation.icon.glyph, 'Clock');

  // Cron
  const cronEvent = {
    toolCallId: 'sched_2',
    sessionUpdate: 'tool_call',
    rawInput: { CronExpression: '*/10 * * * *', Prompt: 'Poll queue' },
  };
  const cronClassified = classifyToolCall(cronEvent);
  assert.equal(cronClassified.presentation.title, 'Schedule (cron: */10 * * * *)');
});

test('classifyToolCall: ask_question', () => {
  const event = {
    toolCallId: 'ask_1',
    sessionUpdate: 'tool_call',
    rawInput: {
      questions: [{ question: 'Deploy to staging?', options: ['Yes', 'No'] }],
    },
  };

  const classified = classifyToolCall(event);
  assert.equal(classified.kind, 'tool_use');
  assert.equal(classified.tool, 'ask_question');
  assert.equal(classified.presentation.title, 'Ask question');
  assert.equal(classified.presentation.label.pending, 'Asking question');
  assert.equal(classified.presentation.label.completed, 'Asked question');
  assert.equal(classified.presentation.icon.glyph, 'HelpCircle');
});

test('classifyToolCall: returns null for other tools (read_file, edit_file, unknown)', () => {
  assert.equal(
    classifyToolCall({
      toolCallId: 'read_1',
      sessionUpdate: 'tool_call',
      title: 'read_file: /path/to/foo.txt',
      rawInput: { Path: '/path/to/foo.txt' },
    }),
    null
  );

  assert.equal(
    classifyToolCall({
      toolCallId: 'edit_1',
      sessionUpdate: 'tool_call',
      title: 'edit_file: /path/to/foo.txt',
      rawInput: { Path: '/path/to/foo.txt', Target: 'a', Replacement: 'b' },
    }),
    null
  );

  assert.equal(
    classifyToolCall({
      toolCallId: 'unk_1',
      sessionUpdate: 'tool_call',
      title: 'unknown_custom_tool',
    }),
    null
  );
});

test('parseAntigravityCommandOutput preserves ordinary output containing Output: without headers', () => {
  const raw = 'first line\nOutput:\nsecond line\n';
  const parsed = parseAntigravityCommandOutput(raw);
  assert.equal(parsed.cleanOutput, 'first line\nOutput:\nsecond line\n');
  assert.equal(parsed.exitCode, null);
});

test('parseAntigravityCommandOutput extracts exit code with optional period', () => {
  const rawWithPeriod = 'Command exited with code 0.\nCommand output:\nok';
  assert.equal(parseAntigravityCommandOutput(rawWithPeriod).exitCode, 0);

  const rawWithoutPeriod = 'Command exited with code 2\nCommand output:\nfailed';
  const parsed = parseAntigravityCommandOutput(rawWithoutPeriod);
  assert.equal(parsed.exitCode, 2);
  assert.equal(parsed.cleanOutput, 'failed');
});

test('parseAntigravityCommandOutput preserves sandbox error diagnostics', () => {
  // Sandbox error header with an empty output section: the diagnostic must
  // become the cleaned output instead of being stripped down to an empty string.
  const rawEmpty = `Created At: 2026-11-09T00:39:55+02:00
There were sandbox errors: Access is denied (os error 5)
Command exited with code 1.

Command output:
`;
  const parsedEmpty = parseAntigravityCommandOutput(rawEmpty);
  assert.equal(parsedEmpty.exitCode, 1);
  assert.equal(parsedEmpty.cleanOutput, 'There were sandbox errors: Access is denied (os error 5)');

  // Sandbox error header with a non-empty output section: the diagnostic is
  // prepended to the output.
  const rawWithOutput = `There were sandbox errors: writing to /workspace/project requires approval
Command exited with code 1.

Command output:
partial output before denial
`;
  const parsedWithOutput = parseAntigravityCommandOutput(rawWithOutput);
  assert.equal(parsedWithOutput.exitCode, 1);
  assert.equal(
    parsedWithOutput.cleanOutput,
    'There were sandbox errors: writing to /workspace/project requires approval\npartial output before denial\n'
  );

  // Non-zero exit code with no output and no diagnostic headers: normalize to
  // the exit-code line instead of an empty string.
  const parsedExitOnly = parseAntigravityCommandOutput('The command exited with code 1.');
  assert.equal(parsedExitOnly.exitCode, 1);
  assert.equal(parsedExitOnly.cleanOutput, 'The command exited with code 1.');

  // Cosmetic headers are still stripped: a successful command with an empty
  // output section still normalizes to an empty string.
  const rawSuccess = 'Created At: 2026-11-09T00:00:00+00:00\nCommand exited with code 0.\n\nCommand output:\n';
  const parsedSuccess = parseAntigravityCommandOutput(rawSuccess);
  assert.equal(parsedSuccess.exitCode, 0);
  assert.equal(parsedSuccess.cleanOutput, '');
});

test('normalizeCommandEvent keeps diagnostic output for sandbox-denied commands', () => {
  const event = {
    toolCallId: 'norm_sandbox',
    sessionUpdate: 'tool_call',
    rawInput: { command: 'npm run build' },
    rawOutput: `There were sandbox errors: Access is denied (os error 5)
Command exited with code 1.

Command output:
`,
  };
  const normalized = normalizeCommandEvent(event);
  assert.equal(normalized.rawOutput, 'There were sandbox errors: Access is denied (os error 5)');
});

test('onToolUpdate notifies when a second completed update arrives with new output text', () => {
  const delivered = [];
  const unsubscribe = onToolUpdate(event => {
    delivered.push({ id: event.toolCallId, status: event.status, content: event.content });
  });

  const eventInitial = {
    toolCallId: 'update_out_1',
    sessionUpdate: 'tool_call',
    status: 'completed',
    title: 'run_command',
  };
  toolIdentity(eventInitial);
  assert.equal(delivered.length, 1);

  // Identical without new output -> skipped
  classifyToolCall(eventInitial);
  assert.equal(delivered.length, 1);

  // Second completed update arrives with output text -> notified!
  const eventWithOutput = {
    toolCallId: 'update_out_1',
    sessionUpdate: 'tool_call',
    status: 'completed',
    title: 'run_command',
    content: [{ type: 'text', text: 'Command finished successfully' }],
  };
  toolIdentity(eventWithOutput);
  assert.equal(delivered.length, 2);
  assert.equal(delivered[1].content[0].text, 'Command finished successfully');

  unsubscribe();
});

test('classifyToolCall: invoke_subagent extracts childRef from plain-text conversationId banner', () => {
  const event = {
    toolCallId: 'sub_plain_1',
    sessionUpdate: 'tool_call',
    rawInput: {
      Role: 'Explorer',
      TypeName: 'research',
      Prompt: 'Explore codebase',
    },
    content: [{ type: 'text', text: 'Subagent spawned with conversationId: conv_plain_1' }],
  };

  const classified = classifyToolCall(event);
  assert.equal(classified.kind, 'delegation');
  assert.equal(classified.childRef, 'conv_plain_1');
  assert.equal(classified.label, 'Explorer');
});

test('applyThreadCommandDescriptions isolates commandDescriptionsEnabled per threadId across concurrent threads', () => {
  const enabledByThread = new Map([
    ['thread-enabled', true],
    ['thread-disabled', false],
  ]);

  const createDeltaLine = (threadId, command, summary) =>
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'thread/delta',
      params: {
        threadId,
        deltas: [
          {
            kind: 'item.open',
            item: { type: 'command', command },
            presentation: {
              title: summary,
              detail: command,
              subtitle: command,
            },
          },
        ],
      },
    });

  // Thread with enabled = true retains summary title and subtitle
  const lineEnabled = createDeltaLine('thread-enabled', 'git status', 'Check git status');
  const resultEnabled = applyThreadCommandDescriptions(lineEnabled, enabledByThread);
  assert.equal(resultEnabled, lineEnabled);
  const parsedEnabled = JSON.parse(resultEnabled);
  assert.equal(parsedEnabled.params.deltas[0].presentation.title, 'Check git status');
  assert.equal(parsedEnabled.params.deltas[0].presentation.detail, 'git status');
  assert.equal(parsedEnabled.params.deltas[0].presentation.subtitle, 'git status');

  // Thread with enabled = false replaces summary title with command line and deletes subtitle/detail
  const lineDisabled = createDeltaLine('thread-disabled', 'git status', 'Check git status');
  const resultDisabled = applyThreadCommandDescriptions(lineDisabled, enabledByThread);
  assert.notEqual(resultDisabled, lineDisabled);
  const parsedDisabled = JSON.parse(resultDisabled);
  assert.equal(parsedDisabled.params.deltas[0].presentation.title, 'git status');
  assert.equal(parsedDisabled.params.deltas[0].presentation.detail, undefined);
  assert.equal(parsedDisabled.params.deltas[0].presentation.subtitle, undefined);

  // Fallback to getCommandDescriptionsEnabled() when thread not in map
  setCommandDescriptionsEnabled(true);
  const lineFallback = createDeltaLine('thread-unknown', 'npm test', 'Run tests');
  assert.equal(applyThreadCommandDescriptions(lineFallback, enabledByThread), lineFallback);

  // Non-delta messages and invalid JSON pass through unchanged
  assert.equal(applyThreadCommandDescriptions('not json', enabledByThread), 'not json');
  const otherMessage = JSON.stringify({ method: 'session/update' });
  assert.equal(applyThreadCommandDescriptions(otherMessage, enabledByThread), otherMessage);
});
