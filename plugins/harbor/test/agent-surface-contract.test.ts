import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { z } from "zod";
import {
  HARBOR_AGENT_TOOL_NAMES,
  toolsForAccessTier,
  type AgentAccessTier,
} from "../lib/domain/agent-access.ts";
import { createAgentToolRegistry } from "../lib/agent/toolkit.ts";
import { EMPTY_BRIEF } from "../lib/domain/feature-meta.ts";
import { registerReadTools } from "../lib/agent/tools-read.ts";
import { registerWriteTools } from "../lib/agent/tools-write.ts";
import { registerFeatureTools, type FeatureAgentPort } from "../lib/agent/tools-features.ts";
import { registerFeatureCockpitTools } from "../lib/agent/tools-features-cockpit.ts";
import { registerDestructiveTools } from "../lib/agent/tools-destructive.ts";
import { registerSpawnTool } from "../lib/agent/tools-spawn.ts";
import type { AgentToolDeps } from "../lib/agent/actions.ts";

function registeredTools(tier: AgentAccessTier = "full") {
  const toHost: { name: string; parameters: unknown }[] = [];
  const registry = createAgentToolRegistry({
    bb: {
      agents: {
        registerTool(registration: { name: string; parameters: unknown }) {
          toHost.push(registration);
        },
      },
    } as never,
    getTier: () => tier,
  });
  const deps: AgentToolDeps = {
    index: () => null,
    refreshIndex: async () => undefined,
    actions: {
      renameProject: async () => "New name",
      settleThread: async () => ({ ok: true, message: null }),
      snoozeThread: async () => ({ ok: true, message: null }),
      setThreadPinned: async () => true,
      renameThread: async () => true,
      deleteThreads: async () => ({
        preview: {
          token: null,
          expiresAt: null,
          included: [],
          skipped: [],
          rootCount: 0,
          childCount: 0,
          totalThreadCount: 0,
        },
        result: null,
      }),
      removeProject: async () => true,
      deleteGroup: async () => true,
      removeWorkspace: async () => ({
        ok: true,
        code: null,
        archivedThreads: true,
        environmentRemoved: true,
        directory: "removed" as const,
        message: null,
      }),
      spawnThread: async () => "thr_new",
      assignProjectToGroup: async () => true,
      createGroup: async () => null,
      renameGroup: async () => true,
      setWorkspaceAlias: async () => null,
    },
  };
  registerReadTools(registry, deps);
  registerWriteTools(registry, deps);
  registerDestructiveTools(registry, deps);
  const featurePort: FeatureAgentPort = {
    locate: () => null,
    features: () => [],
    membersOf: () => [],
    refLinks: () => [],
    threadPath: async () => null,
    threadEnvironmentId: async () => null,
    projects: async () => [],
    refresh: async () => undefined,
    create: async () => {
      throw new Error("not in this test");
    },
    addRepositories: async () => [],
    rename: async () => true,
    renameMemberBranch: async () => ({ ok: true, reason: null }),
    upgradeReferenceRepo: async () => ({
      repository: "acme-web",
      outcome: "created",
      path: "/Users/example/harbor-features/f_1/acme-web",
      branch: "feat/f-1",
      role: "worktree",
      setup: [],
      reason: null,
    }),
    reopen: async () => undefined,
    adopt: async () => true,
    deleteFeature: async () => ({ removedWorktrees: 0, leftovers: [], removedFolder: true }),
    removeRepository: async () => ({ removed: true }),
    meta: () => ({ brief: EMPTY_BRIEF, refs: [], decisions: [] }),
    setBrief: async (_featureId, input) => ({ ...input, updatedAt: 1 }),
    addDecision: async () => {
      throw new Error("not in this test");
    },
    addRef: async () => {
      throw new Error("not in this test");
    },
    park: async () => {
      throw new Error("not in this test");
    },
    unpark: async () => {
      throw new Error("not in this test");
    },
    promote: async () => {
      throw new Error("not in this test");
    },
    addReferenceRepo: async () => {
      throw new Error("not in this test");
    },
    getFeatureGitStatus: async () => ({
      featureId: "f_1",
      additions: 0,
      deletions: 0,
      dirtyRepoCount: 0,
      behindRepoCount: 0,
      unpushedRepoCount: 0,
      repos: [],
    }),
  };
  registerFeatureTools(registry, featurePort);
  registerFeatureCockpitTools(registry, featurePort);
  registerSpawnTool(registry, {
    locate: () => null,
    threadPath: async () => null,
    environment: async () => null,
    homeProject: async () => null,
    resolveProject: async () => null,
    spawn: async () => null,
  });
  return { toHost, registry };
}

