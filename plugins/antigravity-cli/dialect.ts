import {
  experimental_registerAcpDialect,
  type AcpDialect,
  type AcpToolCallUpdateEvent,
  type AcpToolIdentity,
  type AcpToolKind,
} from "@get-bb/plugin-sdk/provider-bridge/acp";

export type AcpToolUpdateEvent = AcpToolCallUpdateEvent;

export interface AcpDialectToolIdentity {
  name?: string;
  kind?: AcpToolKind;
}

export interface DialectPresentationBadge {
  label: string;
  tone: "destructive" | "neutral";
  glyph?: string;
  hint?: string;
}

export interface DialectPresentation {
  label: {
    pending: string;
    completed: string;
  };
  icon: {
    glyph: string;
  };
  title?: string;
  subtitle?: string;
  detail?: string;
  badge?: {
    glyph: string;
    label: string;
    hint: string;
    tone: "destructive" | "neutral";
  };
  badges?: DialectPresentationBadge[];
}

const PRESENTATION_DETAIL_MAX_LENGTH = 280;

function truncatePresentationDetail(text: string): string {
  return text.length > PRESENTATION_DETAIL_MAX_LENGTH
    ? `${text.slice(0, PRESENTATION_DETAIL_MAX_LENGTH - 3)}...`
    : text;
}

export type AcpDialectToolClassification =
  | {
      kind: "command";
      presentation: DialectPresentation;
      item?: Record<string, unknown>;
    }
  | {
      kind: "delegation";
      label: string;
      detail?: string | null;
      background: boolean;
      childRef?: string;
      presentation: DialectPresentation;
      item?: Record<string, unknown>;
    }
  | {
      kind: "tool_use";
      tool: string;
      detail?: string | null;
      presentation: DialectPresentation;
      item?: Record<string, unknown>;
    };

export const ANTIGRAVITY_ACP_DIALECT_ID = "antigravity";

export const CANONICAL_ANTIGRAVITY_TOOLS: ReadonlySet<string> = new Set([
  // Execution
  "run_command",
  // File reading
  "read_file",
  "view_file",
  "view_file_outline",
  "view_code_item",
  "list_dir",
  "list_resources",
  "read_resource",
  // File editing
  "write_file",
  "edit_file",
  "replace_file_content",
  "multi_replace_file_content",
  // Search
  "grep_search",
  "code_search",
  "find_by_name",
  // Web / Fetch
  "search_web",
  "read_url_content",
  // Subagents
  "invoke_subagent",
  "define_subagent",
  "manage_subagents",
  "send_message",
  // Background tasks & scheduling
  "manage_task",
  "schedule",
  // User interaction
  "ask_question",
]);

// Configuration
let commandDescriptionsEnabled = true;

export function getCommandDescriptionsEnabled(): boolean {
  return commandDescriptionsEnabled;
}

export function setCommandDescriptionsEnabled(enabled: boolean): void {
  commandDescriptionsEnabled = enabled;
}

export function applyThreadCommandDescriptions(
  line: string,
  enabledByThread: ReadonlyMap<string, boolean>
): string {
  let message: any;
  try {
    message = JSON.parse(line);
  } catch {
    return line;
  }

  const params = message?.params;
  if (
    message?.method !== "thread/delta" ||
    typeof params?.threadId !== "string" ||
    !Array.isArray(params.deltas)
  ) {
    return line;
  }

  const enabled = enabledByThread.get(params.threadId) ?? getCommandDescriptionsEnabled();
  let modified = false;

  for (const delta of params.deltas) {
    if (delta?.item?.type === "command" && delta?.presentation && typeof delta.presentation === "object") {
      if (
        !enabled &&
        typeof delta.item.command === "string" &&
        delta.item.command.length > 0 &&
        (delta.presentation.subtitle === delta.item.command ||
          delta.presentation.detail === truncatePresentationDetail(delta.item.command))
      ) {
        delta.presentation.title = delta.item.command;
        delete delta.presentation.subtitle;
        delete delta.presentation.detail;
        modified = true;
      }
    }
  }

  return modified ? JSON.stringify(message) : line;
}

function extractEventOutputText(event: AcpToolUpdateEvent): string {
  const parts: string[] = [];
  function collect(val: unknown) {
    if (typeof val === "string") {
      parts.push(val);
    } else if (Array.isArray(val)) {
      for (const item of val) collect(item);
    } else if (val && typeof val === "object") {
      const obj = val as Record<string, unknown>;
      if (typeof obj.text === "string") parts.push(obj.text);
      if (typeof obj.output === "string") parts.push(obj.output);
      if (typeof obj.content === "string") parts.push(obj.content);
      if (typeof obj.stdout === "string") parts.push(obj.stdout);
      if (typeof obj.stderr === "string") parts.push(obj.stderr);
      if (obj.content && typeof obj.content === "object" && obj.content !== null) {
        collect(obj.content);
      }
    }
  }
  if (event.content !== undefined) collect(event.content);
  if (event.rawOutput !== undefined) collect(event.rawOutput);
  return parts.join("\n");
}

