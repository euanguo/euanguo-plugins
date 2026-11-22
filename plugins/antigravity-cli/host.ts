import { experimental_acpLaunchSpecSchema, experimental_acpProviderBridge } from "@get-bb/plugin-sdk/provider-bridge/acp";
import { threadStartParamsSchema, threadResumeParamsSchema, turnStartParamsSchema } from "@get-bb/plugin-sdk/provider-bridge";
import { createBackgroundTaskTracker, defaultBackgroundTaskStatePath } from "./background-tasks.ts";
import { resolveAntigravityLaunchSpec } from "./cli.ts";
import { ANTIGRAVITY_ACP_DIALECT_ID, applyThreadCommandDescriptions, onToolUpdate, registerAntigravityAcpDialect } from "./dialect.ts";
import { createHealthChecker } from "./health.ts";
import { modeControlOutput } from "./mode-controls.ts";
import { mapPromptMode } from "./prompt-mode.ts";
import { interceptSubagentApproval, isSubagentApprovalForDisabledThread, transformSubagentRequest } from "./subagents.ts";
import { createTurnStabilityController } from "./turn-stability.ts";
import { readAntigravityProviderUsage } from "./usage.ts";

registerAntigravityAcpDialect();

let rawStdoutWrite: typeof process.stdout.write | null = null;
const checkHealth = createHealthChecker();

function emitDeltasDirect(threadId: string, deltas: readonly object[]) {
  if (!deltas.length) return;
  const write = rawStdoutWrite ?? process.stdout.write.bind(process.stdout);
  write(`${JSON.stringify({ jsonrpc: "2.0", method: "thread/delta", params: { threadId, deltas } })}\n`);
}

export const backgroundTaskTracker = createBackgroundTaskTracker({
  persistPath: defaultBackgroundTaskStatePath(),
  onAsyncDeltas: emitDeltasDirect,
});

export const turnStability = createTurnStabilityController({
  onFlushBoundary(threadId, boundary) {
    emitDeltasDirect(threadId, [boundary]);
  },
  hasActiveBackgroundTasks(threadId) {
    return backgroundTaskTracker.getActiveTasks(threadId).length > 0;
  },
});

onToolUpdate((event) => {
  backgroundTaskTracker.recordToolEvent(event as any);
  turnStability.noteToolUpdate(event as any);
});

function parseMaintenanceRequest(
  parsed: unknown,
  expectedMethod: "provider/usage" | "provider/health",
): { id: string | number; command: string; cwd?: string; env?: Record<string, string> } | null {
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  if (record.method !== expectedMethod) return null;
  const id = record.id;
  if (typeof id !== "string" && typeof id !== "number") return null;
  const params =
    record.params && typeof record.params === "object"
      ? (record.params as Record<string, unknown>)
      : undefined;
  const providerOptions =
    params?.providerOptions && typeof params.providerOptions === "object"
      ? (params.providerOptions as Record<string, unknown>)
      : undefined;
  const spec = experimental_acpLaunchSpecSchema.safeParse(providerOptions?.acpLaunchSpec);
  return {
    id,
    command: spec.success ? spec.data.command : "agy",
    cwd: spec.success ? spec.data.cwd : undefined,
    env: spec.success ? spec.data.env : undefined,
  };
}

let stdoutFilterInstalled = false;
const autoApproveThreads = new Map<string, boolean>();
const commandDescriptionsThreads = new Map<string, boolean>();

export function rememberApprovalSetting(request: any) {
  if (request?.method === "thread/stop" || request?.method === "thread/discard") {
    const threadId = request?.params?.threadId;
    if (typeof threadId === "string") {
      autoApproveThreads.delete(threadId);
      commandDescriptionsThreads.delete(threadId);
    }
    return;
  }
  const schema =
    request?.method === "thread/start"
      ? threadStartParamsSchema
      : request?.method === "thread/resume"
        ? threadResumeParamsSchema
        : request?.method === "turn/start"
          ? turnStartParamsSchema
          : null;
  const parsed = schema?.safeParse(request?.params);
  if (parsed?.success) {
    const providerOptions = parsed.data.options.providerOptions;
    if (typeof providerOptions?.commandDescriptionsEnabled === "boolean") {
      commandDescriptionsThreads.set(
        parsed.data.threadId,
        providerOptions.commandDescriptionsEnabled,
      );
    }
    autoApproveThreads.set(
      parsed.data.threadId,
      providerOptions?.autoApprove === true &&
        parsed.data.options.permissionMode === "accept-edits" &&
        parsed.data.options.permissionEscalation === "ask",
    );
  }
}

