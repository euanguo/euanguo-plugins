import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { ANTIGRAVITY_ACP_DIALECT_ID } from "./dialect.ts";
import { registerAntigravityUsageSource } from "./usage.ts";

export const DEFAULT_COMMAND = "agy";
export const DEFAULT_AGENT_TURN_QUIET_SECONDS = 30;

export function buildLaunchSpec(settings?: {
  command?: unknown;
  processPerSession?: unknown;
  sandbox?: unknown;
}) {
  const command =
    typeof settings?.command === "string" && settings.command.trim().length > 0
      ? settings.command.trim()
      : DEFAULT_COMMAND;
  const processPerSession = settings?.processPerSession !== false;
  const sandbox = settings?.sandbox === true;
  return {
    displayName: "Antigravity CLI",
    command,
    args: [
      "acp",
      ...(processPerSession ? ["--process-per-session"] : []),
      "--disable-telemetry",
      ...(sandbox ? ["--sandbox"] : []),
    ],
    env: {},
  };
}

export function normalizeQuietSeconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_AGENT_TURN_QUIET_SECONDS;
  }
  return Math.min(300, Math.max(5, Math.round(value)));
}

export default async function antigravity(bb: BbPluginApi) {
  registerAntigravityUsageSource(bb);
  const settings = bb.settings.define({
    command: {
      type: "string",
      label: "Antigravity CLI command",
      description:
        "agy on PATH, or an absolute executable path shared by target machines.",
      default: DEFAULT_COMMAND,
    },
    processPerSession: {
      type: "boolean",
      label: "Isolate ACP worker per session",
      description:
        "Pass --process-per-session to agy acp so concurrent threads use isolated worker processes.",
      default: true,
    },
    agentTurnQuietSeconds: {
      type: "number",
      label: "Async agent turn quiet timeout (seconds)",
      description:
        "Wait this many seconds of silence (5-300) before settling background-resumed turns as idle.",
      experimental_schema: z.number().finite().min(5).max(300),
      default: DEFAULT_AGENT_TURN_QUIET_SECONDS,
    },
    autoApprove: {
      type: "boolean",
      label: "Automatically approve ACP permission requests",
      description:
        "Automatically answer Antigravity permission requests, including commands outside the CLI sandbox. Applies to new turns.",
      default: false,
    },
    sandbox: {
      type: "boolean",
      label: "Request CLI terminal sandbox",
      description:
        "Add --sandbox for new threads. Otherwise use CLI settings. Requires a supported OS; the CLI may fall back to approval prompts. Full access can approve requests outside the sandbox.",
      default: false,
    },
    subagentsDisabled: {
      type: "boolean",
      label: "Disable provider subagents",
      description:
        "Prevent Antigravity CLI from using its native subagent tools so agents use bb for delegation.",
      default: false,
    },
    commandDescriptionsEnabled: {
      type: "boolean",
      label: "Show command descriptions",
      description:
        "Display Antigravity tool summaries on command execution cards.",
      default: true,
    },
    enabled: {
      type: "boolean",
      label: "Enable Antigravity CLI",
      description:
        "Show Antigravity in the provider picker. Existing running turns are not stopped.",
      default: true,
    },
  });

  const initial = await settings.get();
  const baseSpec = buildLaunchSpec(initial);

  const register = () =>
    bb.providers.register({
      id: "antigravity-cli",
      displayName: "Antigravity CLI",
      icon: "./assets/provider.svg",
      family: "antigravity",
      strings: {
        signInHint: `Run \`${baseSpec.command} acp --login\` on this machine, then retry.`,
        expiredHint: `Run \`${baseSpec.command} acp --login\` on this machine to refresh your sign-in.`,
        installUrl: "https://antigravity.google/docs/getting-started?tab=cli",
      },
      experimental_bridgeOptions: {
        acpLaunchSpec: baseSpec,
        acpDialect: ANTIGRAVITY_ACP_DIALECT_ID,
      },
      deriveProviderOptions({ settings: current }) {
        return {
          autoApprove: current.autoApprove === true,
          providerSubagentsEnabled: current.subagentsDisabled !== true,
          commandDescriptionsEnabled:
            current.commandDescriptionsEnabled !== false,
          agentTurnQuietSeconds: normalizeQuietSeconds(
            current.agentTurnQuietSeconds,
          ),
          acpDialect: ANTIGRAVITY_ACP_DIALECT_ID,
          acpLaunchSpec: buildLaunchSpec(current),
        };
      },
      experimental_nativeSkillRoots: {
        user: [
          ".gemini/antigravity-cli/skills",
          ".gemini/skills",
          ".gemini/config/skills",
        ],
        project: [".agents/skills", ".agent/skills"],
      },
      experimental_visibility: "always",
      maintenance: { health: true, usage: true, installation: false },
      capabilities: {
        supportsServiceTier: false,
        supportsNativeUserQuestion: false,
        fork: "none",
        supportsManualCompaction: false,
        supportsThreadArchive: false,
        supportsThreadRename: false,
        permissionModes: ["accept-edits", "full"],
        reasoningLevels: ["low", "medium", "high", "xhigh", "max"],
      },
      composerActions: [],
      models: { fallback: [], scope: "workspace" },
    });

  let registration = initial.enabled ? register() : undefined;
  settings.onChange(({ enabled }) => {
    if (Boolean(registration) === enabled) return;
    registration?.dispose();
    registration = enabled ? register() : undefined;
  });
}
