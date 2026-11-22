import { inferAntigravityToolName, parseAntigravityCommandOutput } from "./dialect.ts";

export const SDK_AGENT_TURN_QUIET_MS = 5_000;
export const DEFAULT_AGENT_TURN_QUIET_MS = 30_000;
export const MIN_AGENT_TURN_QUIET_MS = 5_000;
export const MAX_AGENT_TURN_QUIET_MS = 300_000;

export interface ToolSnapshot {
  toolCallId: string;
  toolName?: string;
  title?: string;
  kind?: string;
  status?: string;
  rawInput?: Record<string, unknown>;
  rawOutput?: unknown;
  content?: unknown;
}

interface PromotedToolRecord {
  threadId: string;
  toolCallId: string;
  taskType: "local_bash" | "local_subagent";
  description: string;
  providerItemId: string;
  presentation: Record<string, unknown>;
}

interface ThreadTurnState {
  agentTurnQuietMs: number;
  pendingUserTurnStart: boolean;
  turnOpen: boolean;
  turnSource: "user" | "agent" | null;
  hasAsyncBackgroundActivity: boolean;
  stopRequested: boolean;
  heldBoundary: Record<string, unknown> | null;
  holdTimer: ReturnType<typeof setTimeout> | undefined;
  lastAsyncActivityAt: number;
}

const TERMINAL_TOOL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const PROMOTABLE_TOOLS = new Set(["run_command", "schedule", "invoke_subagent"]);

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clampQuietMs(seconds: unknown): number {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) {
    return DEFAULT_AGENT_TURN_QUIET_MS;
  }
  const ms = Math.round(seconds * 1000);
  return Math.min(MAX_AGENT_TURN_QUIET_MS, Math.max(MIN_AGENT_TURN_QUIET_MS, ms));
}