export function applyAntigravityDefaults(
  line: string,
  parsed: unknown,
): { line: string; parsed: unknown } {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { line, parsed };
  }
  const record = parsed as Record<string, any>;
  const params =
    record.params && typeof record.params === "object" && !Array.isArray(record.params)
      ? (record.params as Record<string, any>)
      : null;
  if (!params) return { line, parsed };
  const options =
    params.options && typeof params.options === "object" && !Array.isArray(params.options)
      ? (params.options as Record<string, any>)
      : null;
  const providerOptions =
    options?.providerOptions &&
    typeof options.providerOptions === "object" &&
    !Array.isArray(options.providerOptions)
      ? (options.providerOptions as Record<string, any>)
      : null;

  if (typeof params.threadId === "string" && typeof providerOptions?.commandDescriptionsEnabled === "boolean") {
    commandDescriptionsThreads.set(params.threadId, providerOptions.commandDescriptionsEnabled);
  }
  if (!providerOptions) return { line, parsed };

  const needsDialect = !providerOptions.acpDialect || providerOptions.acpDialect === "acp";
  // agy 1.5.x can pick thread-storage over cwd when additionalDirectories includes roots.
  const hasAdditionalRoots = "additionalWorkspaceWriteRoots" in providerOptions;
  if (!needsDialect && !hasAdditionalRoots) {
    return { line, parsed };
  }

  const nextProviderOptions = { ...providerOptions };
  if (hasAdditionalRoots) {
    delete nextProviderOptions.additionalWorkspaceWriteRoots;
  }
  if (needsDialect) {
    nextProviderOptions.acpDialect = ANTIGRAVITY_ACP_DIALECT_ID;
  }

  const updated = {
    ...record,
    params: {
      ...params,
      options: {
        ...options,
        providerOptions: nextProviderOptions,
      },
    },
  };
  return { line: JSON.stringify(updated), parsed: updated };
}

export function interceptApproval(line: string): boolean {
  if (interceptSubagentApproval(line)) return true;
  let message: any;
  try {
    message = JSON.parse(line);
  } catch {
    return false;
  }
  if (isSubagentApprovalForDisabledThread(message)) return false;
  if (
    message?.jsonrpc !== "2.0" ||
    message.method !== "interaction/request" ||
    (typeof message.id !== "string" && typeof message.id !== "number") ||
    !autoApproveThreads.get(message.params?.threadId)
  ) {
    return false;
  }
  const payload = message.params?.payload;
  if (
    payload?.kind !== "approval" ||
    typeof payload.subject?.itemId !== "string" ||
    !["command", "file_change", "tool_use"].includes(payload.subject.kind) ||
    !(payload.reason === null || typeof payload.reason === "string") ||
    !Array.isArray(payload.availableDecisions) ||
    !payload.availableDecisions.every((value: unknown) =>
      ["allow_once", "allow_for_session", "deny"].includes(value as string),
    )
  ) {
    return false;
  }
  const subject = payload.subject;
  if (
    subject.kind === "command" &&
    (typeof subject.command !== "string" ||
      !Array.isArray(subject.actions) ||
      !(subject.cwd === null || typeof subject.cwd === "string") ||
      subject.sessionGrant !== null)
  ) {
    return false;
  }
  if (
    subject.kind === "file_change" &&
    (!(subject.writeScope === null || typeof subject.writeScope === "string") ||
      subject.sessionGrant !== null)
  ) {
    return false;
  }
  if (
    subject.kind === "tool_use" &&
    (typeof subject.tool !== "string" ||
      typeof subject.presentation?.icon?.glyph !== "string" ||
      typeof subject.presentation?.label?.pending !== "string" ||
      typeof subject.presentation?.label?.completed !== "string")
  ) {
    return false;
  }
  const decisions = payload.availableDecisions;
  const decision = decisions.includes("allow_once")
    ? "allow_once"
    : decisions.includes("allow_for_session")
      ? "allow_for_session"
      : null;
  if (!decision) return false;
  queueMicrotask(() =>
    experimental_acpProviderBridge.handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: { decision, grantedPermissions: null },
      }),
    ),
  );
  return true;
}

