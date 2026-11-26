import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import plugin from "../server.ts";

import {
  AGENT_ACCESS_CHANNEL,
  AGENT_ACCESS_KV_KEY,
  AGENT_ACCESS_TIERS,
  DEFAULT_AGENT_ACCESS_TIER,
  HARBOR_AGENT_TOOL_NAMES,
  decodeAgentAccessTier,
  isToolAllowedForTier,
  toolsForAccessTier,
  type AgentAccessTier,
} from "../lib/domain/agent-access.ts";
import { createAgentAccessStore } from "../lib/stores/agent-access-store.ts";
import { agentAccessHandlers } from "../server/rpc/agent-access.ts";
import { wireAgentTools } from "../lib/agent/wire.ts";
import type { AgentToolDeps } from "../lib/agent/actions.ts";
import type { SidebarIndex } from "../lib/agent/index-cache.ts";
import type { FeatureAgentPort } from "../lib/agent/tools-features.ts";
import type { ThreadSpawnPort } from "../lib/agent/tools-spawn.ts";
import { EMPTY_BRIEF } from "../lib/domain/feature-meta.ts";

function createFakeKv(initial: Record<string, unknown> = {}) {
  const data = new Map<string, unknown>(Object.entries(initial));
  return {
    data,
    kv: {
      async get<T>(key: string) {
        return data.get(key) as T | undefined;
      },
      async set(key: string, value: unknown) {
        data.set(key, value);
      },
      async delete(key: string) {
        data.delete(key);
      },
      async list() {
        return [...data.keys()];
      },
    },
  };
}

function makeFakeBb(kvOverrides?: {
  get?: (key: string) => Promise<unknown>;
  set?: (key: string, value: unknown) => Promise<void>;
}) {
  const { data, kv } = createFakeKv();
  const published: { channel: string; payload: unknown }[] = [];
  const invalidated: (readonly string[])[] = [];
  const tools = new Map<
    string,
    {
      name: string;
      execute: (params: unknown, ctx: unknown) => Promise<string>;
    }
  >();
  let configureCb: ((ctx: unknown) => unknown) | null = null;
  let instructionsCb: ((ctx: { threadId: string; projectId: string }) => string | null) | null = null;

  const bb = {
    storage: {
      kv: {
        get: kvOverrides?.get ?? kv.get,
        set: kvOverrides?.set ?? kv.set,
        delete: kv.delete,
        list: kv.list,
      },
    },
    log: {
      warn() {},
    },
    realtime: {
      publish(channel: string, payload: unknown) {
        published.push({ channel, payload });
      },
    },
    rpc: {
      experimental_invalidate(tags: readonly string[]) {
        invalidated.push(tags);
      },
    },
    agents: {
      registerTool(tool: {
        name: string;
        execute: (params: unknown, ctx: unknown) => Promise<string>;
      }) {
        tools.set(tool.name, tool);
      },
      configure(cb: (ctx: unknown) => unknown) {
        configureCb = cb;
      },
      contributeInstructions(
        cb: (ctx: { threadId: string; projectId: string }) => string | null,
      ) {
        instructionsCb = cb;
      },
    },
  } as unknown as BbPluginApi;

  return {
    bb,
    data,
    published,
    invalidated,
    tools,
    configure: (ctx: unknown) => {
      assert.ok(configureCb, "configure callback registered");
      return configureCb(ctx) as {
        tools: string[];
        skills: string[];
        instructions?: string;
      };
    },
    contributeInstructions: (ctx: { threadId: string; projectId: string }) => {
      assert.ok(instructionsCb, "contributeInstructions callback registered");
      return instructionsCb(ctx);
    },
  };
}

