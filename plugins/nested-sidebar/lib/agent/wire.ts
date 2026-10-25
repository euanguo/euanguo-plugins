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

export function wireAgentTools(input: {
  readonly bb: BbPluginApi;
  readonly flags: AgentToolFlags;
  readonly deps: AgentToolDeps;
}): AgentToolRegistry {
  const { bb, flags, deps } = input;
  const registry = createAgentToolRegistry({ bb, flags });
  registerReadTools(registry, deps);
  registerWriteTools(registry, deps);

  bb.agents.configure(() => ({
    tools: registry.enabledToolNames(),
    // This plugin ships no skills; the field is required and empty rather than
    // omitted, because an absent selection is not the same as a selection of
    // nothing and the host treats a malformed result as a failed selection.
    skills: [],
  }));

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