// Event hook & deduplication
type ToolUpdateListener = (event: AcpToolUpdateEvent) => void;
const toolUpdateListeners = new Set<ToolUpdateListener>();
const lastNotifiedSteps = new Map<string, { stepKey: string; hasInput: boolean; hasTitle: boolean; outputText: string }>();
const normalizedExitCodes = new WeakMap< object, number >();

export function onToolUpdate(listener: ToolUpdateListener): () => void {
  toolUpdateListeners.add(listener);
  return () => {
    toolUpdateListeners.delete(listener);
  };
}

export function setToolUpdateListener(listener: ToolUpdateListener | null): void {
  toolUpdateListeners.clear();
  if (listener) {
    toolUpdateListeners.add(listener);
  }
}

function notifyToolUpdate(event: AcpToolUpdateEvent): void {
  if (toolUpdateListeners.size === 0) return;
  const toolCallId = event.toolCallId;
  const status = event.status ?? "";
  const stepKey = `${toolCallId}:${status}`;
  const hasInput = Boolean(event.rawInput && typeof event.rawInput === "object" && Object.keys(event.rawInput).length > 0);
  const hasTitle = typeof event.title === "string" && event.title.length > 0;
  const outputText = extractEventOutputText(event);

  if (toolCallId) {
    const prev = lastNotifiedSteps.get(toolCallId);
    if (
      prev &&
      prev.stepKey === stepKey &&
      (prev.hasInput || !hasInput) &&
      (prev.hasTitle || !hasTitle) &&
      prev.outputText === outputText
    ) {
      return;
    }
    if (lastNotifiedSteps.size > 1000) {
      lastNotifiedSteps.clear();
    }
    lastNotifiedSteps.set(toolCallId, {
      stepKey,
      hasInput: Boolean(prev?.hasInput || hasInput),
      hasTitle: Boolean(prev?.hasTitle || hasTitle),
      outputText,
    });
  }

  for (const listener of toolUpdateListeners) {
    try {
      listener(event);
    } catch {
      // Ignore listener failures
    }
  }
}

// Tool name inference
function normalizeToolCandidate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (CANONICAL_ANTIGRAVITY_TOOLS.has(trimmed)) {
    return trimmed;
  }
  const underscored = trimmed.replace(/\s+/g, "_");
  if (CANONICAL_ANTIGRAVITY_TOOLS.has(underscored)) {
    return underscored;
  }
  return null;
}

export function inferAntigravityToolName(event: AcpToolUpdateEvent): string | null {
  if (!event || typeof event !== "object") return null;

  // 1. Check event._meta
  const meta = (event as Record<string, unknown>)._meta;
  if (meta && typeof meta === "object") {
    const metaObj = meta as Record<string, unknown>;
    const metaName =
      normalizeToolCandidate(metaObj.tool) ??
      normalizeToolCandidate(metaObj.name) ??
      normalizeToolCandidate(metaObj.toolName) ??
      normalizeToolCandidate(metaObj.tool_name) ??
      (metaObj["x.ai/tool"] && typeof metaObj["x.ai/tool"] === "object"
        ? normalizeToolCandidate((metaObj["x.ai/tool"] as Record<string, unknown>).name)
        : null);
    if (metaName) return metaName;
  }

  // Check event.name if present
  if (typeof event.name === "string") {
    const directName = normalizeToolCandidate(event.name);
    if (directName) return directName;
  }

  // Check event.title
  if (typeof event.title === "string") {
    const directTitle = normalizeToolCandidate(event.title);
    if (directTitle) return directTitle;

    // Check prefix before colon (e.g. "run_command: npm test" or "read_file: /path")
    const colonIndex = event.title.indexOf(":");
    if (colonIndex > 0) {
      const prefix = normalizeToolCandidate(event.title.slice(0, colonIndex));
      if (prefix) return prefix;
    }
  }

  // 2. Structural inference from event.rawInput
  const rawInput = event.rawInput as Record<string, unknown> | undefined;
  if (rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)) {
    // Has CommandLine (string) -> "run_command"
    if (typeof rawInput.CommandLine === "string" || typeof rawInput.command === "string") {
      return "run_command";
    }

    // Has TypeName and Prompt (and Role) -> "invoke_subagent"
    if (typeof rawInput.TypeName === "string" && typeof rawInput.Prompt === "string") {
      return "invoke_subagent";
    }

    // Has SystemPrompt and Name and Description -> "define_subagent"
    if (
      typeof rawInput.SystemPrompt === "string" &&
      typeof rawInput.Name === "string" &&
      typeof rawInput.Description === "string"
    ) {
      return "define_subagent";
    }

    // Has Action and (ConversationIds or Action === "kill_all") -> "manage_subagents"
    if (
      typeof rawInput.Action === "string" &&
      (Array.isArray(rawInput.ConversationIds) || rawInput.Action === "kill_all")
    ) {
      return "manage_subagents";
    }

    // Has Recipient and Message -> "send_message"
    if (typeof rawInput.Recipient === "string" && typeof rawInput.Message === "string") {
      return "send_message";
    }

    // Has Action and (TaskId or Input or ["list", "kill", "status", "send_input"].includes(Action)) -> "manage_task"
    if (
      typeof rawInput.Action === "string" &&
      (typeof rawInput.TaskId === "string" ||
        rawInput.Input !== undefined ||
        ["list", "kill", "status", "send_input"].includes(rawInput.Action))
    ) {
      return "manage_task";
    }

    // Has Prompt and (DurationSeconds or CronExpression) -> "schedule"
    if (
      typeof rawInput.Prompt === "string" &&
      (typeof rawInput.DurationSeconds === "number" || typeof rawInput.CronExpression === "string")
    ) {
      return "schedule";
    }

    // Has questions (array) -> "ask_question"
    if (Array.isArray(rawInput.questions)) {
      return "ask_question";
    }

    // Has Path and (Target or Replacement) -> "edit_file"
    if (
      typeof rawInput.Path === "string" &&
      (rawInput.Target !== undefined || rawInput.Replacement !== undefined)
    ) {
      return "edit_file";
    }

    // Has Path and Content -> "write_file"
    if (typeof rawInput.Path === "string" && rawInput.Content !== undefined) {
      return "write_file";
    }

    // Has Path and (StartLine or EndLine or ByteOffset or event.kind === "read") -> "read_file"
    if (
      typeof rawInput.Path === "string" &&
      (rawInput.StartLine !== undefined ||
        rawInput.EndLine !== undefined ||
        rawInput.ByteOffset !== undefined ||
        event.kind === "read")
    ) {
      return "read_file";
    }
  }

  return null;
}