function ensureStdoutFilter() {
  if (stdoutFilterInstalled) return;
  stdoutFilterInstalled = true;
  registerAntigravityAcpDialect();
  const write = process.stdout.write.bind(process.stdout);
  rawStdoutWrite = write;
  const output = modeControlOutput(interceptApproval, (line) => {
    const described = applyThreadCommandDescriptions(line, commandDescriptionsThreads);
    const tracked = backgroundTaskTracker.processStdoutLine(described);
    return tracked.flatMap((entry) => turnStability.processStdoutLine(entry));
  });
  output.on("data", (chunk) => write(chunk));
  process.stdout.write = ((chunk: any, encodingOrCallback?: any, callback?: any) =>
    output.write(chunk, encodingOrCallback, callback)) as typeof process.stdout.write;
}

function cleanupBridgeState() {
  turnStability.dispose();
  backgroundTaskTracker.dispose();
}

export const experimental_providerBridge = {
  ...experimental_acpProviderBridge,
  start(context?: any) {
    ensureStdoutFilter();
    experimental_acpProviderBridge.start?.(context);
  },
  handleLine(line: string) {
    ensureStdoutFilter();
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      parsed = null;
    }
    resolveAntigravityLaunchSpec(parsed);
    if (parsed !== null) line = JSON.stringify(parsed);
    const withDefaults = applyAntigravityDefaults(line, parsed);
    const subagentTransformed = transformSubagentRequest(
      withDefaults.line,
      withDefaults.parsed,
    );
    rememberApprovalSetting(subagentTransformed.parsed);

    const stabilityInbound = turnStability.handleInboundRequest(
      subagentTransformed.parsed,
    );
    for (const flush of stabilityInbound.flushDeltas) {
      emitDeltasDirect(flush.threadId, flush.deltas);
    }

    const closeDeltas = backgroundTaskTracker.handleInboundRequest(
      subagentTransformed.parsed,
    );
    if (closeDeltas.length > 0) {
      const stopThreadId = (subagentTransformed.parsed as Record<string, any> | null)
        ?.params?.threadId;
      if (typeof stopThreadId === "string") {
        emitDeltasDirect(stopThreadId, closeDeltas);
      }
    }

    const healthRequest = parseMaintenanceRequest(
      subagentTransformed.parsed,
      "provider/health",
    );
    if (healthRequest !== null) {
      void checkHealth(healthRequest.command, healthRequest.env ?? {})
        .then((result) => {
          process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: healthRequest.id, result })}\n`);
        })
        .catch(() => {
          process.stdout.write(
            `${JSON.stringify({
              jsonrpc: "2.0",
              id: healthRequest.id,
              result: {
                supported: true,
                health: {
                  status: "unknown",
                  statusMessage: "Could not check Antigravity CLI.",
                  installedVersion: null,
                  minimumSupportedVersion: null,
                  canInstall: false,
                  canUpdate: false,
                  accountEmail: null,
                  planLabel: null,
                  loginCommand: `${healthRequest.command} acp --login`,
                },
              },
            })}\n`,
          );
        });
      return;
    }

    const usageRequest = parseMaintenanceRequest(
      subagentTransformed.parsed,
      "provider/usage",
    );
    if (usageRequest !== null) {
      void readAntigravityProviderUsage({
        command: usageRequest.command,
        cwd: usageRequest.cwd,
        env: { ...process.env, ...usageRequest.env },
      })
        .then((result) => {
          process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: usageRequest.id, result })}\n`);
        })
        .catch((error) => {
          const result = {
            supported: true,
            usage: {
              status: "error",
              message:
                error instanceof Error
                  ? error.message
                  : "Antigravity CLI usage could not be collected.",
              planLabel: null,
              accountEmail: null,
            },
          };
          process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: usageRequest.id, result })}\n`);
        });
      return;
    }

    experimental_acpProviderBridge.handleLine(
      mapPromptMode(subagentTransformed.line, subagentTransformed.parsed),
    );
  },
  onClose() {
    cleanupBridgeState();
    experimental_acpProviderBridge.onClose?.();
  },
  onSigterm() {
    cleanupBridgeState();
    experimental_acpProviderBridge.onSigterm?.();
  },
  onSigint() {
    cleanupBridgeState();
    experimental_acpProviderBridge.onSigint?.();
  },
};