function sampleIndex(): SidebarIndex {
  return {
    updatedAt: 1,
    projects: [
      { id: "proj_main", name: "acme-web" },
      { id: "proj_other", name: "sample-portal" },
      { id: "proj_third", name: "acme-sdk" },
    ],
    groups: [
      { id: "grp_core", name: "Core", icon: "Layer", position: 0 },
      { id: "grp_apps", name: "Apps", icon: "Layer", position: 1 },
    ],
    assignment: { proj_main: "grp_core", proj_other: "grp_apps" },
    environments: {
      env_main: {
        id: "env_main",
        projectId: "proj_main",
        hostId: "host_1",
        path: "/Users/example/Code/acme-web",
        isGitRepo: true,
        isWorktree: false,
        branchName: "main",
        name: null,
        providerId: "project-checkout",
        workspaceDisplayKind: "other",
      },
    },
    projectSources: {
      proj_main: {
        projectId: "proj_main",
        sourcePath: "/Users/example/Code/acme-web",
        sourceHostId: "host_1",
      },
    },
    repoFacts: {
      repoKeyByProject: { proj_main: "repo:remote:github.com/example/acme-web" },
      sourceRepoKeyByProject: {
        proj_main: "repo:remote:github.com/example/acme-web",
      },
      workspaceOwnership: {
        env_main: {
          environmentId: "env_main",
          claimedProjectId: "proj_main",
          ownerProjectId: "proj_main",
          workspaceKey: "ws:host_1:/Users/example/Code/acme-web",
          repoKey: "repo:remote:github.com/example/acme-web",
          kind: "project-checkout",
          confidence: "exact-source",
          conflict: false,
        },
      },
      unseenWorkspaces: {},
      repos: [
        {
          key: "repo:remote:github.com/example/acme-web",
          kind: "git-remote",
          name: "acme-web",
          remoteUrl: "github.com/example/acme-web",
          rootPath: "/Users/example/Code/acme-web",
          hostIds: ["host_1"],
          projectIds: ["proj_main"],
          workspaces: [
            {
              key: "ws:host_1:/Users/example/Code/acme-web",
              hostId: "host_1",
              path: "/Users/example/Code/acme-web",
              rawPaths: ["/Users/example/Code/acme-web"],
              environmentIds: ["env_main"],
              projectIds: ["proj_main"],
              repoKey: "repo:remote:github.com/example/acme-web",
              isMainWorktree: true,
              isLinkedWorktree: false,
              isNestedRepository: false,
              repositoryRoot: "/Users/example/Code/acme-web",
            },
          ],
          unseenWorktrees: [],
          diagnostics: [],
        },
      ],
      diagnostics: [],
      unavailableHostIds: [],
    },
  };
}

function stubDeps(index: SidebarIndex | null, onAction?: () => void): AgentToolDeps {
  const act = async () => {
    onAction?.();
    return true;
  };
  return {
    index: () => index,
    refreshIndex: async () => undefined,
    actions: {
      renameProject: async () => {
        onAction?.();
        return "acme";
      },
      settleThread: async () => {
        onAction?.();
        return { ok: true, message: null };
      },
      snoozeThread: async () => {
        onAction?.();
        return { ok: true, message: null };
      },
      setThreadPinned: act,
      renameThread: act,
      deleteThreads: async () => {
        onAction?.();
        return {
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
        };
      },
      removeProject: act,
      deleteGroup: act,
      removeWorkspace: async () => {
        onAction?.();
        return {
          ok: true,
          code: null,
          archivedThreads: true,
          environmentRemoved: true,
          directory: "removed",
          message: null,
        };
      },
      spawnThread: async () => {
        onAction?.();
        return "thr_new";
      },
      assignProjectToGroup: act,
      createGroup: async () => {
        onAction?.();
        return null;
      },
      renameGroup: act,
      setWorkspaceAlias: async () => {
        onAction?.();
        return null;
      },
    },
  };
}

function stubFeatures(insideFeature: boolean): FeatureAgentPort {
  return {
    locate: () =>
      insideFeature
        ? {
            feature: {
              id: "feat_1",
              name: "Checkout Flow",
              slug: "checkout-flow",
              state: "active",
              position: 0,
              rootPath: "/Users/example/features/checkout-flow",
              hostId: "host_1",
            },
            members: [],
            inRoot: true,
          }
        : null,
    features: () => [],
    membersOf: () => [],
    refLinks: () => [],
    threadPath: async () => null,
    threadEnvironmentId: async () => null,
    projects: async () => [],
    refresh: async () => undefined,
    create: async () => {
      throw new Error("unused");
    },
    addRepositories: async () => [],
    rename: async () => true,
    reopen: async () => undefined,
    adopt: async () => true,
    deleteFeature: async () => ({
      removedWorktrees: 0,
      leftovers: [],
      removedFolder: true,
    }),
    removeRepository: async () => ({ removed: true }),
    meta: () => ({ brief: EMPTY_BRIEF, refs: [], decisions: [] }),
    addDecision: async () => {
      throw new Error("unused");
    },
    addRef: async () => {
      throw new Error("unused");
    },
    park: async () => {
      throw new Error("unused");
    },
    unpark: async () => {
      throw new Error("unused");
    },
    promote: async () => {
      throw new Error("unused");
    },
    addReferenceRepo: async () => {
      throw new Error("unused");
    },
    getFeatureGitStatus: async () => ({
      featureId: "feat_1",
      additions: 0,
      deletions: 0,
      dirtyRepoCount: 0,
      behindRepoCount: 0,
      unpushedRepoCount: 0,
      repos: [],
    }),
  };
}

