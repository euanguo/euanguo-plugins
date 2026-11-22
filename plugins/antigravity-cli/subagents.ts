import { threadStartParamsSchema, threadResumeParamsSchema, turnStartParamsSchema } from "@get-bb/plugin-sdk/provider-bridge";
import { experimental_acpProviderBridge } from "@get-bb/plugin-sdk/provider-bridge/acp";

export const ANTIGRAVITY_SUBAGENT_TOOLS: ReadonlySet<string> = new Set(["invoke_subagent", "define_subagent", "manage_subagents", "send_message"]);
const titles = new Set(["invoke subagent", "running subagent", "subagent launched", "define subagent", "defining subagent", "manage subagents", "listing subagents", "stopping subagents", "send message", "messaging subagent"]);

export const BB_SUBAGENT_DELEGATION_INSTRUCTIONS = "Native Antigravity subagent tools (invoke_subagent, define_subagent, manage_subagents, send_message) are disabled for this thread. Do not call invoke_subagent, define_subagent, manage_subagents, or send_message. When you need to delegate work to subagents or run parallel agent tasks, use BB threads via the bb CLI (bb thread spawn --parent-self ..., bb thread wait ..., bb thread tell ...) or perform the task directly in this thread.";

export function isNativeSubagentTool(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const name = value.trim().toLowerCase();
  return ANTIGRAVITY_SUBAGENT_TOOLS.has(name) || titles.has(name) || /^(?:define subagent\s+\S+|message\s+\S+|list subagents|stop subagents?|manage subagents)$/i.test(name);
}

export function resolveProviderSubagentsEnabled(providerOptions: Record<string, unknown> | undefined, previousValue = true): boolean {
  if (providerOptions?.providerSubagentsEnabled === false || providerOptions?.subagentsDisabled === true) return false;
  if (providerOptions?.providerSubagentsEnabled === true || providerOptions?.subagentsDisabled === false) return true;
  return previousValue;
}

export function mergeSubagentInstructions(existing: string | null | undefined, providerSubagentsEnabled: boolean): string | undefined {
  if (providerSubagentsEnabled) return existing ?? undefined;
  if (existing?.includes(BB_SUBAGENT_DELEGATION_INSTRUCTIONS)) return existing;
  return existing ? `${existing}\n\n${BB_SUBAGENT_DELEGATION_INSTRUCTIONS}` : BB_SUBAGENT_DELEGATION_INSTRUCTIONS;
}

function record(value: unknown): Record<string, any> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : undefined;
}

export function createSubagentController(options: { replyToBridge?: (line: string) => void } = {}) {
  const threads = new Map<string, boolean>();
  function isSubagentsDisabled(threadId: string): boolean { return threads.get(threadId) === false; }
  function clearThread(threadId: string): void { threads.delete(threadId); }
  function rememberAndTransformRequest(line: string, parsed?: unknown): { line: string; parsed: unknown; providerSubagentsEnabled: boolean } {
    if (parsed === undefined) { try { parsed = JSON.parse(line); } catch { return { line, parsed: null, providerSubagentsEnabled: true }; } }
    const request = record(parsed);
    const params = record(request?.params);
    const threadId = params?.threadId;
    if (typeof threadId !== "string") return { line, parsed, providerSubagentsEnabled: true };
    if (request?.method === "thread/stop" || request?.method === "thread/discard") {
      clearThread(threadId);
      return { line, parsed, providerSubagentsEnabled: true };
    }
    const schema = request?.method === "thread/start" ? threadStartParamsSchema : request?.method === "thread/resume" ? threadResumeParamsSchema : request?.method === "turn/start" ? turnStartParamsSchema : undefined;
    if (!schema) return { line, parsed, providerSubagentsEnabled: !isSubagentsDisabled(threadId) };
    const validated = schema.safeParse(params);
    const requestOptions = record(validated.success ? validated.data.options : params?.options);
    const enabled = resolveProviderSubagentsEnabled(record(requestOptions?.providerOptions), request?.method === "turn/start" ? threads.get(threadId) : undefined);
    threads.set(threadId, enabled);
    if (enabled) return { line, parsed, providerSubagentsEnabled: enabled };
    const originalOptions = record(params?.options) ?? {};
    const instructions = mergeSubagentInstructions(typeof originalOptions.instructions === "string" ? originalOptions.instructions : undefined, false);
    const transformed = { ...request, params: { ...params, options: { ...originalOptions, instructions } } };
    return { line: JSON.stringify(transformed), parsed: transformed, providerSubagentsEnabled: enabled };
  }
  function isSubagentApprovalForDisabledThread(message: unknown): boolean {
    const m = record(message), params = record(m?.params), payload = record(params?.payload), subject = record(payload?.subject);
    return m?.jsonrpc === "2.0" && m.method === "interaction/request" && (typeof m.id === "string" || typeof m.id === "number") && typeof params?.threadId === "string" && isSubagentsDisabled(params.threadId) && payload?.kind === "approval" && subject?.kind === "tool_use" && (isNativeSubagentTool(subject.tool) || isNativeSubagentTool(subject.presentation?.title) || isNativeSubagentTool(subject.presentation?.label?.pending)) && Array.isArray(payload.availableDecisions);
  }
  function isBlockedSubagentApproval(message: unknown): boolean {
    return isSubagentApprovalForDisabledThread(message) && record(record(record(message)?.params)?.payload)!.availableDecisions.includes("deny");
  }
  function interceptSubagentApproval(line: string): boolean {
    let message: any;
    try { message = JSON.parse(line); } catch { return false; }
    if (!isBlockedSubagentApproval(message) || !options.replyToBridge) return false;
    options.replyToBridge(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { decision: "deny", grantedPermissions: null } }));
    return true;
  }
  return { rememberAndTransformRequest, isSubagentsDisabled, isSubagentApprovalForDisabledThread, isBlockedSubagentApproval, interceptSubagentApproval, clearThread };
}

const defaultController = createSubagentController({ replyToBridge: line => queueMicrotask(() => experimental_acpProviderBridge.handleLine(line)) });
export const rememberSubagentSetting = defaultController.rememberAndTransformRequest;
export const transformSubagentRequest = defaultController.rememberAndTransformRequest;
export const isSubagentsDisabled = defaultController.isSubagentsDisabled;
export const isSubagentApprovalForDisabledThread = defaultController.isSubagentApprovalForDisabledThread;
export const interceptSubagentApproval = defaultController.interceptSubagentApproval;