export function mapAntigravityToolKind(toolName: string | null, fallbackKind?: AcpToolKind): AcpToolKind {
  if (!toolName) return fallbackKind ?? "other";
  switch (toolName) {
    case "run_command":
      return "execute";
    case "read_file":
    case "view_file":
    case "view_file_outline":
    case "view_code_item":
    case "list_dir":
    case "list_resources":
    case "read_resource":
      return "read";
    case "write_file":
    case "edit_file":
    case "replace_file_content":
    case "multi_replace_file_content":
      return "edit";
    case "grep_search":
    case "code_search":
    case "find_by_name":
      return "search";
    case "search_web":
    case "read_url_content":
      return "fetch";
    default:
      return fallbackKind ?? "other";
  }
}

export function toolIdentity(event: AcpToolUpdateEvent): AcpDialectToolIdentity | null {
  notifyToolUpdate(event);
  const toolName = inferAntigravityToolName(event);
  if (toolName) {
    return {
      name: toolName,
      kind: mapAntigravityToolKind(toolName, event.kind as AcpToolKind),
    };
  }
  if (typeof event.name === "string" && event.name.trim()) {
    return {
      name: event.name.trim(),
      kind: mapAntigravityToolKind(event.name.trim(), event.kind as AcpToolKind),
    };
  }
  if (event.kind) {
    return {
      kind: event.kind as AcpToolKind,
    };
  }
  return null;
}

// Output and exit code parsing
const BACKGROUND_TASK_ID_RE = /^[A-Za-z0-9_][A-Za-z0-9._:/@-]*$/;

export interface AntigravityBackgroundTaskMetadata {
  exitCode: number | null;
  isBackgrounded: boolean;
  backgroundTaskId: string | null;
  taskDescription: string | null;
  taskLogFile: string | null;
}

interface ScannedCommandWrapper {
  cleanOutput: string;
  exitCode: number | null;
  isBackgrounded: boolean;
  backgroundTaskId: string | null;
  taskDescription: string | null;
  taskLogFile: string | null;
}

function parseBackgroundTaskIdCandidate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || !BACKGROUND_TASK_ID_RE.test(trimmed)) return null;
  return trimmed;
}