function stubSpawn(): ThreadSpawnPort {
  return {
    locate: () => null,
    threadPath: async () => null,
    environment: async () => null,
    homeProject: async () => null,
    resolveProject: async () => null,
    spawn: async () => "thr_new",
  };
}

describe("agent-access domain model", () => {
  it("defaults to read-only and decodes valid, corrupt, and legacy KV values cleanly", () => {
    assert.equal(DEFAULT_AGENT_ACCESS_TIER, "read-only");
    assert.equal(AGENT_ACCESS_KV_KEY, "agentAccess:v1");
    assert.deepEqual(AGENT_ACCESS_TIERS, ["off", "read-only", "full"]);

    assert.equal(decodeAgentAccessTier("off"), "off");
    assert.equal(decodeAgentAccessTier("read-only"), "read-only");
    assert.equal(decodeAgentAccessTier("full"), "full");
    assert.equal(decodeAgentAccessTier({ tier: "off" }), "off");
    assert.equal(decodeAgentAccessTier({ tier: "read-only" }), "read-only");
    assert.equal(decodeAgentAccessTier({ tier: "full" }), "full");

    for (const bad of [
      undefined,
      null,
      42,
      true,
      [],
      "",
      "context-only",
      "admin",
      { tier: "full-admin" },
      { agentToolsEnabled: true, agentToolsRead: true },
    ]) {
      assert.equal(decodeAgentAccessTier(bad), "read-only");
    }
  });

  it("separates off, read-only, and full tool sets cleanly", () => {
    assert.deepEqual(toolsForAccessTier("off"), []);
    assert.deepEqual(toolsForAccessTier("off", { insideFeature: false }), []);

    assert.deepEqual(toolsForAccessTier("read-only", { insideFeature: false }), [
      "harbor_sidebar_map",
      "harbor_feature_list",
    ]);
    assert.deepEqual(toolsForAccessTier("read-only", { insideFeature: true }), [
      "harbor_sidebar_map",
      "harbor_feature_list",
      "harbor_feature_brief",
      "harbor_feature_git_status",
    ]);

    assert.equal(toolsForAccessTier("full", { insideFeature: false }).length, 6);
    assert.equal(toolsForAccessTier("full", { insideFeature: true }).length, 10);
    assert.deepEqual(
      toolsForAccessTier("full", { insideFeature: true }),
      HARBOR_AGENT_TOOL_NAMES,
    );

    assert.equal(isToolAllowedForTier("harbor_sidebar_map", "off"), false);
    assert.equal(isToolAllowedForTier("harbor_sidebar_organize", "read-only"), false);
    assert.equal(isToolAllowedForTier("harbor_admin_delete", "read-only"), false);
    assert.equal(isToolAllowedForTier("harbor_feature_lifecycle", "read-only"), false);
    assert.equal(isToolAllowedForTier("harbor_thread_spawn", "read-only"), false);
    assert.equal(isToolAllowedForTier("harbor_admin_delete", "full"), true);
  });
});