function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractText).filter(Boolean).join("\n");
  if (isRecord(value)) {
    return ["text", "content", "output", "stdout", "stderr"]
      .filter((k) => k in value)
      .map((k) => extractText(value[k]))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function describeTool(snapshot: ToolSnapshot | undefined, deltaEntry: Record<string, any>): {
  taskType: "local_bash" | "local_subagent";
  description: string;
  toolName: string;
} {
  const item = isRecord(deltaEntry.item) ? deltaEntry.item : {};
  const presentation = isRecord(deltaEntry.presentation) ? deltaEntry.presentation : {};
  const toolName =
    snapshot?.toolName ??
    (item.type === "delegation"
      ? "invoke_subagent"
      : item.type === "command"
        ? "run_command"
        : typeof item.tool === "string"
          ? item.tool
          : "run_command");
  const isAgent = toolName === "invoke_subagent" || item.type === "delegation";
  const rawInput = snapshot?.rawInput ?? {};
  const candidates = [
    rawInput.toolSummary,
    rawInput.Role,
    rawInput.TypeName,
    presentation.title,
    rawInput.CommandLine,
    rawInput.command,
    item.command,
    rawInput.Prompt,
    snapshot?.title,
    snapshot?.toolCallId,
  ];
  const description =
    candidates.find((v): v is string => typeof v === "string" && v.trim().length > 0)?.trim() ??
    toolName;
  return {
    taskType: isAgent ? "local_subagent" : "local_bash",
    description,
    toolName,
  };
}

function buildPromotedDelta(
  record: PromotedToolRecord,
  close?: {
    status: "completed" | "failed" | "interrupted";
    taskStatus: string;
    summary?: string;
  },
): Record<string, unknown> {
  return {
    kind: close ? "item.close" : "item.open",
    ...(close ? { status: close.status } : { attach: "currentOrLast" as const }),
    key: {
      providerItemId: record.providerItemId,
      parentRef: record.toolCallId,
    },
    item: {
      type: "backgroundTask",
      familyId: record.toolCallId,
      taskType: record.taskType,
      description: record.description,
      status: close ? close.status : "pending",
      taskStatus: close ? close.taskStatus : "running",
      skipTranscript: true,
      foreground: false,
      ...(close?.summary ? { summary: close.summary } : {}),
    },
    presentation: record.presentation,
  };
}

function parseToolOutcomeFromEvent(
  event: Record<string, any>,
  fallbackStatus?: unknown,
): { status: "completed" | "failed" | "interrupted"; taskStatus: string; summary?: string } {
  const rawStatus = typeof event.status === "string" ? event.status : undefined;
  const text = [extractText(event.content), extractText(event.rawOutput)].filter(Boolean).join("\n");
  const parsed = text ? parseAntigravityCommandOutput(text) : null;
  const cleanSummary = parsed?.cleanOutput.trim() || text.trim() || undefined;
  if (rawStatus === "cancelled" || fallbackStatus === "interrupted") {
    return { status: "interrupted", taskStatus: "killed", ...(cleanSummary ? { summary: cleanSummary } : {}) };
  }
  const failed =
    rawStatus === "failed" ||
    fallbackStatus === "failed" ||
    (parsed?.exitCode !== null && parsed?.exitCode !== undefined && parsed.exitCode !== 0);
  if (failed) {
    return { status: "failed", taskStatus: "failed", ...(cleanSummary ? { summary: cleanSummary } : {}) };
  }
  return { status: "completed", taskStatus: "completed", ...(cleanSummary ? { summary: cleanSummary } : {}) };
}

/**
 * Stabilizes ACP turn boundaries and backgrounded tool lifecycles for Antigravity CLI:
 * 1) Promotes unfinished in_progress tool calls interrupted by early `session/prompt` return
 *    into BB `backgroundTask` items and settles them cleanly when late `tool_call_update` arrives.
 * 2) Extends the SDK's hardcoded 5s `AGENT_TURN_QUIET_MS` window for async agent turns and
 *    coalesces resumed `turn.open` events so BB threads stay continuously active until truly quiet.
 */
export function createTurnStabilityController(options: {
  onFlushBoundary?: (threadId: string, boundary: Record<string, unknown>) => void;
  hasActiveBackgroundTasks?: (threadId: string) => boolean;
  now?: () => number;
} = {}) {
  const now = options.now ?? Date.now;
  const threads = new Map<string, ThreadTurnState>();
  const acpTools = new Map<string, ToolSnapshot>();
  const openItems = new Map<string, { threadId: string; itemType: string; description: string; taskType: "local_bash" | "local_subagent"; toolName: string }>();
  const promotedTools = new Map<string, PromotedToolRecord>();

  function getOrCreateThread(threadId: string): ThreadTurnState {
    let state = threads.get(threadId);
    if (!state) {
      state = {
        agentTurnQuietMs: DEFAULT_AGENT_TURN_QUIET_MS,
        pendingUserTurnStart: false,
        turnOpen: false,
        turnSource: null,
        hasAsyncBackgroundActivity: false,
        stopRequested: false,
        heldBoundary: null,
        holdTimer: undefined,
        lastAsyncActivityAt: 0,
      };
      threads.set(threadId, state);
    }
    return state;
  }

  function clearHoldTimer(state: ThreadTurnState): void {
    if (state.holdTimer !== undefined) {
      clearTimeout(state.holdTimer);
      state.holdTimer = undefined;
    }
  }

  function releasePromotedToolsForThread(threadId: string): Array<Record<string, unknown>> {
    const closes: Array<Record<string, unknown>> = [];
    for (const [toolCallId, record] of promotedTools) {
      if (record.threadId !== threadId) continue;
      promotedTools.delete(toolCallId);
      closes.push(
        buildPromotedDelta(record, {
          status: "interrupted",
          taskStatus: "stopped",
        }),
      );
    }
    return closes;
  }

  function clearThreadState(threadId: string): void {
    const state = threads.get(threadId);
    if (state) {
      clearHoldTimer(state);
      threads.delete(threadId);
    }
    for (const [toolCallId, open] of openItems) {
      if (open.threadId === threadId) openItems.delete(toolCallId);
    }
    for (const [toolCallId, promoted] of promotedTools) {
      if (promoted.threadId === threadId) promotedTools.delete(toolCallId);
    }
  }

  function countPromotedForThread(threadId: string): number {
    let count = 0;
    for (const record of promotedTools.values()) {
      if (record.threadId === threadId) count += 1;
    }
    return count;
  }

  function armHoldTimer(threadId: string, state: ThreadTurnState, boundary: Record<string, unknown>, extraHoldMs: number): void {
    clearHoldTimer(state);
    state.heldBoundary = boundary;
    const timer = setTimeout(() => {
      if (state.holdTimer !== timer || state.heldBoundary !== boundary) return;
      state.holdTimer = undefined;
      state.heldBoundary = null;
      state.turnOpen = false;
      state.turnSource = null;
      state.hasAsyncBackgroundActivity = false;
      options.onFlushBoundary?.(threadId, boundary);
    }, extraHoldMs);
    timer.unref?.();
    state.holdTimer = timer;
  }

  function noteToolUpdate(event: ToolSnapshot): void {
    if (!event?.toolCallId) return;
    if (acpTools.size > 1000) acpTools.clear();
    const prev = acpTools.get(event.toolCallId);
    const merged: ToolSnapshot = {
      ...prev,
      ...event,
      title: event.title ?? prev?.title,
      kind: event.kind ?? prev?.kind,
      status: event.status ?? prev?.status,
      rawInput:
        isRecord(prev?.rawInput) && isRecord(event.rawInput)
          ? { ...prev.rawInput, ...event.rawInput }
          : event.rawInput ?? prev?.rawInput,
      rawOutput: event.rawOutput ?? prev?.rawOutput,
      content: event.content ?? prev?.content,
    };
    const inferred = inferAntigravityToolName(merged as any);
    if (inferred) merged.toolName = inferred;
    acpTools.set(event.toolCallId, merged);
  }

  function handleInboundRequest(request: unknown): {
    flushDeltas: Array<{ threadId: string; deltas: Array<Record<string, unknown>> }>;
  } {
    const flushDeltas: Array<{ threadId: string; deltas: Array<Record<string, unknown>> }> = [];
    if (!isRecord(request)) return { flushDeltas };
    const method = typeof request.method === "string" ? request.method : "";
    const params = isRecord(request.params) ? request.params : null;
    const threadId = typeof params?.threadId === "string" ? params.threadId : null;
    if (!threadId) return { flushDeltas };

    const reqOptions = isRecord(params?.options) ? params.options : null;
    const providerOptions = isRecord(reqOptions?.providerOptions) ? reqOptions.providerOptions : null;

    if (method === "thread/start" || method === "thread/resume" || method === "thread/fork") {
      clearThreadState(threadId);
      const state = getOrCreateThread(threadId);
      if (providerOptions && "agentTurnQuietSeconds" in providerOptions) {
        state.agentTurnQuietMs = clampQuietMs(providerOptions.agentTurnQuietSeconds);
      }
      return { flushDeltas };
    }

    if (method === "turn/start") {
      const state = getOrCreateThread(threadId);
      if (providerOptions && "agentTurnQuietSeconds" in providerOptions) {
        state.agentTurnQuietMs = clampQuietMs(providerOptions.agentTurnQuietSeconds);
      }
      state.stopRequested = false;
      if (state.heldBoundary) {
        const boundary = state.heldBoundary;
        clearHoldTimer(state);
        state.heldBoundary = null;
        state.turnOpen = false;
        state.turnSource = null;
        state.hasAsyncBackgroundActivity = false;
        flushDeltas.push({ threadId, deltas: [boundary] });
      }
      state.pendingUserTurnStart = true;
      return { flushDeltas };
    }

    if (method === "turn/steer") {
      const state = getOrCreateThread(threadId);
      if (state.heldBoundary) {
        const boundary = state.heldBoundary;
        clearHoldTimer(state);
        state.heldBoundary = null;
        state.turnOpen = false;
        state.turnSource = null;
        state.hasAsyncBackgroundActivity = false;
        flushDeltas.push({ threadId, deltas: [boundary] });
      }
      return { flushDeltas };
    }

    if (method === "thread/stop" || method === "thread/discard") {
      const state = threads.get(threadId);
      const intent = typeof params?.intent === "string" ? params.intent : undefined;
      if (state) {
        state.stopRequested = true;
        const deltas: Array<Record<string, unknown>> = [];
        if (intent !== "release") {
          deltas.push(...releasePromotedToolsForThread(threadId));
        }
        if (state.heldBoundary) {
          const boundary = state.heldBoundary;
          clearHoldTimer(state);
          state.heldBoundary = null;
          if (intent !== "release") {
            deltas.push({ ...boundary, status: "interrupted" });
          }
        }
        if (deltas.length > 0) {
          flushDeltas.push({ threadId, deltas });
        }
        clearThreadState(threadId);
      } else {
        const deltas = intent !== "release" ? releasePromotedToolsForThread(threadId) : [];
        if (deltas.length > 0) {
          flushDeltas.push({ threadId, deltas });
        }
      }
      return { flushDeltas };
    }

    return { flushDeltas };
  }

  function processStdoutLine(line: string): string[] {
    let message: any;
    try {
      message = JSON.parse(line);
    } catch {
      return [line];
    }
    if (message?.method !== "thread/delta" || typeof message?.params?.threadId !== "string" || !Array.isArray(message.params.deltas)) {
      return [line];
    }

    const threadId = message.params.threadId as string;
    const state = getOrCreateThread(threadId);
    const incoming: Array<Record<string, any>> = message.params.deltas;
    const rewritten: Array<Record<string, any>> = [];
    let modified = false;

    // Detect delayed terminal tool updates for any promoted backgrounded tool first.
    for (const delta of incoming) {
      if (!isRecord(delta)) {
        rewritten.push(delta);
        continue;
      }

      if (delta.kind === "turn.open") {
        if (state.heldBoundary) {
          clearHoldTimer(state);
          state.heldBoundary = null;
          state.turnOpen = true;
          modified = true;
          continue; // Drop duplicate turn.open so BB stays inside the held turn.
        }
        state.turnOpen = true;
        if (state.pendingUserTurnStart) {
          state.pendingUserTurnStart = false;
          state.turnSource = "user";
          state.hasAsyncBackgroundActivity =
            now() - state.lastAsyncActivityAt < 10_000 ||
            countPromotedForThread(threadId) > 0 ||
            (options.hasActiveBackgroundTasks?.(threadId) ?? false);
        } else {
          state.turnSource = "agent";
          state.hasAsyncBackgroundActivity = true;
        }
        rewritten.push(delta);
        continue;
      }

      const rawFallbackUpdate = delta.noTurnFallback?.raw?.params?.update;
      const fallbackRawType = delta.noTurnFallback?.rawType ?? delta.rawType;
      const providerItemId =
        (isRecord(delta.key) && typeof delta.key.providerItemId === "string"
          ? delta.key.providerItemId
          : undefined) ??
        (typeof rawFallbackUpdate?.toolCallId === "string" ? rawFallbackUpdate.toolCallId : undefined);

      // Delayed terminal update outside prompt (`unhandled` or `item.close` with `noTurnFallback`)
      if (
        providerItemId &&
        promotedTools.has(providerItemId) &&
        ((delta.kind === "unhandled" && fallbackRawType === "acp/update:tool_call_update") ||
          (delta.kind === "item.close" && delta.noTurnFallback?.rawType === "acp/update:tool_call_update"))
      ) {
        const promoted = promotedTools.get(providerItemId)!;
        promotedTools.delete(providerItemId);
        const rawUpdate = isRecord(rawFallbackUpdate)
          ? rawFallbackUpdate
          : isRecord(delta.raw?.params?.update)
            ? delta.raw.params.update
            : (acpTools.get(providerItemId) ?? {});
        const outcome = parseToolOutcomeFromEvent(rawUpdate, delta.status);
        state.lastAsyncActivityAt = now();
        state.hasAsyncBackgroundActivity = true;
        if (state.heldBoundary) {
          const extraHoldMs = Math.max(0, state.agentTurnQuietMs - SDK_AGENT_TURN_QUIET_MS);
          if (extraHoldMs > 0) {
            armHoldTimer(threadId, state, state.heldBoundary, extraHoldMs);
          }
        }
        rewritten.push(buildPromotedDelta(promoted, outcome));
        modified = true;
        continue;
      }

      if (delta.kind === "item.open" && isRecord(delta.item)) {
        if (state.heldBoundary) {
          clearHoldTimer(state);
          state.heldBoundary = null;
          state.turnOpen = true;
        }
        if (delta.item.type === "backgroundTask") {
          state.hasAsyncBackgroundActivity = true;
          state.lastAsyncActivityAt = now();
        } else if (providerItemId) {
          const snapshot = acpTools.get(providerItemId);
          const info = describeTool(snapshot, delta);
          openItems.set(providerItemId, {
            threadId,
            itemType: String(delta.item.type ?? ""),
            ...info,
          });
        }
        rewritten.push(delta);
        continue;
      }

      if (delta.kind === "item.close" && providerItemId && isRecord(delta.item) && delta.item.type !== "backgroundTask") {
        const openInfo = openItems.get(providerItemId);
        openItems.delete(providerItemId);
        const snapshot = acpTools.get(providerItemId);
        const lastStatus = snapshot?.status;
        const toolName = openInfo?.toolName ?? snapshot?.toolName ?? "";
        // If SDK forced status "interrupted" on session/prompt return while ACP tool status
        // was still non-terminal, promote it to a live BB backgroundTask.
        if (
          delta.status === "interrupted" &&
          !state.stopRequested &&
          PROMOTABLE_TOOLS.has(toolName) &&
          (!lastStatus || !TERMINAL_TOOL_STATUSES.has(lastStatus))
        ) {
          const desc = openInfo ?? describeTool(snapshot, delta);
          const promoted: PromotedToolRecord = {
            threadId,
            toolCallId: providerItemId,
            taskType: desc.taskType,
            description: desc.description,
            providerItemId: `bg-tool:${providerItemId}`,
            presentation: {
              label: {
                pending: desc.taskType === "local_subagent" ? "Running background agent" : "Running background command",
                completed: desc.taskType === "local_subagent" ? "Background agent finished" : "Background command finished",
              },
              icon: { glyph: desc.taskType === "local_subagent" ? "Bot" : "Terminal" },
              title: desc.description,
            },
          };
          promotedTools.set(providerItemId, promoted);
          state.hasAsyncBackgroundActivity = true;
          state.lastAsyncActivityAt = now();
          rewritten.push(delta);
          rewritten.push(buildPromotedDelta(promoted));
          modified = true;
          continue;
        }
        rewritten.push(delta);
        continue;
      }

      if (delta.kind === "turn.boundary") {
        const extraHoldMs = Math.max(0, state.agentTurnQuietMs - SDK_AGENT_TURN_QUIET_MS);
        const hasBg =
          state.hasAsyncBackgroundActivity ||
          countPromotedForThread(threadId) > 0 ||
          (options.hasActiveBackgroundTasks?.(threadId) ?? false);
        const shouldHold =
          !state.stopRequested &&
          delta.status === "completed" &&
          extraHoldMs > 0 &&
          (state.turnSource === "agent" || hasBg);

        if (shouldHold) {
          armHoldTimer(threadId, state, delta, extraHoldMs);
          modified = true;
          continue;
        }

        clearHoldTimer(state);
        state.heldBoundary = null;
        state.turnOpen = false;
        state.turnSource = null;
        state.hasAsyncBackgroundActivity = false;
        rewritten.push(delta);
        continue;
      }

      if (delta.kind === "item.textDelta" && state.heldBoundary) {
        clearHoldTimer(state);
        state.heldBoundary = null;
        state.turnOpen = true;
      }

      rewritten.push(delta);
    }

    if (rewritten.length === 0) return [];
    if (!modified) return [line];
    message.params.deltas = rewritten;
    return [JSON.stringify(message)];
  }

  function dispose(): void {
    for (const state of threads.values()) {
      clearHoldTimer(state);
    }
    threads.clear();
    acpTools.clear();
    openItems.clear();
    promotedTools.clear();
  }

  return {
    noteToolUpdate,
    handleInboundRequest,
    processStdoutLine,
    dispose,
    getPromotedToolCount: (threadId: string) => countPromotedForThread(threadId),
    hasHeldBoundary: (threadId: string) => Boolean(threads.get(threadId)?.heldBoundary),
  };
}
