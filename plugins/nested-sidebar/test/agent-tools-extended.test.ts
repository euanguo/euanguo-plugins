import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";

import type { AgentToolDeps, NestAgentActions } from "../lib/agent/actions.ts";
import type { Feature, FeatureMember } from "../lib/features.ts";
import { registerFeatureTools, type FeatureAgentPort } from "../lib/agent/tools-features.ts";
import { registerThreadTools } from "../lib/agent/tools-threads.ts";
import { DEFAULT_AGENT_TOOL_FLAGS } from "../lib/agent/settings.ts";
import { createAgentToolRegistry } from "../lib/agent/toolkit.ts";

interface Registration {
  name: string;
  description: string;
  parameters: z.ZodObject<z.ZodRawShape>;
  execute: (params: unknown, context: { threadId: string; projectId: string }) => Promise<string>;
}

function registryWith(register: (registry: ReturnType<typeof createAgentToolRegistry>) => void) {
  const registrations: Registration[] = [];
  const registry = createAgentToolRegistry({
    bb: {
      agents: {
        registerTool(registration: Registration) {
          registrations.push(registration);
        },
      },
    } as never,
    flags: { ...DEFAULT_AGENT_TOOL_FLAGS, enabled: true, threads: true, rename: true, features: true },
  });
  register(registry);
  const tool = (name: string): Registration => {
    const found = registrations.find((registration) => registration.name === name);
    assert.ok(found, `${name} is registered`);
    return found;
  };
  return { tool, registrations };
}

const CONTEXT = { threadId: "thr_1", projectId: "proj_1" };

function actionsWith(overrides: Partial<NestAgentActions> = {}): {
  deps: AgentToolDeps;
  calls: { name: string; args: unknown[] }[];
} {
  const calls: { name: string; args: unknown[] }[] = [];
  const record = <T,>(name: string, answer: T) => async (...args: unknown[]): Promise<T> => {
    calls.push({ name, args });
    return answer;
  };
  const actions: NestAgentActions = {
    deleteThreads:
      overrides.deleteThreads ??
      record("delete-threads", {
        preview: { token: "tok", expiresAt: 0, included: [], skipped: [], rootCount: 0, childCount: 0, totalThreadCount: 0 },
        result: { deleted: [], skipped: [], failed: [] },
      }),
    removeProject: overrides.removeProject ?? record("remove-project", true),
    deleteGroup: overrides.deleteGroup ?? record("delete-group", true),
    removeWorkspace:
      overrides.removeWorkspace ??
      record("remove-workspace", {
        ok: true,
        blocker: null,
        archivedThreads: true,
        environmentRemoved: true,
        directory: "removed",
        message: null,
      }),
    spawnThread: overrides.spawnThread ?? record("spawn", "thr_new"),
    renameProject: overrides.renameProject ?? record("rename-project", "New"),
    settleThread: overrides.settleThread ?? record("settle", { ok: true, message: null }),
    snoozeThread: overrides.snoozeThread ?? record("snooze", { ok: true, message: null }),
    setThreadPinned: overrides.setThreadPinned ?? record("pin", true),
    renameThread: overrides.renameThread ?? record("rename-thread", true),
    assignProjectToGroup: overrides.assignProjectToGroup ?? record("assign", true),
    createGroup: overrides.createGroup ?? record("create-group", null),
    renameGroup: overrides.renameGroup ?? record("rename-group", true),
    setWorkspaceAlias: overrides.setWorkspaceAlias ?? record("alias", null),
  };
  return { deps: { index: () => null, refreshIndex: async () => undefined, actions }, calls };
}

describe("thread tools", () => {
  it("settles a batch and reports a per-thread refusal", async () => {
    const { deps } = actionsWith({
      settleThread: async (threadId) =>
        threadId === "thr_b"
          ? { ok: false, message: "bb refused." }
          : { ok: true, message: null },
    });
    const { tool } = registryWith((registry) => registerThreadTools(registry, deps));
    const text = await tool("nest_thread_settle").execute(
      { thread_ids: ["thr_a", "thr_b"], settled: true },
      CONTEXT,
    );
    assert.match(text, /thr_a: done/);
    assert.match(text, /thr_b: bb refused\./);
  });

  it("brings settled threads back with settled false", async () => {
    const { deps, calls } = actionsWith();
    const { tool } = registryWith((registry) => registerThreadTools(registry, deps));
    await tool("nest_thread_settle").execute(
      { thread_ids: ["thr_a"], settled: false },
      CONTEXT,
    );
    assert.deepEqual(calls[0], { name: "settle", args: ["thr_a", false] });
  });

  it("reads an ISO time and refuses one in the past without calling bb", async () => {
    const { deps, calls } = actionsWith();
    const { tool } = registryWith((registry) => registerThreadTools(registry, deps));
    const snooze = tool("nest_thread_snooze");
    const future = new Date(Date.now() + 3_600_000).toISOString();
    await snooze.execute({ thread_ids: ["thr_a"], until: future }, CONTEXT);
    assert.equal(calls[0]?.name, "snooze");
    assert.equal(calls[0]?.args[1], Date.parse(future));

    calls.length = 0;
    const past = await snooze.execute(
      { thread_ids: ["thr_a"], until: "2020-01-01T00:00:00Z" },
      CONTEXT,
    );
    assert.match(past, /in the past/);
    assert.equal(calls.length, 0);

    const nonsense = await snooze.execute(
      { thread_ids: ["thr_a"], until: "tomorrow-ish" },
      CONTEXT,
    );
    assert.match(nonsense, /Could not read/);
    assert.equal(calls.length, 0);
  });

  it("passes null through as unsnooze", async () => {
    const { deps, calls } = actionsWith();
    const { tool } = registryWith((registry) => registerThreadTools(registry, deps));
    await tool("nest_thread_snooze").execute(
      { thread_ids: ["thr_a"], until: null },
      CONTEXT,
    );
    assert.deepEqual(calls[0], { name: "snooze", args: ["thr_a", null] });
  });

  it("pins a batch and reports a refusal", async () => {
    const { deps } = actionsWith({
      setThreadPinned: async (threadId) => threadId !== "thr_b",
    });
    const { tool } = registryWith((registry) => registerThreadTools(registry, deps));
    const text = await tool("nest_thread_pin").execute(
      { thread_ids: ["thr_a", "thr_b"], pinned: true },
      CONTEXT,
    );
    assert.match(text, /thr_a: done/);
    assert.match(text, /thr_b: bb refused\./);
  });

  it("acts on the calling thread when no ids are given", async () => {
    const { deps, calls } = actionsWith();
    const { tool } = registryWith((registry) => registerThreadTools(registry, deps));
    await tool("nest_thread_pin").execute({ pinned: true }, CONTEXT);
    await tool("nest_thread_rename").execute({ title: "Renamed self" }, CONTEXT);
    assert.deepEqual(calls, [
      { name: "pin", args: ["thr_1", true] },
      { name: "rename-thread", args: ["thr_1", "Renamed self"] },
    ]);
  });

  it("trims a title before renaming", async () => {
    const { deps, calls } = actionsWith();
    const { tool } = registryWith((registry) => registerThreadTools(registry, deps));
    await tool("nest_thread_rename").execute(
      { thread_id: "thr_a", title: "  Billing follow-up  " },
      CONTEXT,
    );
    assert.deepEqual(calls[0], { name: "rename-thread", args: ["thr_a", "Billing follow-up"] });
  });
});