describe("agent-access KV store and RPC handlers", () => {
  it("defaults to read-only, persists under agentAccess:v1, and recovers from corrupt KV", async () => {
    const fake = makeFakeBb();
    const store = createAgentAccessStore(fake.bb);

    assert.equal(store.current(), "read-only");
    assert.equal(await store.get(), "read-only");

    assert.equal(await store.set("full"), "full");
    assert.deepEqual(fake.data.get(AGENT_ACCESS_KV_KEY), { tier: "full" });
    assert.equal(store.current(), "full");

    // A fresh store instance hydrates the persisted value on startup.
    const reloaded = createAgentAccessStore(fake.bb);
    assert.equal(await reloaded.get(), "full");
    assert.equal(reloaded.current(), "full");

    // Corrupt or legacy KV values fall back cleanly to read-only.
    fake.data.set(AGENT_ACCESS_KV_KEY, { agentToolsEnabled: false });
    assert.equal(await reloaded.get(), "read-only");
    assert.equal(reloaded.current(), "read-only");
  });

  it("serializes concurrent set() writes so later calls never get clobbered", async () => {
    const { data, kv } = createFakeKv();
    let writeCount = 0;
    const fake = makeFakeBb({
      get: kv.get,
      async set(key, value) {
        writeCount += 1;
        const delay = writeCount === 1 ? 25 : 2;
        await new Promise((resolve) => setTimeout(resolve, delay));
        data.set(key, value);
      },
    });
    const store = createAgentAccessStore(fake.bb);
    await store.prime();

    await Promise.all([
      store.set("off"),
      store.set("full"),
      store.set("read-only"),
      store.set("full"),
    ]);

    assert.deepEqual(data.get(AGENT_ACCESS_KV_KEY), { tier: "full" });
    assert.equal(store.current(), "full");
    assert.equal(await store.get(), "full");
  });

  it("falls back to read-only when KV reads throw", async () => {
    const fake = makeFakeBb({
      async get() {
        throw new Error("kv unavailable");
      },
    });
    const store = createAgentAccessStore(fake.bb);
    assert.equal(await store.get(), "read-only");
    assert.equal(store.current(), "read-only");
  });

  it("wires getAgentAccess and setAgentAccess RPC handlers with tag invalidation", async () => {
    const fake = makeFakeBb();
    const agentAccess = createAgentAccessStore(fake.bb);
    const handlers = agentAccessHandlers({ bb: fake.bb, agentAccess });

    assert.deepEqual(await handlers.getAgentAccess({}), {
      tier: "read-only",
    });

    const updated = await handlers.setAgentAccess({ tier: "full" });
    assert.deepEqual(updated, { tier: "full" });
    assert.deepEqual(fake.published, [
      { channel: AGENT_ACCESS_CHANNEL, payload: { tier: "full" } },
    ]);
    assert.deepEqual(fake.invalidated, [["agentAccess"]]);
    assert.deepEqual(await handlers.getAgentAccess({}), {
      tier: "full",
    });
  });

  it("boots server.ts with zero bb.settings descriptors and working agent-access RPC + CLI", async () => {
    const { kv } = createFakeKv();
    const db = new Database(":memory:");
    const disposeCallbacks: (() => void)[] = [];
    const registeredRpc: Record<string, (input: unknown) => Promise<unknown>> = {};
    let cliHandler:
      | ((argv: string[]) => { exitCode: number; stdout: string; stderr: string })
      | null = null;
    let settingsDefined = false;

    const fakeServerBb = {
      storage: {
        kv,
        database: () => db,
        migrate(targetDb: Database.Database, statements: readonly string[]) {
          for (const sql of statements) targetDb.exec(sql);
        },
      },
      settings: {
        define() {
          settingsDefined = true;
          throw new Error("Harbor V3 must not call bb.settings.define");
        },
      },
      log: { warn() {}, info() {}, error() {} },
      realtime: { publish() {} },
      rpc: {
        experimental_invalidate() {},
        register(
          _contract: unknown,
          handlers: Record<string, (input: unknown) => Promise<unknown>>,
        ) {
          Object.assign(registeredRpc, handlers);
        },
      },
      hosts: {
        experimental_client: () => ({ call: async () => ({ facts: [] }) }),
      },
      sdk: {
        projects: { list: async () => [] },
        environments: { list: async () => [] },
        threads: {
          list: async () => [],
          on: () => () => {},
        },
      },
      events: { on() {} },
      schedules: { register() {} },
      onDispose(cb: () => void) {
        disposeCallbacks.push(cb);
      },
      environmentProviders: { register() {} },
      agents: {
        registerTool() {},
        configure() {},
        contributeInstructions() {},
      },
      cli: {
        register(spec: {
          run: (argv: string[]) => { exitCode: number; stdout: string; stderr: string };
        }) {
          cliHandler = spec.run;
        },
      },
    } as unknown as BbPluginApi;

    plugin(fakeServerBb);
    try {
      assert.equal(settingsDefined, false);
      assert.ok(registeredRpc.getAgentAccess);
      assert.ok(registeredRpc.setAgentAccess);
      assert.deepEqual(await registeredRpc.getAgentAccess({}), {
        tier: "read-only",
      });
      assert.deepEqual(await registeredRpc.setAgentAccess({ tier: "full" }), {
        tier: "full",
      });
      assert.ok(cliHandler);
      const cli = (
        cliHandler as (argv: string[]) => {
          exitCode: number;
          stdout: string;
          stderr: string;
        }
      )(["status", "--json"]);
      assert.equal(cli.exitCode, 0);
      const parsed = JSON.parse(cli.stdout) as { tier: string; tools: string[] };
      assert.equal(parsed.tier, "full");
      assert.equal(parsed.tools.length, 10);
    } finally {
      for (const cb of disposeCallbacks) cb();
      db.close();
    }
  });
});

