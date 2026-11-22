import { openSync, closeSync, fstatSync, readSync, statSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { StringDecoder } from 'node:string_decoder';
import { inferAntigravityToolName } from './dialect.ts';

export interface RecordedToolEvent {
  toolCallId: string;
  title?: string;
  kind?: string;
  status?: string;
  rawInput?: Record<string, unknown>;
  rawOutput?: unknown;
  content?: unknown;
}
export interface BackgroundTask {
  taskId: string;
  taskType: 'local_bash' | 'local_subagent';
  description: string;
  parentToolCallId: string;
  outputFile?: string;
  transcriptPath?: string;
  /** Epoch ms when the task was registered; internal, used only for the persisted state file. */
  startedAt?: number;
}
/** Durable record persisted for each registered background task so state survives host restarts. */
export interface PersistedBackgroundTask {
  threadId: string;
  taskId: string;
  taskType: BackgroundTask['taskType'];
  description: string;
  parentToolCallId: string;
  transcriptPath?: string;
  outputFile?: string;
  startedAt: number;
}
interface PersistedBackgroundTaskStateFile {
  version: 1;
  tasks: PersistedBackgroundTask[];
}
export interface BackgroundTaskDelta {
  kind: 'item.open' | 'item.close';
  attach?: 'currentOrLast';
  key: { providerItemId: string; parentRef?: string };
  status?: 'completed' | 'failed' | 'interrupted';
  item: Record<string, unknown>;
  presentation: Record<string, unknown>;
}
export interface SilentTurnInjectionDelta {
  kind: 'item.textDelta' | 'item.textClose';
  key: { channel: string };
  channel: 'agentMessage';
  text: string;
}
// After this many consecutive silent turns (failed empty-output command, no agent text),
// the injected message escalates to "command execution appears broken in this session".
export const SILENT_TURN_ESCALATION_THRESHOLD = 2;
export function normalizeFileUri(value: string): string {
  return value.trim().replace(/^file:\/\/\/([A-Za-z]:\/)/i, '$1').replace(/^file:\/\/\//i, '/');
}
export function deriveTranscriptPathFromLogFile(outputFile: string): string | null {
  const path = normalizeFileUri(outputFile).replace(/\\/g, '/');
  return /\/\.system_generated\/tasks\/[^/]+$/.test(path)
    ? path.replace(/\.system_generated\/tasks\/[^/]+$/, '.system_generated/logs/transcript.jsonl') : null;
}
export function extractToolOutputText(event: RecordedToolEvent): string {
  function extract(value: unknown): string {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(extract).filter(Boolean).join('\n');
    if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      const parts = ['text', 'content', 'output'].filter(key => key in obj).map(key => extract(obj[key]));
      return parts.length ? parts.join('\n') : JSON.stringify(value);
    }
    return '';
  }
  return [extract(event.content), extract(event.rawOutput)].filter(Boolean).join('\n');
}
const first = (...values: unknown[]): string => values.find(v => typeof v === 'string' && v.trim())?.toString().trim() ?? '';
function containsTaskToken(text: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9_/-])${escaped}(?![A-Za-z0-9_/-])`).test(text);
}

function mergeToolEvent(previous: RecordedToolEvent | undefined, event: RecordedToolEvent): RecordedToolEvent {
  return {
    ...previous, ...event,
    title: event.title ?? previous?.title,
    kind: event.kind ?? previous?.kind,
    status: event.status ?? previous?.status,
    rawInput: previous?.rawInput && event.rawInput ? { ...previous.rawInput, ...event.rawInput } : event.rawInput ?? previous?.rawInput,
    rawOutput: event.rawOutput ?? previous?.rawOutput,
    content: event.content ?? previous?.content,
  };
}

/**
 * Default maximum age of a persisted record before it is garbage-collected (a running task is
 * never expected to outlive this). Configurable per tracker via `taskStateMaxAgeMs`.
 */
const DEFAULT_TASK_STATE_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Stable per-host location for the persisted background-task state file.
 *
 * Why `~/.bb/plugin-data/bb-plugin-antigravity/background-tasks.json`:
 * - The plugin host process must be able to write it and it must survive host restarts, so a
 *   fixed per-user path beats anything under a thread workspace (which may not exist or be
 *   writable when the tracker starts, and is not unique per plugin host).
 * - Unlike an OS temp dir, which cleanup tools may wipe, the user's `.bb` area is persistent
 *   across reboots; namespacing it by plugin name avoids collisions with other BB plugins (the
 *   file itself is versioned for the same reason).
 * - Concurrent plugin hosts on the same machine share this one file; records are keyed by
 *   thread id and writes merge with the current on-disk state, so hosts never clobber each
 *   other's threads.
 * `BB_ANTIGRAVITY_TASK_STATE_DIR` overrides the directory; tests inject a temp path instead.
 */
export function defaultBackgroundTaskStatePath(): string {
  const override = process.env.BB_ANTIGRAVITY_TASK_STATE_DIR?.trim();
  const dir = override || join(homedir(), '.bb', 'plugin-data', 'bb-plugin-antigravity');
  return join(dir, 'background-tasks.json');
}

/** Loads and validates the state file. Missing or corrupt files degrade to an empty list. */
function readTaskState(path: string, maxAgeMs: number): PersistedBackgroundTask[] {
  if (!path) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(path, 'utf8')); } catch { return []; }
  if (!parsed || typeof parsed !== 'object') return [];
  const file = parsed as { version?: unknown; tasks?: unknown };
  if (file.version !== 1 || !Array.isArray(file.tasks)) return [];
  const cutoff = Date.now() - Math.max(0, maxAgeMs); // Garbage-collect stale records.
  const records: PersistedBackgroundTask[] = [];
  for (const entry of file.tasks) {
    if (!entry || typeof entry !== 'object') continue;
    const task = entry as Partial<PersistedBackgroundTask>;
    if (typeof task.threadId !== 'string' || typeof task.taskId !== 'string' || typeof task.description !== 'string' ||
        typeof task.parentToolCallId !== 'string' || typeof task.startedAt !== 'number' ||
        !Number.isFinite(task.startedAt) || task.startedAt < cutoff ||
        (task.taskType !== 'local_bash' && task.taskType !== 'local_subagent')) continue;
    records.push({
      threadId: task.threadId, taskId: task.taskId, taskType: task.taskType, description: task.description,
      parentToolCallId: task.parentToolCallId, startedAt: task.startedAt,
      ...(typeof task.transcriptPath === 'string' ? { transcriptPath: task.transcriptPath } : {}),
      ...(typeof task.outputFile === 'string' ? { outputFile: task.outputFile } : {}),
    });
  }
  return records;
}

/** Atomic-ish write: temp file + rename, so a crash mid-write can never corrupt the state file. */
function writeTaskState(path: string, tasks: PersistedBackgroundTask[]): boolean {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    writeFileSync(temp, `${JSON.stringify({ version: 1, tasks } satisfies PersistedBackgroundTaskStateFile)}\n`);
    renameSync(temp, path);
    return true;
  } catch {
    // Best effort: persistence trouble (missing dir permissions, full disk, ...) must never
    // crash the plugin host; the tracker simply continues in memory-only mode.
    return false;
  }
}

export function createBackgroundTaskTracker(options: {
  pollIntervalMs?: number;
  onAsyncDeltas?: (threadId: string, deltas: BackgroundTaskDelta[]) => void;
  /** Path of the persisted state file; omit to keep tracking in memory only (used by tests and the dev harness). */
  persistPath?: string;
  taskStateMaxAgeMs?: number;
} = {}) {
  const threads = new Map<string, Map<string, BackgroundTask>>();
  const pending = new Map<string, RecordedToolEvent[]>();
  const threadTools = new Map<string, Map<string, RecordedToolEvent>>();
  const streamBuffers = new Map<string, string>();
  const watchers = new Map<string, Map<string, { offset: number; partial: string; decoder: StringDecoder }>>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let disposed = false;
  const interval = options.pollIntervalMs ?? 500;
  const persistPath = options.persistPath || undefined;
  const maxAge = options.taskStateMaxAgeMs ?? DEFAULT_TASK_STATE_MAX_AGE_MS;
  /** Threads this tracker registered, settled, or cleared; only their records are ever rewritten. */
  const touchedThreads = new Set<string>();
  let lastWritten = '';
  const taskKey = (task: Pick<BackgroundTask, 'taskType' | 'taskId'>) => `${task.taskType === 'local_subagent' ? 'subagent' : 'task'}:${task.taskId}`;
  // Silent-turn detection state (issue: turn ends with no agent message after a failed
  // command with empty output, so BB records "No final output was recorded").
  const silentTurns = new Map<string, { agentText: boolean; emptyFailedCommand: boolean; streak: number }>();
  function silentState(thread: string): { agentText: boolean; emptyFailedCommand: boolean; streak: number } {
    let state = silentTurns.get(thread);
    if (!state) {
      state = { agentText: false, emptyFailedCommand: false, streak: 0 };
      silentTurns.set(thread, state);
    }
    return state;
  }
  function silentTurnMessage(streak: number): string {
    if (streak >= SILENT_TURN_ESCALATION_THRESHOLD) {
      return `Command execution appears broken in this session: ${streak} consecutive turns ended without an agent response after commands failed with empty output. Restart the thread runtime (reload the thread) or restart the host.`;
    }
    return 'The Antigravity agent ended this turn without a response after a command failed with empty output. Command execution may be broken in the CLI runtime — try reloading the thread or restarting the host.';
  }
  // Injected warnings reuse the exact wire shape the SDK's ACP bridge uses for genuine agent
  // messages: an `item.textDelta` + `item.textClose` pair on the assistant stream key
  // (`key.channel: "assistant"`, `channel: "agentMessage"`). The host delta assembler
  // auto-opens an `agentMessage` item on the first textDelta and settles it on the textClose,
  // recording the text as the turn's agent output. The pair must be inserted *before* the
  // `turn.boundary` entry in the delta list: after the boundary the host closes the turn,
  // and any text delta appended past it would be dropped instead of recorded.
  function silentTurnInjection(text: string): SilentTurnInjectionDelta[] {
    return [
      { kind: 'item.textDelta', key: { channel: 'assistant' }, channel: 'agentMessage', text },
      { kind: 'item.textClose', key: { channel: 'assistant' }, channel: 'agentMessage', text },
    ];
  }
  function handleTurnBoundary(thread: string, status: unknown): string | null {
    const state = silentState(thread);
    const silent = !state.agentText && state.emptyFailedCommand;
    let message: string | null = null;
    if (status === 'completed' && silent) {
      state.streak += 1;
      message = silentTurnMessage(state.streak);
    } else if (!silent) {
      // Any turn that emitted agent text or had no such failure resets the streak.
      state.streak = 0;
    }
    // Interrupted/failed boundaries with the silent pattern are ambiguous (e.g. the user
    // stopped the turn): leave the streak untouched so a later confirmed silent turn escalates.
    state.agentText = false;
    state.emptyFailedCommand = false;
    return message;
  }
  function delta(task: BackgroundTask, status?: BackgroundTaskDelta['status'], taskStatus?: string, summary?: string): BackgroundTaskDelta {
    const agent = task.taskType === 'local_subagent';
    return {
      kind: status ? 'item.close' : 'item.open',
      ...(status ? { status } : { attach: 'currentOrLast' as const }),
      key: { providerItemId: taskKey(task), ...(task.parentToolCallId ? { parentRef: task.parentToolCallId } : {}) },
      item: { type: 'backgroundTask', familyId: task.taskId, taskType: task.taskType, description: task.description,
        status: status ?? 'pending', taskStatus: taskStatus ?? 'running', skipTranscript: false, foreground: false,
        ...(task.outputFile ? { outputFile: task.outputFile } : {}), ...(summary ? { summary } : {}) },
      presentation: { label: { pending: `Running background ${agent ? 'agent' : 'command'}`, completed: `Background ${agent ? 'agent' : 'command'} finished` },
        icon: { glyph: agent ? 'Bot' : 'Terminal' }, title: task.description },
    };
  }
  const toRecord = (thread: string, task: BackgroundTask): PersistedBackgroundTask => ({
    threadId: thread, taskId: task.taskId, taskType: task.taskType, description: task.description,
    parentToolCallId: task.parentToolCallId, startedAt: task.startedAt ?? Date.now(),
    ...(task.transcriptPath ? { transcriptPath: task.transcriptPath } : {}),
    ...(task.outputFile ? { outputFile: task.outputFile } : {}),
  });
  /**
   * Merges this tracker's live tasks into the state file: records for the threads this tracker
   * has touched are replaced with the in-memory tasks (dropping settled/cleared ones), and every
   * other thread's records are preserved, so concurrent plugin hosts never clobber each other.
   */
  function persistState() {
    if (!persistPath) return;
    const previous = readTaskState(persistPath, maxAge);
    const records = [
      ...previous.filter(record => !touchedThreads.has(record.threadId)),
      ...[...touchedThreads].flatMap(thread => [...(threads.get(thread)?.values() ?? [])].map(task => toRecord(thread, task))),
    ].sort((a, b) => a.threadId === b.threadId ? a.taskId.localeCompare(b.taskId) : a.threadId.localeCompare(b.threadId));
    const json = JSON.stringify({ version: 1, tasks: records });
    if (json === lastWritten) return;
    if (writeTaskState(persistPath, records)) lastWritten = json;
  }
  /**
   * Restart reconciliation: `clearThread`-shaped `interrupted` closes for persisted tasks of a
   * resumed thread that were never settled in this process, then drops those records so BB and
   * the resumed agent learn the tasks died with the previous host.
   */
  function reconcilePersisted(thread: string): BackgroundTaskDelta[] {
    if (!persistPath) return [];
    const records = readTaskState(persistPath, maxAge);
    const active = threads.get(thread);
    const pending = records.filter(record => record.threadId === thread && !active?.has(taskKey(record)) && initialRecordKeys.has(`${record.threadId}\u0000${record.taskId}`));
    if (!pending.length) return [];
    const results = pending.map(record => delta({
      taskId: record.taskId, taskType: record.taskType, description: record.description, parentToolCallId: record.parentToolCallId,
      ...(record.transcriptPath ? { transcriptPath: record.transcriptPath } : {}), ...(record.outputFile ? { outputFile: record.outputFile } : {}),
    }, 'interrupted', 'stopped'));
    touchedThreads.add(thread);
    persistState();
    return results;
  }
  function syncPolling() {
    for (const [thread, paths] of watchers) {
      for (const path of paths.keys()) {
        if (![...(threads.get(thread)?.values() ?? [])].some(t => t.transcriptPath === path)) paths.delete(path);
      }
      if (!paths.size) watchers.delete(thread);
    }
    if (!watchers.size && timer) { clearInterval(timer); timer = undefined; }
  }
  function settle(thread: string, id: string, status: NonNullable<BackgroundTaskDelta['status']>, taskStatus: string, summary?: string, type?: BackgroundTask['taskType']) {
    const tasks = threads.get(thread);
    const results: BackgroundTaskDelta[] = [];
    for (const [key, task] of tasks ?? []) {
      if ((task.taskId === id || task.taskId.endsWith(`/${id}`) || id.endsWith(`/${task.taskId}`)) && (!type || task.taskType === type)) { tasks!.delete(key); results.push(delta(task, status, taskStatus, summary)); }
    }
    if (!tasks?.size) threads.delete(thread);
    syncPolling();
    if (results.length) { touchedThreads.add(thread); persistState(); }
    return results;
  }
  function inspectTextForCompletions(thread: string, text: string): BackgroundTaskDelta[] {
    const results: BackgroundTaskDelta[] = [];
    // Bound each result at the next announcement so failures cannot spill into another task.
    const announcements = [...text.matchAll(/Task id "([^"]+)" (finished with result:|was canceled|was killed|terminated|failed)/gi)];
    announcements.forEach((match, i) => {
      const result = text.slice(match.index! + match[0].length, announcements[i + 1]?.index ?? text.length);
      const failed = match[2].toLowerCase() === 'failed' || /Command exited with code ([1-9]\d*)|Encountered error/i.test(result);
      const killed = /was canceled|was killed|terminated/i.test(match[2]) || /Step was canceled/i.test(result);
      results.push(...settle(thread, match[1], failed ? 'failed' : killed ? 'interrupted' : 'completed', failed ? 'failed' : killed ? 'killed' : 'completed', result.trim(), 'local_bash'));
    });
    for (const match of text.matchAll(/Subagent ([^\s"]+) has gone idle/gi)) results.push(...settle(thread, match[1], 'completed', 'completed', undefined, 'local_subagent'));
    return results;
  }
  function poll() {
    for (const [thread, paths] of watchers) for (const [path, state] of paths) {
      let fd: number | undefined;
      let text = '';
      try {
        fd = openSync(path, 'r');
        const size = fstatSync(fd).size;
        if (size < state.offset) { state.offset = 0; state.partial = ''; state.decoder = new StringDecoder('utf8'); }
        if (size > state.offset) {
          const buffer = Buffer.alloc(size - state.offset);
          const count = readSync(fd, buffer, 0, buffer.length, state.offset);
          state.offset += count;
          const appended = state.partial + state.decoder.write(buffer.subarray(0, count));
          const end = appended.lastIndexOf('\n');
          state.partial = appended.slice(end + 1);
          text = appended.slice(0, end + 1);
        }
      } catch { /* The CLI may not have created the transcript yet. */ }
      finally { if (fd !== undefined) closeSync(fd); }
      if (text) {
        // Transcript records encode message text as JSON strings.
        text = text.split('\n').map(line => { try { return extractToolOutputText({ toolCallId: '', rawOutput: JSON.parse(line) }).replace(/\\"/g, '"'); } catch { return line; } }).join('\n');
        const deltas = inspectTextForCompletions(thread, text);
        if (deltas.length) options.onAsyncDeltas?.(thread, deltas);
      }
    }
  }
  function handleToolEventForThread(thread: string, event: RecordedToolEvent): BackgroundTaskDelta[] {
    if (disposed) return [];
    // A failed run_command event with empty/whitespace output is the exact signature of the
    // "silent give-up" turn: record it even though no background task is registered for it.
    if (event.status === 'failed') {
      const inferred = inferAntigravityToolName(event as any);
      const name = inferred ?? [event.title, event.kind].find(v => typeof v === 'string' && v.trim()) ?? '';
      if (name === 'run_command' && !extractToolOutputText(event).trim()) {
        silentState(thread).emptyFailedCommand = true;
      }
    }
    if (event.status !== 'completed') return [];
    const input = event.rawInput ?? {};
    const text = extractToolOutputText(event);
    const inferred = inferAntigravityToolName(event as any);
    const name = (inferred && /^(run_command|schedule|invoke_subagent|manage_task|manage_subagents)$/.test(inferred) ? inferred : undefined)
      ?? [event.title, event.kind].find(v => /^(run_command|schedule|invoke_subagent|manage_task|manage_subagents)$/.test(v ?? '')) ?? '';
    const action = String(input.Action ?? '').toLowerCase();
    const results: BackgroundTaskDelta[] = [];
    if (name === 'manage_task') {
      const id = first(input.TaskId);
      if (action === 'kill' && id) return settle(thread, id, 'interrupted', 'killed', text, 'local_bash');
      if (action === 'status' && id && !/Step is still running|status\s*[:=]\s*RUNNING/i.test(text) && /Command exited with code \d+|SCHEDULE_FINISHED|Step was canceled|status\s*[:=]\s*(?:DONE|CANCELED|ERROR|COMPLETED|FAILED|KILLED|STOPPED)|not running|not found|unknown task|finished with result/i.test(text)) {
        const failed = /Command exited with code [1-9]\d*|ERROR|FAILED/i.test(text);
        const killed = /CANCELED|KILLED|interrupted/i.test(text);
        return settle(thread, id, failed ? 'failed' : killed ? 'interrupted' : 'completed', failed ? 'failed' : killed ? 'killed' : 'completed', text, 'local_bash');
      }
      if (action === 'list' && /No running tasks|\| Start Time \| Task ID \| Tool \| Description \|/i.test(text)) {
        for (const task of getActiveTasks(thread)) {
          const present = containsTaskToken(text, task.taskId) || containsTaskToken(text, task.taskId.split('/').pop()!);
          if (task.taskType === 'local_bash' && !present) results.push(...settle(thread, task.taskId, 'completed', 'completed', text, task.taskType));
        }
      }
    }
    if (name === 'manage_subagents') {
      const empty = /no active (?:direct )?subagents/i.test(text) || /^\s*\[\s*\]\s*$/.test(text)
        || (Array.isArray(event.rawOutput) && event.rawOutput.length === 0);
      for (const task of getActiveTasks(thread)) {
        if (task.taskType !== 'local_subagent') continue;
        const kill = action === 'kill_all' || (action === 'kill' && Array.isArray(input.ConversationIds) && input.ConversationIds.includes(task.taskId));
        const line = text.split('\n').find(line => containsTaskToken(line, task.taskId));
        if (kill || (action === 'list' && (empty || (line && /\bidle\b|\bdone\b|\bcompleted\b|\bkilled\b|\bstopped\b/i.test(line))))) results.push(...settle(thread, task.taskId, kill ? 'interrupted' : 'completed', kill ? 'killed' : 'completed', text, task.taskType));
      }
    }
    const agent = name === 'invoke_subagent';
    const raw = event.rawOutput as Record<string, unknown> | undefined;
    const spawnedId = /\bSubagent spawned\b/i.test(text) ? /\bconversationId:[ \t]*([^\s,]+)/i.exec(text)?.[1] : undefined;
    const id = agent ? first(raw?.conversationId, /"conversationId"\s*:\s*"([^"]+)"/.exec(text)?.[1], spawnedId)
      : /^(run_command|schedule)$/.test(name) ? first(/Tool is running as a background task with task id:[ \t]*([^\s\r\n][^\r\n]*)/.exec(text)?.[1], /Background command ID:[ \t]*([^\s\r\n][^\r\n]*)/.exec(text)?.[1]) : '';
    if (!id) return results;
    const title = /^(run_command|schedule|invoke_subagent)$/.test(event.title ?? '') ? '' : event.title;
    const outputFile = first(/Task logs are available at:[ \t]*([^\s\r\n][^\r\n]*)/.exec(text)?.[1]);
    const task: BackgroundTask = { taskId: id, taskType: agent ? 'local_subagent' : 'local_bash', parentToolCallId: event.toolCallId,
      description: agent ? first(input.Role, input.TypeName, title, id) : first(input.toolSummary, /Task Description:[ \t]*([^\s\r\n][^\r\n]*)/.exec(text)?.[1], input.CommandLine, input.command, input.Prompt, title, id),
      ...(outputFile ? { outputFile: normalizeFileUri(outputFile), transcriptPath: deriveTranscriptPathFromLogFile(outputFile) ?? undefined } : {}), startedAt: Date.now() };
    const tasks = threads.get(thread) ?? new Map<string, BackgroundTask>();
    if (tasks.has(taskKey(task))) return results;
    tasks.set(taskKey(task), task); threads.set(thread, tasks);
    touchedThreads.add(thread); persistState();
    if (task.transcriptPath && interval > 0) {
      const paths = watchers.get(thread) ?? new Map();
      if (!paths.has(task.transcriptPath)) {
        let offset = 0;
        try { offset = statSync(task.transcriptPath).size; } catch { /* Start at zero when the file appears. */ }
        paths.set(task.transcriptPath, { offset, partial: '', decoder: new StringDecoder('utf8') });
      }
      watchers.set(thread, paths);
      if (!timer) { timer = setInterval(poll, interval); timer.unref(); }
    }
    return [...results, delta(task)];
  }
  function getActiveTasks(thread: string): ReadonlyArray<BackgroundTask> { return [...(threads.get(thread)?.values() ?? [])].map(task => ({ ...task })); }
  function clearThread(thread: string, emitCloseDeltas = false): BackgroundTaskDelta[] {
    const results = emitCloseDeltas ? getActiveTasks(thread).map(task => delta(task, 'interrupted', 'stopped')) : [];
    threads.delete(thread); threadTools.delete(thread); streamBuffers.delete(thread); silentTurns.delete(thread); syncPolling();
    touchedThreads.add(thread); persistState(); return results;
  }
  // Startup load: snapshot which records predate this host process (only those are eligible for
  // reconciliation) and flush a GC pass so records older than the max age cannot accumulate
  // across restarts, even if no traffic ever arrives. Persisted records are intentionally NOT
  // dropped on dispose(): a graceful host exit is indistinguishable from a crash here, and the
  // next resume must still report the tasks as interrupted.
  const initialRecordKeys = new Set<string>();
  if (persistPath) {
    for (const record of readTaskState(persistPath, maxAge)) initialRecordKeys.add(`${record.threadId}\u0000${record.taskId}`);
    persistState();
  }
  return {
    recordToolEvent(event: RecordedToolEvent) {
      if (disposed) return;
      const queue = pending.get(event.toolCallId) ?? [];
      queue.push(event);
      pending.set(event.toolCallId, queue);
    },
    handleToolEventForThread, inspectTextForCompletions, getActiveTasks, clearThread,
    processStdoutLine(line: string): string[] {
      let message;
      try { message = JSON.parse(line); } catch { return [line]; }
      const params = message?.params;
      if (message?.method !== 'thread/delta' || typeof params?.threadId !== 'string' || !Array.isArray(params.deltas)) return [line];
      const extra: BackgroundTaskDelta[] = [];
      // Injected silent-turn warnings must precede the turn boundary in the delta list
      // (after the boundary the host has already closed the turn and would drop them),
      // so the outgoing deltas are rebuilt instead of blindly appended.
      const ordered: unknown[] = [];
      let boundarySeen = false;
      for (const entry of params.deltas) {
        const update = entry?.noTurnFallback?.raw?.params?.update;
        const id = entry?.key?.providerItemId ?? update?.toolCallId;
        if (typeof id === 'string') {
          const queue = pending.get(id);
          const queued = queue?.shift();
          if (!queue?.length) pending.delete(id);
          // The fallback update belongs to this exact thread; prefer it over the unscoped hook.
          const event = update && typeof update === 'object' ? { ...update, toolCallId: id } as RecordedToolEvent : queued;
          if (event) {
            const tools = threadTools.get(params.threadId) ?? new Map<string, RecordedToolEvent>();
            const merged = mergeToolEvent(tools.get(id), event);
            tools.set(id, merged); threadTools.set(params.threadId, tools);
            if (merged.status === 'completed' || merged.status === 'failed' || entry?.kind === 'item.close') {
              extra.push(...handleToolEventForThread(params.threadId, merged));
            }
          }
        }
        if (entry?.kind === 'item.textDelta' && typeof entry.text === 'string') {
          streamBuffers.set(params.threadId, (streamBuffers.get(params.threadId) ?? '') + entry.text);
          // Visible agent text (not reasoning) marks the turn as non-silent.
          if (entry.text.trim() && entry.channel !== 'reasoningText' && entry.channel !== 'reasoningSummary') {
            silentState(params.threadId).agentText = true;
          }
        } else if (typeof entry?.text === 'string') {
          extra.push(...inspectTextForCompletions(params.threadId, entry.text));
        }
        if (entry?.kind === 'item.textClose' || entry?.kind === 'turn.boundary') {
          const buffered = streamBuffers.get(params.threadId);
          streamBuffers.delete(params.threadId);
          if (buffered) extra.push(...inspectTextForCompletions(params.threadId, buffered));
        }
        if (entry?.kind === 'item.textClose' && typeof entry.text === 'string' && entry.text.trim() && entry.channel !== 'reasoningText' && entry.channel !== 'reasoningSummary') {
          silentState(params.threadId).agentText = true;
        }
        if (entry?.kind === 'item.open' && entry?.item?.type === 'agentMessage' && typeof entry.item.text === 'string' && entry.item.text.trim()) {
          silentState(params.threadId).agentText = true;
        }
        if (entry?.kind === 'item.close' && entry?.status === 'failed' && (entry?.item?.type === 'command' || entry?.key?.channel === 'command')) {
          // Failed command item with empty/whitespace-only output: the "silent give-up" signature.
          const outputs = [entry?.item?.aggregatedOutput, entry?.aggregatedOutput, entry?.resultText];
          if (outputs.every(value => value == null || (typeof value === 'string' && value.trim() === ''))) {
            silentState(params.threadId).emptyFailedCommand = true;
          }
        }
        if (entry?.kind === 'turn.boundary' && !boundarySeen) {
          boundarySeen = true;
          const injectedText = handleTurnBoundary(params.threadId, entry?.status);
          if (typeof injectedText === 'string') ordered.push(...silentTurnInjection(injectedText));
        }
        ordered.push(entry);
        for (const text of [entry?.resultText, entry?.aggregatedOutput, entry?.message, entry?.delta?.text, entry?.item?.output, entry?.item?.text]) {
          if (typeof text === 'string') extra.push(...inspectTextForCompletions(params.threadId, text));
        }
      }
      ordered.push(...extra);
      if (ordered.length === params.deltas.length) return [line];
      params.deltas = ordered; return [JSON.stringify(message)];
    },
    handleInboundRequest(request: unknown): BackgroundTaskDelta[] {
      const message = request as { method?: string; params?: { threadId?: string } } | null;
      if (!message || typeof message.params?.threadId !== 'string') return [];
      if (/^(thread\/stop|thread\/discard)$/.test(message.method ?? '')) return clearThread(message.params.threadId, true);
      // Restart reconciliation hook: BB re-issues `thread/resume` (and a `turn/start` for the
      // resumed turn) to every connected host, so this runs exactly once per resumed thread and
      // before the CLI sees the resume. Cleaner than keying off processStdoutLine activity,
      // which also arrives mid-turn for cases that are not resumes at all.
      if (/^(thread\/resume|turn\/start)$/.test(message.method ?? '')) return reconcilePersisted(message.params.threadId);
      return [];
    },
    dispose() { disposed = true; threads.clear(); pending.clear(); threadTools.clear(); streamBuffers.clear(); silentTurns.clear(); watchers.clear(); if (timer) clearInterval(timer); timer = undefined; },
  };
}