function scanAntigravityCommandWrapper(rawText: string): ScannedCommandWrapper {
  if (typeof rawText !== "string") {
    return {
      cleanOutput: "",
      exitCode: null,
      isBackgrounded: false,
      backgroundTaskId: null,
      taskDescription: null,
      taskLogFile: null,
    };
  }

  let exitCode: number | null = null;
  let exitCodeLine: string | null = null;
  let backgroundTaskId: string | null = null;
  let taskDescription: string | null = null;
  let taskLogFile: string | null = null;
  const diagnosticLines: string[] = [];
  const keptHeaderChunks: string[] = [];
  let sawStrippableHeader = false;
  let pendingBlankChunks: string[] = [];
  let bodyStartIndex: number | null = null;
  let scanStopPos = rawText.length;

  // Only inspect leading Antigravity wrapper header lines before the output separator
  // so arbitrary command stdout/JSONL/grep matches never trigger wrapper metadata.
  let pos = 0;
  while (pos < rawText.length) {
    const lf = rawText.indexOf("\n", pos);
    const cr = lf === -1 ? -1 : rawText.lastIndexOf("\r", lf);
    const lineEnd = lf === -1 ? rawText.length : cr === lf - 1 ? cr : lf;
    const nextPos = lf === -1 ? rawText.length : lf + 1;
    const line = rawText.slice(pos, lineEnd);
    const rawLineWithBreak = rawText.slice(pos, nextPos);

    if (/^[ \t]*$/.test(line)) {
      pendingBlankChunks.push(rawLineWithBreak);
      pos = nextPos;
      continue;
    }

    if (/^(?:Command output|Output):[ \t]*$/i.test(line)) {
      bodyStartIndex = nextPos;
      scanStopPos = nextPos;
      break;
    }

    if (/^Log output:[ \t]*$/i.test(line)) {
      scanStopPos = pos;
      break;
    }

    if (/^There were sandbox errors/i.test(line)) {
      diagnosticLines.push(line);
      sawStrippableHeader = true;
      pendingBlankChunks = [];
      pos = nextPos;
      continue;
    }

    const exitMatch = line.match(/^(?:The c|C)ommand exited with code (-?\d+)\b\.?[^\r\n]*$/);
    if (exitMatch) {
      if (exitCode === null) {
        exitCode = parseInt(exitMatch[1], 10);
        exitCodeLine = line.match(/^(?:The c|C)ommand exited with code (-?\d+)\b\.?/)?.[0] ?? line;
      }
      sawStrippableHeader = true;
      pendingBlankChunks = [];
      pos = nextPos;
      continue;
    }

    if (/^(?:Created At|Completed At):/i.test(line)) {
      sawStrippableHeader = true;
      pendingBlankChunks = [];
      pos = nextPos;
      continue;
    }

    if (/^(?:The user changed the command to be run to:|This command includes call\(s\) to)/i.test(line)) {
      if (keptHeaderChunks.length > 0 && pendingBlankChunks.length > 0) {
        keptHeaderChunks.push(...pendingBlankChunks);
      }
      pendingBlankChunks = [];
      keptHeaderChunks.push(rawLineWithBreak);
      pos = nextPos;
      continue;
    }

    const bgMatch =
      line.match(/^Tool is running as a background task with task id:[ \t]*(.+)$/i) ??
      line.match(/^Background command ID:[ \t]*(.+)$/i);
    if (bgMatch) {
      const candidate = parseBackgroundTaskIdCandidate(bgMatch[1]);
      if (!candidate) {
        scanStopPos = pos;
        break;
      }
      if (backgroundTaskId === null) backgroundTaskId = candidate;
      if (keptHeaderChunks.length > 0 && pendingBlankChunks.length > 0) {
        keptHeaderChunks.push(...pendingBlankChunks);
      }
      pendingBlankChunks = [];
      keptHeaderChunks.push(rawLineWithBreak);
      pos = nextPos;
      continue;
    }

    const descMatch = line.match(/^Task Description:[ \t]*(.+)$/i);
    if (descMatch) {
      if (taskDescription === null && descMatch[1].trim()) {
        taskDescription = descMatch[1].trim();
      }
      if (keptHeaderChunks.length > 0 && pendingBlankChunks.length > 0) {
        keptHeaderChunks.push(...pendingBlankChunks);
      }
      pendingBlankChunks = [];
      keptHeaderChunks.push(rawLineWithBreak);
      pos = nextPos;
      continue;
    }

    const logMatch = line.match(/^Task logs are available at:[ \t]*(.+)$/i);
    if (logMatch) {
      if (taskLogFile === null && logMatch[1].trim()) {
        taskLogFile = logMatch[1].trim();
      }
      if (keptHeaderChunks.length > 0 && pendingBlankChunks.length > 0) {
        keptHeaderChunks.push(...pendingBlankChunks);
      }
      pendingBlankChunks = [];
      keptHeaderChunks.push(rawLineWithBreak);
      pos = nextPos;
      continue;
    }

    scanStopPos = pos;
    break;
  }

  let cleanOutput: string;
  if (bodyStartIndex !== null) {
    cleanOutput = rawText.slice(bodyStartIndex);
  } else {
    const trailingFromHeader =
      keptHeaderChunks.length > 0 || !sawStrippableHeader ? pendingBlankChunks.join("") : "";
    cleanOutput = `${keptHeaderChunks.join("")}${trailingFromHeader}${rawText.slice(scanStopPos)}`;
  }

  // A failed command must never normalize to an empty string: when the output
  // section is empty, surface the diagnostic text (or the exit-code line it came
  // from) so the failure reason reaches BB and the model.
  if (cleanOutput.trim() === "" && (diagnosticLines.length > 0 || (exitCode !== null && exitCode !== 0))) {
    cleanOutput =
      diagnosticLines.length > 0
        ? diagnosticLines.join("\n")
        : exitCodeLine?.trim() ?? "";
  } else if (diagnosticLines.length > 0) {
    cleanOutput = `${diagnosticLines.join("\n")}\n${cleanOutput}`;
  }

  // Exited commands never run in the background, even if something header-shaped appeared.
  const effectiveBackgroundTaskId = exitCode === null ? backgroundTaskId : null;

  return {
    cleanOutput,
    exitCode,
    isBackgrounded: effectiveBackgroundTaskId !== null,
    backgroundTaskId: effectiveBackgroundTaskId,
    taskDescription,
    taskLogFile,
  };
}