const FEATURE: Feature = {
  id: "f_ai",
  name: "AI",
  slug: "ai",
  state: "active",
  position: 0,
  rootPath: "/home/u/NestFeatures/ai",
  hostId: "host_1",
};
const MEMBER: FeatureMember = {
  featureId: "f_ai",
  directory: "tea-app-im",
  path: "/home/u/NestFeatures/ai/tea-app-im",
  repository: "tea-app-im",
  repositoryPath: "/code/tea-app-im",
  branch: "feat/ai",
  hostId: "host_1",
};

function portWith(overrides: Partial<FeatureAgentPort> = {}): {
  port: FeatureAgentPort;
  calls: { name: string; args: unknown[] }[];
} {
  const calls: { name: string; args: unknown[] }[] = [];
  const port: FeatureAgentPort = {
    locate: () => ({ feature: FEATURE, members: [MEMBER], inRoot: true }),
    features: () => [FEATURE],
    membersOf: () => [MEMBER],
    threadPath: async () => FEATURE.rootPath,
    projects: async () => [],
    refresh: async () => undefined,
    create: async () => {
      throw new Error("not in this test");
    },
    addRepositories: async () => [],
    rename: async (featureId, name) => {
      calls.push({ name: "rename", args: [featureId, name] });
      return true;
    },
    reopen: async (featureId) => {
      calls.push({ name: "reopen", args: [featureId] });
    },
    adopt: async (environmentId, featureId) => {
      calls.push({ name: "adopt", args: [environmentId, featureId] });
      return true;
    },
    deleteFeature: async (input) => {
      calls.push({ name: "delete-feature", args: [input.featureId] });
      return { removedWorktrees: 0, leftovers: [], removedFolder: true };
    },
    removeRepository: async (input) => {
      calls.push({ name: "remove-repo", args: [input.featureId, input.directory] });
      return { removed: true };
    },
    ...overrides,
  };
  return { port, calls };
}

describe("the feature tools that do not add work", () => {
  it("renames the caller's feature when no id is given", async () => {
    const { port, calls } = portWith();
    const { tool } = registryWith((registry) => registerFeatureTools(registry, port));
    const text = await tool("nest_feature_rename").execute({ name: " AI 语音 " }, CONTEXT);
    assert.match(text, /AI 语音/);
    assert.deepEqual(calls[0], { name: "rename", args: ["f_ai", "AI 语音"] });
  });

  it("renames a named feature from outside one", async () => {
    const { port, calls } = portWith({ locate: () => null });
    const { tool } = registryWith((registry) => registerFeatureTools(registry, port));
    await tool("nest_feature_rename").execute(
      { name: "New name", feature_id: "f_other" },
      CONTEXT,
    );
    assert.deepEqual(calls[0], { name: "rename", args: ["f_other", "New name"] });
  });

  it("refuses to rename without a feature context", async () => {
    const { port } = portWith({ locate: () => null });
    const { tool } = registryWith((registry) => registerFeatureTools(registry, port));
    const text = await tool("nest_feature_rename").execute({ name: "X" }, CONTEXT);
    assert.match(text, /not running inside a feature/);
  });

  it("reopens a finished feature", async () => {
    const { port, calls } = portWith();
    const { tool } = registryWith((registry) => registerFeatureTools(registry, port));
    await tool("nest_feature_reopen").execute({ feature_id: "f_done" }, CONTEXT);
    assert.deepEqual(calls[0], { name: "reopen", args: ["f_done"] });
  });

  it("files an outside worktree under the caller's feature, or releases it", async () => {
    const { port, calls } = portWith();
    const { tool } = registryWith((registry) => registerFeatureTools(registry, port));
    const adopt = tool("nest_feature_adopt");
    await adopt.execute({ environment_id: "env_x" }, CONTEXT);
    await adopt.execute({ environment_id: "env_x", feature_id: null }, CONTEXT);
    assert.deepEqual(calls, [
      { name: "adopt", args: ["env_x", "f_ai"] },
      { name: "adopt", args: ["env_x", null] },
    ]);
  });
});
