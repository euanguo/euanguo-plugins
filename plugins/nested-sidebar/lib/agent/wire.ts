/**
 * The one call the server makes to put Nest in front of agents.
 *
 * Three registrations, and each exists because of a different limit in the host
 * API:
 *
 * - `registerTool` has no disposer, so tools are registered once and gated at
 *   call time. That is the only mechanism that makes a settings change apply
 *   without a plugin reload.
 * - `configure` is what actually removes a disabled tool from a session's tool
 *   list, and it only applies at the next session start. Without it a disabled
 *   tool is still advertised, and the model spends a turn calling it to be told
 *   it is off.
 * - `contributeInstructions` is what makes the structure known before the agent
 *   thinks to ask. It runs on the thread-start path, synchronously, which is why
 *   everything it reads comes from the materialized index.
 *
 * All three are registered unconditionally. `configure` may be registered
 * exactly once per plugin load, so a gate has to be inside the callback rather
 * than around the registration — and a callback that returns an empty list is
 * how "off" is expressed.
 */

import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { createAgentToolRegistry, type AgentToolFlags, type AgentToolRegistry } from "./toolkit.ts";
import { registerReadTools } from "./tools-read.ts";
import { registerWriteTools } from "./tools-write.ts";
import { agentInstructions } from "./instructions.ts";
import type { AgentToolDeps } from "./actions.ts";
import {
  FEATURE_TOOLS_INSIDE,
  featureInstructions,
  registerFeatureTools,
  type FeatureAgentPort,
} from "./tools-features.ts";

/** The skill this plugin ships, selected for a thread inside a feature folder. */
export const FEATURE_SKILL = "feature-workspaces";

export function wireAgentTools(input: {
  readonly bb: BbPluginApi;
  readonly flags: AgentToolFlags;
  readonly deps: AgentToolDeps;
  readonly features: FeatureAgentPort;
}): AgentToolRegistry {
  const { bb, flags, deps, features } = input;
  const registry = createAgentToolRegistry({ bb, flags });
  registerReadTools(registry, deps);
  registerWriteTools(registry, deps);
  registerFeatureTools(registry, features);

  /**
   * A thread inside a feature folder gets the feature's tools, the skill, and a
   * short paragraph saying where it is. Every other thread gets none of the
   * three: a tool that can only answer "you are not in a feature" is context
   * spent on nothing.
   *
   * Read from the environment's path, because that is the fact every way of
   * starting a thread agrees on — Nest's `+`, bb's composer, the CLI and an
   * agent's worker all end up with a path, and only some of them pass through
   * this plugin.
   */
  const inside = new Set<string>(FEATURE_TOOLS_INSIDE);
  bb.agents.configure((context) => {
    const located = registry.isEnabled("features")
      ? features.locate(context.environment.path)
      : null;
    return {
      tools: registry
        .enabledToolNames()
        .filter((name) => located !== null || !inside.has(name)),
      skills: located === null ? [] : [FEATURE_SKILL],
      ...(located === null ? {} : { instructions: featureInstructions(located) }),
    };
  });

  bb.agents.contributeInstructions((context) =>
    agentInstructions({
      index: deps.index(),
      flags,
      toolNames: registry.enabledToolNames(),
      projectId: context.projectId,
    }),
  );

  return registry;
}