export function extractAntigravityBackgroundTask(event: AcpToolUpdateEvent): AntigravityBackgroundTaskMetadata {
  if (!event || typeof event !== "object") {
    return {
      exitCode: null,
      isBackgrounded: false,
      backgroundTaskId: null,
      taskDescription: null,
      taskLogFile: null,
    };
  }

  let structuredExitCode: number | null = normalizedExitCodes.get(event) ?? null;
  if (structuredExitCode === null && event.rawOutput && typeof event.rawOutput === "object") {
    const raw = event.rawOutput as Record<string, unknown>;
    if (typeof raw.exitCode === "number" && Number.isFinite(raw.exitCode)) {
      structuredExitCode = raw.exitCode;
    } else if (typeof raw.exit_code === "number" && Number.isFinite(raw.exit_code)) {
      structuredExitCode = raw.exit_code;
    }
  }

  const parts: string[] = [];
  function collect(val: unknown) {
    if (typeof val === "string") {
      parts.push(val);
    } else if (Array.isArray(val)) {
      for (const item of val) collect(item);
    } else if (val && typeof val === "object") {
      const obj = val as Record<string, unknown>;
      if (typeof obj.text === "string") parts.push(obj.text);
      if (typeof obj.output === "string") parts.push(obj.output);
      if (typeof obj.content === "string") parts.push(obj.content);
      if (typeof obj.stdout === "string") parts.push(obj.stdout);
      if (typeof obj.stderr === "string") parts.push(obj.stderr);
      if (obj.content && typeof obj.content === "object" && obj.content !== null) {
        collect(obj.content);
      }
    }
  }
  if (event.content !== undefined) collect(event.content);
  if (event.rawOutput !== undefined) collect(event.rawOutput);

  let exitCode = structuredExitCode;
  let backgroundTaskId: string | null = null;
  let taskDescription: string | null = null;
  let taskLogFile: string | null = null;

  for (const part of parts) {
    const scanned = scanAntigravityCommandWrapper(part);
    if (exitCode === null && scanned.exitCode !== null) exitCode = scanned.exitCode;
    if (backgroundTaskId === null && scanned.backgroundTaskId !== null) backgroundTaskId = scanned.backgroundTaskId;
    if (taskDescription === null && scanned.taskDescription !== null) taskDescription = scanned.taskDescription;
    if (taskLogFile === null && scanned.taskLogFile !== null) taskLogFile = scanned.taskLogFile;
  }

  const effectiveTaskId = exitCode === null ? backgroundTaskId : null;
  return {
    exitCode,
    isBackgrounded: effectiveTaskId !== null,
    backgroundTaskId: effectiveTaskId,
    taskDescription,
    taskLogFile,
  };
}

export function parseAntigravityCommandOutput(rawText: string): {
  cleanOutput: string;
  exitCode: number | null;
  isBackgrounded: boolean;
  backgroundTaskId: string | null;
} {
  const scanned = scanAntigravityCommandWrapper(rawText);
  return {
    cleanOutput: scanned.cleanOutput,
    exitCode: scanned.exitCode,
    isBackgrounded: scanned.isBackgrounded,
    backgroundTaskId: scanned.backgroundTaskId,
  };
}