describe("Harbor V3 consolidated agent surface", () => {
  it("registers the exact 10 consolidated tools and maps 1:1 with the canonical spec", () => {
    const { toHost, registry } = registeredTools("full");
    assert.equal(registry.tools.length, 10);
    assert.deepEqual(
      registry.tools.map((tool) => tool.name).sort(),
      [...HARBOR_AGENT_TOOL_NAMES].sort(),
    );
    assert.deepEqual(
      toHost.map((tool) => tool.name).sort(),
      [...HARBOR_AGENT_TOOL_NAMES].sort(),
    );
  });

  it("exposes strictly read-only tools in read-only mode and none in off mode", () => {
    const readOnly = registeredTools("read-only").registry;
    assert.deepEqual(readOnly.enabledToolNames({ insideFeature: false }), [
      "harbor_sidebar_map",
      "harbor_feature_list",
    ]);
    assert.deepEqual(readOnly.enabledToolNames({ insideFeature: true }), [
      "harbor_sidebar_map",
      "harbor_feature_list",
      "harbor_feature_brief",
      "harbor_feature_git_status",
    ]);

    const off = registeredTools("off").registry;
    assert.deepEqual(off.enabledToolNames(), []);
    assert.deepEqual(toolsForAccessTier("off"), []);
  });

  it("gates every destructive tool behind acknowledged confirmation and omits ordering writes", () => {
    const { toHost } = registeredTools("full");
    const destructive = toHost.filter((tool) =>
      ["harbor_admin_delete", "harbor_feature_lifecycle", "harbor_feature_repos"].includes(
        tool.name,
      ),
    );
    assert.equal(destructive.length, 3);
    for (const tool of destructive) {
      const shape = (tool.parameters as z.ZodObject<z.ZodRawShape>).shape;
      assert.ok("acknowledged" in shape, `${tool.name} takes an acknowledgement`);
    }
    const names = toHost.map((tool) => tool.name).join(" ");
    assert.doesNotMatch(names, /reorder|create_project/);
  });
});

describe("starting a thread inside a feature", () => {
  it("asks for the Features project by the feature's container path", async () => {
    const homeProjectCalls: string[] = [];
    const spawnCalls: { environment?: unknown; projectId: string }[] = [];
    let registered: { execute: (params: unknown, context: unknown) => Promise<string> } | undefined;
    registerSpawnTool(
      {
        register(tool: { execute: (params: unknown, context: unknown) => Promise<string> }) {
          registered = tool;
        },
        tools: [],
        tier: () => "full",
        enabledToolNames: () => [],
        isEnabled: () => true,
      } as never,
      {
        locate: () => ({
          feature: {
            id: "f_ai_voice",
            name: "AI voice",
            slug: "ai-voice",
            state: "active",
            position: 0,
            rootPath: "/Users/example/harbor-features/ai-voice",
            hostId: "host_1",
          },
          members: [],
          inRoot: true,
        }),
        threadPath: async () => "/Users/example/harbor-features/ai-voice",
        environment: async () => null,
        homeProject: async (containerPath) => {
          homeProjectCalls.push(containerPath);
          return "prj_features";
        },
        resolveProject: async () => null,
        spawn: async (input) => {
          spawnCalls.push({ environment: input.environment, projectId: input.projectId });
          return "thr_new";
        },
      },
    );
    assert.ok(registered);
    await registered.execute({ prompt: "Do the work.", as_child: true }, { threadId: "thr_call" });
    assert.deepEqual(homeProjectCalls, ["/Users/example/harbor-features"]);
    assert.equal(spawnCalls[0]?.projectId, "prj_features");
    assert.deepEqual(spawnCalls[0]?.environment, {
      type: "host",
      hostId: "host_1",
      workspace: { type: "unmanaged", path: "/Users/example/harbor-features/ai-voice" },
    });
  });
});
