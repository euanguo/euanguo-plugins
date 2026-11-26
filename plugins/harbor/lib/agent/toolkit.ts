/**
 * Tool registration and runtime tier gating for Harbor's consolidated agent surface.
 *
 * `bb.agents.registerTool` has no disposer, so tools are registered once at load
 * and gated synchronously against the live `AgentAccessTier` on every call,
 * while `bb.agents.configure` hides disallowed tools from new sessions using the
 * exact same `toolsForAccessTier` rules.
 */

import type { BbPluginApi, PluginAgentToolContext } from "@get-bb/plugin-sdk";
import type { z, ZodObject, ZodRawShape } from "zod";
import {
  isToolAllowedForTier,
  toolsForAccessTier,
  type AccessTierVisibilityOptions,
  type AgentAccessTier,
  type HarborAgentToolName,
} from "../domain/agent-access.ts";
import { describeActionError } from "../domain/rpc-error.ts";

const OUTPUT_LIMIT = 16_000;

export function truncateToolOutput(text: string, limit = OUTPUT_LIMIT): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n… [truncated ${text.length - limit} characters]`;
}

/** One tool, before the registry turns it into a host registration. */
export interface AgentTool<S extends ZodRawShape> {
  /** `[a-zA-Z0-9_-]+`, unique across every plugin in the install. */
  readonly name: HarborAgentToolName;
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
  readonly name: HarborAgentToolName;
}

export interface AgentToolRegistry {
  register<S extends ZodRawShape>(tool: AgentTool<S>): void;
  /** Every tool this build registers, in registration order. */
  readonly tools: readonly RegisteredAgentTool[];
  /** Current access tier. */
  tier(): AgentAccessTier;
  /** Tool names offered to a session starting now under the current tier. */
  enabledToolNames(options?: AccessTierVisibilityOptions): HarborAgentToolName[];
  /** Whether a specific tool is allowed right now under the current tier. */
  isEnabled(toolName: string, options?: AccessTierVisibilityOptions): boolean;
}

/**
 * Register every tool and enforce the active `AgentAccessTier` on every call.
 */
export function createAgentToolRegistry(input: {
  readonly bb: BbPluginApi;
  readonly getTier: () => AgentAccessTier;
}): AgentToolRegistry {
  const { bb, getTier } = input;
  const tools: RegisteredAgentTool[] = [];
  const registered = new Set<HarborAgentToolName>();

  const isEnabled = (
    toolName: string,
    options?: AccessTierVisibilityOptions,
  ): boolean => isToolAllowedForTier(toolName, getTier(), options);

  return {
    tools,
    tier: getTier,
    isEnabled,
    enabledToolNames(options) {
      return toolsForAccessTier(getTier(), options).filter((name) =>
        registered.has(name),
      );
    },
    register(tool) {
      tools.push({ name: tool.name });
      registered.add(tool.name);
      bb.agents.registerTool({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        async execute(params, context) {
          const tier = getTier();
          if (!isToolAllowedForTier(tool.name, tier)) {
            return (
              `Harbor agent access is currently set to "${tier}", which disables ` +
              `${tool.name}. Ask the user to enable a higher Harbor Agent Access tier if this is needed.`
            );
          }
          try {
            return truncateToolOutput(await tool.execute(params, context));
          } catch (error) {
            // Reported, never thrown: a tool that throws fails the model's turn,
            // and a refusal it can read is something it can work around.
            return `Error: ${describeActionError(error)}`;
          }
        },
      });
    },
  };
}