// Normalization & Command Result
export function normalizeCommandEvent(event: AcpToolUpdateEvent): AcpToolUpdateEvent {
  if (!event || typeof event !== "object") return event;

  let normalized: AcpToolUpdateEvent = { ...event };
  const rawInput = event.rawInput as Record<string, unknown> | undefined;

  if (rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)) {
    const updatedInput = { ...rawInput };
    if (typeof updatedInput.CommandLine === "string" && !updatedInput.command) {
      updatedInput.command = updatedInput.CommandLine;
    }
    normalized.rawInput = updatedInput;

    const cmd =
      typeof updatedInput.CommandLine === "string"
        ? updatedInput.CommandLine
        : typeof updatedInput.command === "string"
          ? updatedInput.command
          : undefined;

    if (cmd && (!normalized.title || normalized.title.trim().toLowerCase() === "run_command")) {
      normalized.title = cmd;
    }
  }

  // Normalize rawOutput if string or object
  let detectedExitCode: number | null = null;
  if (typeof normalized.rawOutput === "string") {
    const parsed = parseAntigravityCommandOutput(normalized.rawOutput);
    if (parsed.exitCode !== null) detectedExitCode = parsed.exitCode;
    normalized.rawOutput = parsed.cleanOutput;
  } else if (normalized.rawOutput && typeof normalized.rawOutput === "object") {
    const obj = { ...(normalized.rawOutput as Record<string, unknown>) };
    if (typeof obj.output === "string") {
      const parsed = parseAntigravityCommandOutput(obj.output);
      if (parsed.exitCode !== null) detectedExitCode = parsed.exitCode;
      obj.output = parsed.cleanOutput;
    }
    if (typeof obj.stdout === "string") {
      const parsed = parseAntigravityCommandOutput(obj.stdout);
      if (parsed.exitCode !== null) detectedExitCode = parsed.exitCode;
      obj.stdout = parsed.cleanOutput;
    }
    normalized.rawOutput = obj;
  }

  // Normalize content blocks if present
  if (Array.isArray(normalized.content)) {
    normalized.content = normalized.content.map((block: any) => {
      if (!block || typeof block !== "object") return block;
      if (block.type === "content" && block.content && typeof block.content === "object" && typeof block.content.text === "string") {
        const parsed = parseAntigravityCommandOutput(block.content.text);
        if (parsed.exitCode !== null) detectedExitCode = parsed.exitCode;
        return {
          ...block,
          content: {
            ...block.content,
            text: parsed.cleanOutput,
          },
        };
      }
      if (block.type === "text" && typeof block.text === "string") {
        const parsed = parseAntigravityCommandOutput(block.text);
        if (parsed.exitCode !== null) detectedExitCode = parsed.exitCode;
        return {
          ...block,
          text: parsed.cleanOutput,
        };
      }
      return block;
    });
  }

  if (detectedExitCode !== null) {
    normalizedExitCodes.set(normalized, detectedExitCode);
  }

  return normalized;
}

export function commandResult(event: AcpToolUpdateEvent): { exitCode?: number | null } | null {
  if (!event || typeof event !== "object") return null;

  const cachedExitCode = normalizedExitCodes.get(event);
  if (cachedExitCode !== undefined) {
    return { exitCode: cachedExitCode };
  }

  if (event.rawOutput && typeof event.rawOutput === "object") {
    const raw = event.rawOutput as Record<string, unknown>;
    const code =
      typeof raw.exitCode === "number"
        ? raw.exitCode
        : typeof raw.exit_code === "number"
          ? raw.exit_code
          : null;
    if (code !== null) {
      return { exitCode: code };
    }
  }

  const outputText = extractEventOutputText(event);
  if (outputText) {
    const parsed = parseAntigravityCommandOutput(outputText);
    if (parsed.exitCode !== null) {
      return { exitCode: parsed.exitCode };
    }
  }

  return null;
}

