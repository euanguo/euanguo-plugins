/**
 * The shape every tool this plugin offers to an agent is registered through.
 *
 * Two things about the host API decide this file's whole design.
 *
 * **A registration cannot be undone.** `bb.agents.registerTool` has no disposer,
 * so a tool registered once is registered for the plugin's life. Every toggle
 * therefore has to be a gate read at call time, not a decision made at
 * registration — which is why `flags` is an object mutated in place rather than
 * a value captured here.
 *
 * **A visible tool costs context even when it refuses.** Gating only at call
 * time leaves a disabled tool in the model's tool list, so the model spends a
 * turn calling it to be told it is off. `bb.agents.configure` is what actually
 * removes it, and it only takes effect at the next session start. So both exist:
 * `configure` hides a disabled tool from a session that has not started yet, and
 * the gate below catches a session that was already running when the user turned
 * it off. Neither is redundant and neither is sufficient.
 */

import type { BbPluginApi, PluginAgentToolContext } from "@get-bb/plugin-sdk";
import { z, type ZodObject, type ZodRawShape } from "zod";

/**
 * The features a tool can belong to, and the setting that turns each one on.
 *
 * A tool declares its feature and the mapping lives here, so a tool cannot be
 * added without a switch to turn it off — the type does not allow it.
 */
export const AGENT_TOOL_FEATURES = ["read", "grouping", "groups", "aliases"] as const;
export type AgentToolFeature = (typeof AGENT_TOOL_FEATURES)[number];

/** The live settings, mutated in place by the server's settings subscription. */
export interface AgentToolFlags {
  /** The master gate. Off registers nothing and contributes no instructions. */
  enabled: boolean;
  read: boolean;
  grouping: boolean;
  groups: boolean;
  aliases: boolean;
}

export const AGENT_FEATURE_FLAGS: Readonly<Record<AgentToolFeature, keyof AgentToolFlags>> = {
  read: "read",
  grouping: "grouping",
  groups: "groups",
  aliases: "aliases",
};

/**
 * What a tool's output may cost the model.
 *
 * A tool result goes into the conversation and stays there for the rest of the
 * session, so an unbounded answer to a reasonable question — "list the
 * workspaces" on a machine with four hundred of them — is a context problem
 * caused by the plugin. The cap is stated in the output rather than applied
 * silently, so the model knows it is looking at a prefix.
 */
const OUTPUT_LIMIT = 16_000;

export function truncateToolOutput(text: string, limit = OUTPUT_LIMIT): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n… [truncated ${text.length - limit} characters]`;
}

/** One tool, before the registry turns it into a host registration. */
export interface AgentTool<S extends ZodRawShape> {
  /** `[a-zA-Z0-9_-]+`, unique across every plugin in the install. */
  readonly name: string;
  readonly feature: AgentToolFeature;
  /** Shown to the model. Says when to call it, not what it is called. */
  readonly description: string;
  readonly parameters: ZodObject<S>;
  /** Returns the text the model reads. Throwing is caught and reported. */
  readonly execute: (
    params: z.output<ZodObject<S>>,
    context: PluginAgentToolContext,
  ) => Promise<string>;
}

export interface RegisteredAgentTool {
  readonly name: string;
  readonly feature: AgentToolFeature;
}

export interface AgentToolRegistry {
  register<S extends ZodRawShape>(tool: AgentTool<S>): void;
  /** Every tool this build has, in registration order, enabled or not. */
  readonly tools: readonly RegisteredAgentTool[];
  /** The names a session starting now should be offered. */
  enabledToolNames(): string[];
  /** Whether a feature is on, master gate included. */
  isEnabled(feature: AgentToolFeature): boolean;
}

/**
 * Register every tool, and answer which of them are on.
 *
 * The gate is deliberately a message rather than an error: a session that was
 * running when the user flipped a switch gets a sentence saying so, which is a
 * true answer to the call it made, where a thrown error would read as the plugin
 * being broken.
 */
export function createAgentToolRegistry(input: {
  readonly bb: BbPluginApi;
  readonly flags: AgentToolFlags;
}): AgentToolRegistry {
  const { bb, flags } = input;
  const tools: RegisteredAgentTool[] = [];

  const isEnabled = (feature: AgentToolFeature): boolean =>
    flags.enabled && flags[AGENT_FEATURE_FLAGS[feature]];

  return {
    tools,
    isEnabled,
    enabledToolNames() {
      return tools.filter((tool) => isEnabled(tool.feature)).map((tool) => tool.name);
    },
    register(tool) {
      tools.push({ name: tool.name, feature: tool.feature });
      bb.agents.registerTool({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        async execute(params, context) {
          if (!isEnabled(tool.feature)) {
            return (
              `The ${tool.feature} tools are turned off in the Nest plugin's ` +
              `settings. Ask the user to enable them if this is needed.`
            );
          }
          try {
            return truncateToolOutput(await tool.execute(params, context));
          } catch (error) {
            // Reported, never thrown: a tool that throws fails the model's turn,
            // and a refusal it can read is something it can work around.
            return `Error: ${error instanceof Error ? error.message : String(error)}`;
          }
        },
      });
    },
  };
}
