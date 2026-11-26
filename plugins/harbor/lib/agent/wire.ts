/**
 * Wires Harbor's consolidated agent tools, session visibility (`configure`), and
 * compact prompt injection (`contributeInstructions`) from one canonical
 * three-tier source (`toolsForAccessTier`).
 */

import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  toolsForAccessTier,
  type AgentAccessTier,
} from "../domain/agent-access.ts";
import type { AgentToolDeps } from "./actions.ts";
import { agentInstructions, workspaceInstructions } from "./instructions.ts";
import { createAgentToolRegistry, type AgentToolRegistry } from "./toolkit.ts";
import { registerDestructiveTools } from "./tools-destructive.ts";
import { registerFeatureCockpitTools } from "./tools-features-cockpit.ts";
import { featureInstructions, registerFeatureTools, type FeatureAgentPort } from "./tools-features.ts";
import { registerReadTools } from "./tools-read.ts";
import { registerSpawnTool, type ThreadSpawnPort } from "./tools-spawn.ts";
import { registerWriteTools } from "./tools-write.ts";

/** The skill this plugin ships, selected for a thread inside a feature folder. */
export const FEATURE_SKILL = "feature-workspaces";

const MAX_THREAD_CONTEXT_ENTRIES = 500;

interface ThreadSessionContext {
  readonly environmentId: string | null;
  readonly insideFeature: boolean;
}

export function wireAgentTools(input: {
  readonly bb: BbPluginApi;
  readonly getTier: () => AgentAccessTier;
  readonly deps: AgentToolDeps;
  readonly features: FeatureAgentPort;
  readonly spawn: ThreadSpawnPort;
}): AgentToolRegistry {
  const { bb, getTier, deps, features, spawn } = input;
  const registry = createAgentToolRegistry({ bb, getTier });
  registerReadTools(registry, deps);
  registerWriteTools(registry, deps);
  registerDestructiveTools(registry, deps);
  registerSpawnTool(registry, spawn);
  registerFeatureTools(registry, features);
  registerFeatureCockpitTools(registry, features);

  // Remember each thread's `environmentId` and `insideFeature` resolved in
  // `configure` so synchronous `contributeInstructions` calls agree 100%.
  const threadContexts = new Map<string, ThreadSessionContext>();

  const rememberThreadContext = (
    threadId: string,
    value: ThreadSessionContext,
  ): void => {
    if (threadContexts.has(threadId)) {
      threadContexts.delete(threadId);
    } else if (threadContexts.size >= MAX_THREAD_CONTEXT_ENTRIES) {
      const oldest = threadContexts.keys().next().value;
      if (oldest !== undefined) threadContexts.delete(oldest);
    }
    threadContexts.set(threadId, value);
  };

  bb.agents.configure((context) => {
    const tier = getTier();
    if (tier === "off") {
      return {
        tools: [],
        skills: [],
      };
    }

    const located = features.locate(context.environment.path);
    const insideFeature = located !== null;
    rememberThreadContext(context.thread.id, {
      environmentId: context.environment.id,
      insideFeature,
    });

    const visibleTools = [...toolsForAccessTier(tier, { insideFeature })];
    const workspace = insideFeature
      ? null
      : workspaceInstructions({
          projectName: context.project.name,
          environment: context.environment,
        });

    return {
      tools: visibleTools,
      skills: insideFeature ? [FEATURE_SKILL] : [],
      ...(located !== null
        ? { instructions: featureInstructions(located, { tier }) }
        : workspace === null
          ? {}
          : { instructions: workspace }),
    };
  });

  bb.agents.contributeInstructions((context) => {
    const tier = getTier();
    if (tier === "off") return null;

    const remembered = threadContexts.get(context.threadId);
    const insideFeature = remembered?.insideFeature ?? false;
    const environmentId = remembered?.environmentId ?? null;
    const toolNames = toolsForAccessTier(tier, { insideFeature });

    return agentInstructions({
      index: deps.index(),
      tier,
      toolNames,
      projectId: context.projectId,
      environmentId,
    });
  });

  return registry;
}