// Tool Classification
export function classifyToolCall(event: AcpToolUpdateEvent): AcpDialectToolClassification | null {
  notifyToolUpdate(event);
  const toolName = inferAntigravityToolName(event);
  if (!toolName) return null;

  const rawInput = (event.rawInput && typeof event.rawInput === "object" && !Array.isArray(event.rawInput)
    ? (event.rawInput as Record<string, unknown>)
    : {}) as Record<string, unknown>;

  switch (toolName) {
    case "run_command": {
      const commandLine =
        typeof rawInput.CommandLine === "string"
          ? rawInput.CommandLine
          : typeof rawInput.command === "string"
            ? rawInput.command
            : undefined;
      const toolSummary =
        typeof rawInput.toolSummary === "string"
          ? rawInput.toolSummary
          : typeof rawInput.description === "string"
            ? rawInput.description
            : undefined;
      const bypassSandbox = rawInput.BypassSandbox === true;

      const { isBackgrounded } = extractAntigravityBackgroundTask(event);

      const useToolSummary =
        getCommandDescriptionsEnabled() &&
        typeof toolSummary === "string" &&
        toolSummary.trim().length > 0;

      const presentation: DialectPresentation = {
        label: {
          pending: "Running command",
          completed: isBackgrounded ? "Started background command" : "Ran command",
        },
        icon: { glyph: "Terminal" },
        ...(useToolSummary
          ? {
              title: toolSummary!.trim(),
              ...(commandLine
                ? {
                    detail: truncatePresentationDetail(commandLine),
                    subtitle: commandLine,
                  }
                : {}),
            }
          : {
              title: commandLine || event.title || "Command",
            }),
        ...(bypassSandbox
          ? {
              badge: {
                glyph: "ShieldAlert",
                label: "Outside of sandbox",
                hint: "Command runs outside the sandbox",
                tone: "destructive",
              },
              badges: [{ label: "Outside of sandbox", tone: "destructive" }],
            }
          : {}),
      };

      return {
        kind: "command",
        presentation,
        item: {
          type: "command",
          command: commandLine ?? "",
          cwd: "",
        },
      };
    }

    case "invoke_subagent": {
      const role =
        typeof rawInput.Role === "string" && rawInput.Role.trim() ? rawInput.Role.trim() : undefined;
      const typeName =
        typeof rawInput.TypeName === "string" && rawInput.TypeName.trim()
          ? rawInput.TypeName.trim()
          : undefined;
      const model =
        typeof rawInput.Model === "string" && rawInput.Model.trim() ? rawInput.Model.trim() : undefined;
      const workspace =
        typeof rawInput.Workspace === "string" && rawInput.Workspace.trim()
          ? rawInput.Workspace.trim()
          : undefined;
      const prompt =
        typeof rawInput.Prompt === "string" && rawInput.Prompt.trim()
          ? rawInput.Prompt.trim()
          : undefined;

      const outputText = extractEventOutputText(event);
      const convMatch =
        outputText.match(/"conversationId"\s*:\s*"([^"]+)"/) ??
        (/\bSubagent spawned\b/i.test(outputText)
          ? outputText.match(/\bconversationId:[ \t]*([^\s,]+)/i)
          : null);
      const conversationId =
        convMatch?.[1] ??
        (event.rawOutput && typeof event.rawOutput === "object" && typeof (event.rawOutput as Record<string, unknown>).conversationId === "string"
          ? ((event.rawOutput as Record<string, unknown>).conversationId as string)
          : undefined);

      const label = role || typeName || "Subagent";

      const parts: string[] = [];
      if (role && typeName && typeName !== role) {
        parts.push(typeName);
      }
      if (model && model !== "inherit") {
        parts.push(model);
      }
      if (workspace && workspace !== "inherit") {
        parts.push(workspace);
      }
      const detailParts =
        parts.length > 0
          ? parts.join(" · ")
          : (prompt ? (prompt.length > 120 ? `${prompt.slice(0, 117)}...` : prompt) : null);

      const presentation: DialectPresentation = {
        label: { pending: "Running subagent", completed: "Subagent launched" },
        icon: { glyph: "Bot" },
        title: label,
        ...(detailParts
          ? {
              detail: truncatePresentationDetail(detailParts),
              subtitle: detailParts,
            }
          : {}),
      };

      return {
        kind: "delegation",
        label,
        detail: detailParts || null,
        background: true,
        ...(conversationId ? { childRef: conversationId } : {}),
        presentation,
        item: {
          type: "delegation",
          childRef: conversationId ?? event.toolCallId,
          label,
          summary: detailParts || undefined,
          background: true,
        },
      };
    }

    case "define_subagent": {
      const name =
        typeof rawInput.Name === "string" && rawInput.Name.trim() ? rawInput.Name.trim() : undefined;
      const description =
        typeof rawInput.Description === "string" && rawInput.Description.trim()
          ? rawInput.Description.trim()
          : undefined;

      const presentation: DialectPresentation = {
        label: { pending: "Defining subagent", completed: "Defined subagent" },
        icon: { glyph: "Bot" },
        title: name ? `Define subagent ${name}` : "Define subagent",
        ...(description
          ? {
              detail: truncatePresentationDetail(description),
              subtitle: description,
            }
          : {}),
      };

      return {
        kind: "tool_use",
        tool: "define_subagent",
        detail: description || name || null,
        presentation,
        item: {
          type: "tool",
          tool: "define_subagent",
          args: event.rawInput,
        },
      };
    }

    case "manage_subagents": {
      const action =
        typeof rawInput.Action === "string" ? rawInput.Action.trim() : undefined;
      const ids = Array.isArray(rawInput.ConversationIds)
        ? rawInput.ConversationIds.filter((x): x is string => typeof x === "string" && x.trim().length > 0).join(", ")
        : undefined;

      let pending = "Managing subagents";
      let completed = "Managed subagents";
      if (action === "list") {
        pending = "Listing subagents";
        completed = "Listed subagents";
      } else if (action === "kill" || action === "kill_all") {
        pending = "Stopping subagents";
        completed = "Stopped subagents";
      }

      const presentation: DialectPresentation = {
        label: { pending, completed },
        icon: { glyph: "Bot" },
        title:
          action === "list"
            ? "List subagents"
            : action === "kill" || action === "kill_all"
              ? "Stop subagents"
              : "Manage subagents",
        ...(ids
          ? {
              detail: truncatePresentationDetail(ids),
              subtitle: ids,
            }
          : {}),
      };

      return {
        kind: "tool_use",
        tool: "manage_subagents",
        detail: ids || action || null,
        presentation,
        item: {
          type: "tool",
          tool: "manage_subagents",
          args: event.rawInput,
        },
      };
    }

    case "send_message": {
      const recipient =
        typeof rawInput.Recipient === "string" && rawInput.Recipient.trim()
          ? rawInput.Recipient.trim()
          : undefined;
      const message =
        typeof rawInput.Message === "string" && rawInput.Message.trim()
          ? rawInput.Message.trim()
          : undefined;

      const presentation: DialectPresentation = {
        label: { pending: "Messaging subagent", completed: "Messaged subagent" },
        icon: { glyph: "Bot" },
        title: recipient ? `Message ${recipient}` : "Message subagent",
        ...(message
          ? {
              detail: truncatePresentationDetail(message.slice(0, 120)),
              subtitle: message.slice(0, 120),
            }
          : {}),
      };

      return {
        kind: "tool_use",
        tool: "send_message",
        detail: recipient || null,
        presentation,
        item: {
          type: "tool",
          tool: "send_message",
          args: event.rawInput,
        },
      };
    }

    case "manage_task": {
      const action =
        typeof rawInput.Action === "string" ? rawInput.Action.trim() : undefined;
      const taskId =
        typeof rawInput.TaskId === "string" && rawInput.TaskId.trim()
          ? rawInput.TaskId.trim()
          : undefined;

      let pending = "Managing background task";
      let completed = "Managed background task";
      if (action === "list") {
        pending = "Listing background tasks";
        completed = "Listed background tasks";
      } else if (action === "status") {
        pending = "Checking background task";
        completed = "Checked background task";
      } else if (action === "kill") {
        pending = "Stopping background task";
        completed = "Stopped background task";
      } else if (action === "send_input") {
        pending = "Sending input to task";
        completed = "Sent input to task";
      }

      const presentation: DialectPresentation = {
        label: { pending, completed },
        icon: { glyph: "Terminal" },
        title: taskId
          ? `${action || "Task"}: ${taskId}`
          : action
            ? `Task ${action}`
            : "Manage task",
      };

      return {
        kind: "tool_use",
        tool: "manage_task",
        detail: taskId || action || null,
        presentation,
        item: {
          type: "tool",
          tool: "manage_task",
          args: event.rawInput,
        },
      };
    }

    case "schedule": {
      const duration =
        typeof rawInput.DurationSeconds === "number" ? rawInput.DurationSeconds : undefined;
      const cron =
        typeof rawInput.CronExpression === "string" && rawInput.CronExpression.trim()
          ? rawInput.CronExpression.trim()
          : undefined;
      const prompt =
        typeof rawInput.Prompt === "string" && rawInput.Prompt.trim()
          ? rawInput.Prompt.trim()
          : undefined;

      const scheduleDesc =
        typeof cron === "string"
          ? `cron: ${cron}`
          : typeof duration === "number"
            ? `${duration}s timer`
            : undefined;

      const presentation: DialectPresentation = {
        label: { pending: "Scheduling task", completed: "Scheduled task" },
        icon: { glyph: "Clock" },
        title: scheduleDesc ? `Schedule (${scheduleDesc})` : "Schedule task",
        ...(prompt
          ? {
              detail: truncatePresentationDetail(prompt.slice(0, 120)),
              subtitle: prompt.slice(0, 120),
            }
          : {}),
      };

      return {
        kind: "tool_use",
        tool: "schedule",
        detail: scheduleDesc || prompt || null,
        presentation,
        item: {
          type: "tool",
          tool: "schedule",
          args: event.rawInput,
        },
      };
    }

    case "ask_question": {
      const presentation: DialectPresentation = {
        label: { pending: "Asking question", completed: "Asked question" },
        icon: { glyph: "HelpCircle" },
        title: "Ask question",
      };

      return {
        kind: "tool_use",
        tool: "ask_question",
        presentation,
        item: {
          type: "tool",
          tool: "ask_question",
          args: event.rawInput,
        },
      };
    }

    default:
      return null;
  }
}

// Dialect registration
export const antigravityAcpDialect: AcpDialect = {
  id: ANTIGRAVITY_ACP_DIALECT_ID,
  toolIdentity: ((event: AcpToolUpdateEvent) => toolIdentity(event) ?? undefined) as any,
  classifyToolCall: ((event: AcpToolUpdateEvent) => classifyToolCall(event) ?? undefined) as any,
  normalizeCommandEvent,
  commandResult: ((event: AcpToolUpdateEvent) => {
    const res = commandResult(event);
    if (!res) return undefined;
    const text = extractEventOutputText(event);
    const clean = text ? parseAntigravityCommandOutput(text).cleanOutput : undefined;
    return {
      ...res,
      ...(clean ? { output: clean } : {}),
    };
  }) as any,
};

let dialectRegistered = false;

export function registerAntigravityAcpDialect(): AcpDialect {
  if (!dialectRegistered) {
    try {
      experimental_registerAcpDialect(antigravityAcpDialect);
    } catch {
      // Idempotent: catch in case already registered in this or parent context
    }
    dialectRegistered = true;
  }
  return antigravityAcpDialect;
}