describe("wireAgentTools tier synchronization and prompt budget", () => {
  it("emits 0 tools, 0 skills, and null instructions when tier is off", async () => {
    const tier: AgentAccessTier = "off";
    let mutated = 0;
    const fake = makeFakeBb();
    wireAgentTools({
      bb: fake.bb,
      getTier: () => tier,
      deps: stubDeps(sampleIndex(), () => {
        mutated += 1;
      }),
      features: stubFeatures(false),
      spawn: stubSpawn(),
    });

    const cfg = fake.configure({
      thread: { id: "thr_1", title: null, parentThreadId: null, sourceThreadId: null },
      project: { id: "proj_main", kind: "standard", name: "acme-web", gitRemoteUrl: null },
      environment: {
        id: "env_main",
        name: null,
        path: "/Users/example/Code/acme-web",
        branchName: "main",
        workspaceProvisionType: null,
      },
      host: { id: "host_1", name: "Host" },
      provider: { id: "p", model: "m", capabilities: { supportsNativeUserQuestion: true } },
      origin: { kind: null, pluginId: null },
      pluginMetadata: {},
    });

    assert.deepEqual(cfg, { tools: [], skills: [] });
    assert.equal("instructions" in cfg, false);
    assert.equal(
      fake.contributeInstructions({ threadId: "thr_1", projectId: "proj_main" }),
      null,
    );

    const mapTool = fake.tools.get("harbor_sidebar_map");
    assert.ok(mapTool);
    const refusal = await mapTool.execute({}, { threadId: "thr_1", projectId: "proj_main" });
    assert.match(refusal, /"off"/);
    assert.equal(mutated, 0);
  });

  it("keeps configure() and contributeInstructions() 100% in sync across tiers and stays < 1,000 tokens", async () => {
    let tier: AgentAccessTier = "read-only";
    for (const insideFeature of [false, true]) {
      for (const candidateTier of ["read-only", "full"] as const) {
        tier = candidateTier;
        const fake = makeFakeBb();
        wireAgentTools({
          bb: fake.bb,
          getTier: () => tier,
          deps: stubDeps(sampleIndex()),
          features: stubFeatures(insideFeature),
          spawn: stubSpawn(),
        });

        const cfg = fake.configure({
          thread: { id: "thr_1", title: null, parentThreadId: null, sourceThreadId: null },
          project: { id: "proj_main", kind: "standard", name: "acme-web", gitRemoteUrl: null },
          environment: {
            id: "env_main",
            name: null,
            path: insideFeature
              ? "/Users/example/features/checkout-flow"
              : "/Users/example/Code/acme-web",
            branchName: "main",
            workspaceProvisionType: null,
          },
          host: { id: "host_1", name: "Host" },
          provider: { id: "p", model: "m", capabilities: { supportsNativeUserQuestion: true } },
          origin: { kind: null, pluginId: null },
          pluginMetadata: {},
        });

        const expectedTools = [...toolsForAccessTier(candidateTier, { insideFeature })];
        assert.deepEqual(cfg.tools, expectedTools);
        assert.deepEqual(cfg.skills, insideFeature ? ["feature-workspaces"] : []);

        const prompt = fake.contributeInstructions({
          threadId: "thr_1",
          projectId: "proj_main",
        });
        assert.ok(prompt !== null);
        assert.ok(
          prompt.length < 3500,
          `Prompt exceeded 3500 chars (${prompt.length})`,
        );
        if (candidateTier === "read-only" && !insideFeature) {
          assert.ok(
            prompt.length <= 500,
            `Expected ultra-compact read-only prompt, got ${prompt.length} chars: ${prompt}`,
          );
        }

        const listedLine = prompt
          .split("\n")
          .find((line) => line.startsWith(`Tools (${candidateTier}): `));
        assert.ok(listedLine, "prompt names exact tier tool list");
        const listedTools = listedLine
          .replace(`Tools (${candidateTier}): `, "")
          .replace(/\.$/, "")
          .split(", ");
        assert.deepEqual(listedTools, expectedTools);
      }
    }
  });
});
