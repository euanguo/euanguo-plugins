import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

import {
  buildFeatureView,
  featureOpenTarget,
  featureThreadAncestors,
  rollupFeatureFamilies,
  type FeatureViewInput,
} from "../lib/domain/feature-view.ts";
import { rollupThreads } from "../lib/domain/rollup.ts";
import type { Feature, FeatureAssignment } from "../lib/domain/features.ts";
import type { ThreadFamily } from "../lib/domain/inbox.ts";
import type { WorkspaceEnvironmentDescriptor } from "../lib/domain/workspace.ts";
import { testWorkspaceIndex } from "./_workspace-index.ts";

function thread(
  id: string,
  environmentId: string,
  projectId = "proj_repo",
  overrides: Partial<PluginSidebarThread> = {},
): PluginSidebarThread {
  return {
    id,
    projectId,
    title: id,
    titleFallback: id,
    status: "idle",
    createdAt: 1,
    updatedAt: 1,
    latestAttentionAt: 1,
    environment: {
      id: environmentId,
      name: null,
      branchName: null,
      providerId: null,
      workspaceDisplayKind: null,
    },
    host: null,
    isPinned: false,
    parentThreadId: null,
    children: [],
    indicator: "idle",
    activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0 },
    ...overrides,
  } as unknown as PluginSidebarThread;
}

const family = (root: PluginSidebarThread): ThreadFamily => ({ root, children: [] });

function environment(id: string, path: string, projectId = "proj_repo"): WorkspaceEnvironmentDescriptor {
  return {
    id,
    projectId,
    hostId: "host_a",
    path,
    isGitRepo: !path.endsWith("/ai"),
    isWorktree: !path.endsWith("/ai"),
    branchName: null,
    name: null,
    providerId: null,
    workspaceDisplayKind: "unmanaged-worktree",
  };
}

function feature(id: string, overrides: Partial<Feature> = {}): Feature {
  return {
    id,
    name: id,
    slug: id,
    state: "active",
    position: 0,
    rootPath: `/f/${id}`,
    hostId: "host_a",
    ...overrides,
  };
}

const environments = {
  env_root: environment("env_root", "/f/ai", "proj_features"),
  env_member: environment("env_member", "/f/ai/acme-web"),
  env_buy: environment("env_buy", "/f/ai/acme-web-shop", "proj_buy"),
  env_elsewhere: environment("env_elsewhere", "/code/acme-web"),
};

function view(
  features: readonly Feature[],
  overrides: Partial<FeatureViewInput> & { adoptions?: FeatureAssignment } = {},
) {
  const { adoptions = {}, ...rest } = overrides;
  return buildFeatureView({
    families: [],
    features,
    members: [],
    showEmpty: true,
    searchQuery: "",
    projectNames: new Map([["proj_repo", "acme-web"]]),
    workspaceIndex: testWorkspaceIndex({ environments, features, adoptions }),
    now: 1_000,
    ...rest,
  });
}

describe("the status of the whole Features section", () => {
  const rolling = (id: string, environmentId: string, projectId?: string) =>
    thread(id, environmentId, projectId, { indicator: "runtime" });

  it("counts every thread that resolves to a checked feature, children included", () => {
    const features = [feature("ai")];
    const rollup = rollupFeatureFamilies({
      families: [
        { root: rolling("a", "env_member"), children: [rolling("b", "env_member")] },
        { root: rolling("c", "env_root", "proj_features"), children: [] },
        { root: rolling("outside", "env_elsewhere"), children: [] },
      ],
      features,
      workspaceIndex: testWorkspaceIndex({ environments, features }),
      now: 1_000,
    });
    assert.equal(rollup.working, 3);
  });
});

describe("the Features section", () => {
  it("puts root conversations flat and member conversations under their worktree", () => {
    const result = view([feature("ai")], {
      families: [
        family(thread("plan", "env_root", "proj_features")),
        family(thread("fix", "env_member")),
        family(thread("other", "env_elsewhere")),
      ],
    });
    const node = result.features[0];
    assert.deepEqual(node?.rootFamilies.map((item) => item.root.id), ["plan"]);
    assert.equal(node?.root?.ref.label, "ai", "the folder row carries the feature's name");
    const member = node?.workspaces.find((item) => item.ref.path === "/f/ai/acme-web");
    assert.deepEqual(member?.families.map((item) => item.root.id), ["fix"]);
    assert.equal(member?.projectName, "acme-web");
    assert.equal(node?.threadCount, 2, "a thread outside the folder is not the feature's");
  });

  it("draws every member workspace, conversation or not, when nothing narrows the list", () => {
    const node = view([feature("ai")]).features[0];
    assert.deepEqual(
      node?.workspaces.map((item) => item.ref.path).sort(),
      ["/f/ai/acme-web", "/f/ai/acme-web-shop"],
    );
  });

  it("keeps only the members a filter matched", () => {
    const node = view([feature("ai")], {
      showEmpty: false,
      families: [family(thread("fix", "env_member"))],
    }).features[0];
    assert.deepEqual(node?.workspaces.map((item) => item.ref.path), ["/f/ai/acme-web"]);
    assert.equal(node?.root, null, "an empty folder row is filtered out with the rest");
  });

  it("counts an adopted worktree from outside the folder", () => {
    const result = view([feature("ai")], {
      adoptions: { env_elsewhere: "ai" },
      families: [family(thread("other", "env_elsewhere"))],
    });
    assert.equal(result.features[0]?.threadCount, 1);
  });

  it("leaves out a workspace another section draws", () => {
    const features = [feature("ai")];
    const index = testWorkspaceIndex({ environments, features });
    const member = index.byPath.get("host_a\u0000/f/ai/acme-web");
    assert.ok(member);
    const node = view(features, {
      workspaceIndex: index,
      drawnElsewhere: new Set([member.key]),
    }).features[0];
    assert.equal(node?.workspaces.some((item) => item.ref.key === member.key), false);
  });

  it("draws an empty feature only when nothing narrows the list", () => {
    const empty = [feature("solo", { rootPath: "/f/solo" })];
    assert.equal(view(empty).features.length, 1);
    assert.equal(view(empty, { showEmpty: false }).features.length, 0);
    assert.equal(
      view(empty, { showEmpty: false, searchQuery: "SOL" }).features.length,
      1,
      "a search that names the feature finds it",
    );
  });

  it("draws features in their own order", () => {
    const result = view([
      feature("second", { position: 1 }),
      feature("first", { position: 0 }),
    ]);
    assert.deepEqual(result.features.map((node) => node.feature.id), ["first", "second"]);
  });

  it("keeps finished features off the list and on the shelf", () => {
    const result = view([feature("ai"), feature("done", { state: "archived" })]);
    assert.deepEqual(result.features.map((node) => node.feature.id), ["ai"]);
    assert.deepEqual(result.archived.map((item) => item.id), ["done"]);
  });

  it("filters features by Needs you, Dirty, and Stale presets", () => {
    const staleNow = 100 * 86_400_000;
    const oldAt = staleNow - 10 * 86_400_000;
    const recentAt = staleNow - 60_000;
    const features = [
      feature("needs"),
      feature("dirty-only"),
      feature("stale-only"),
    ];
    const envs = {
      env_needs: environment("env_needs", "/f/needs/acme-web"),
      env_dirty: environment("env_dirty", "/f/dirty-only/acme-web"),
      env_stale: environment("env_stale", "/f/stale-only/acme-web"),
    };
    const index = testWorkspaceIndex({ environments: envs, features });
    const families: ThreadFamily[] = [
      family(
        thread("thr_needs", "env_needs", "proj_repo", {
          hasPendingInteraction: true,
          indicator: "waiting-for-input",
          updatedAt: recentAt,
          latestAttentionAt: recentAt,
        }),
      ),
      family(
        thread("thr_dirty", "env_dirty", "proj_repo", {
          updatedAt: recentAt,
          latestAttentionAt: recentAt,
        }),
      ),
      family(
        thread("thr_stale", "env_stale", "proj_repo", {
          updatedAt: oldAt,
          latestAttentionAt: oldAt,
        }),
      ),
    ];

    const needsYou = buildFeatureView({
      families,
      features,
      members: [],
      workspaceIndex: index,
      filter: "needs-you",
      showEmpty: false,
      searchQuery: "",
      projectNames: new Map([["proj_repo", "acme-web"]]),
      now: staleNow,
    });
    assert.deepEqual(
      needsYou.features.map((node) => node.feature.id),
      ["needs"],
    );

    const dirty = buildFeatureView({
      families,
      features,
      members: [],
      workspaceIndex: index,
      workspaceChanges: new Map([["env_dirty", { insertions: 3, deletions: 1 }]]),
      filter: "dirty",
      showEmpty: false,
      searchQuery: "",
      projectNames: new Map([["proj_repo", "acme-web"]]),
      now: staleNow,
    });
    assert.deepEqual(
      dirty.features.map((node) => node.feature.id),
      ["dirty-only"],
    );

    const stale = buildFeatureView({
      families,
      features,
      members: [],
      workspaceIndex: index,
      filter: "stale",
      showEmpty: false,
      searchQuery: "",
      projectNames: new Map([["proj_repo", "acme-web"]]),
      now: staleNow,
    });
    assert.deepEqual(
      stale.features.map((node) => node.feature.id),
      ["stale-only"],
    );
  });

  it("matches parked features by name, reason, or note when searching", () => {
    const parkedOne = feature("wait-qa", {
      state: "parked",
      parkedReason: "waiting-qa",
      parkedNote: "Needs staging deploy",
    });
    const parkedTwo = feature("other", {
      state: "parked",
      parkedReason: "deferred",
    });
    const result = view([parkedOne, parkedTwo], { searchQuery: "staging" });
    assert.deepEqual(
      result.parked.map((item) => item.id),
      ["wait-qa"],
    );
  });

  it("finds the branch that leads to a thread, so it can be revealed", () => {
    const result = view([feature("ai")], {
      families: [
        family(thread("plan", "env_root", "proj_features")),
        family(thread("fix", "env_member")),
      ],
    });
    assert.deepEqual(featureThreadAncestors(result.features, "plan"), {
      featureId: "ai",
      workspaceKey: null,
      rootId: "plan",
    });
    assert.equal(featureThreadAncestors(result.features, "fix")?.featureId, "ai");
    assert.notEqual(featureThreadAncestors(result.features, "fix")?.workspaceKey, null);
    assert.equal(featureThreadAncestors(result.features, "nope"), null);
  });

  it("picks featureOpenTarget with urgent > remembered > latest root > latest member > new-feature-chat", () => {
    const rootOld = family(thread("root_old", "env_root", "proj_features", { updatedAt: 100, createdAt: 10 }));
    const rootNew = family(thread("root_new", "env_root", "proj_features", { updatedAt: 300, createdAt: 20 }));
    const memberNew = family(thread("mem_new", "env_member", "proj_repo", { updatedAt: 500, createdAt: 30 }));
    const urgent = family(
      thread("mem_wait", "env_member", "proj_repo", {
        hasPendingInteraction: true,
        indicator: "waiting-for-input",
        updatedAt: 50,
      }),
    );

    const urgentRollup = rollupThreads([rootNew.root, urgent.root], 1_000);
    assert.deepEqual(
      featureOpenTarget({
        featureId: "ai",
        rollup: urgentRollup,
        rootFamilies: [rootNew],
        memberFamilies: [urgent],
        lastActiveThreadId: "root_new",
      }),
      { kind: "thread", threadId: "mem_wait" },
    );

    const quietRollup = rollupThreads([rootOld.root, rootNew.root, memberNew.root], 1_000);
    assert.deepEqual(
      featureOpenTarget({
        featureId: "ai",
        rollup: quietRollup,
        rootFamilies: [rootOld, rootNew],
        memberFamilies: [memberNew],
        lastActiveThreadId: "root_old",
      }),
      { kind: "thread", threadId: "root_old" },
    );

    assert.deepEqual(
      featureOpenTarget({
        featureId: "ai",
        rollup: quietRollup,
        rootFamilies: [rootOld, rootNew],
        memberFamilies: [memberNew],
        lastActiveThreadId: "missing",
      }),
      { kind: "thread", threadId: "root_new" },
    );

    assert.deepEqual(
      featureOpenTarget({
        featureId: "ai",
        rollup: rollupThreads([memberNew.root], 1_000),
        rootFamilies: [],
        memberFamilies: [memberNew],
        lastActiveThreadId: null,
      }),
      { kind: "thread", threadId: "mem_new" },
    );

    assert.deepEqual(
      featureOpenTarget({
        featureId: "ai",
        rollup: rollupThreads([], 1_000),
        rootFamilies: [],
        memberFamilies: [],
        lastActiveThreadId: null,
      }),
      { kind: "new-feature-chat", featureId: "ai" },
    );
  });

  it("sorts features by pinned order first, then by activity, status, name, or manual order", () => {
    const features = [
      feature("alpha", { name: "Alpha", position: 2 }),
      feature("beta", { name: "Beta", position: 1 }),
      feature("gamma", { name: "Gamma", position: 0 }),
    ];
    const envs = {
      env_a: environment("env_a", "/f/alpha", "proj_features"),
      env_b: environment("env_b", "/f/beta", "proj_features"),
      env_g: environment("env_g", "/f/gamma", "proj_features"),
    };
    const index = testWorkspaceIndex({ environments: envs, features });
    const families = [
      family(thread("t_a", "env_a", "proj_features", { updatedAt: 300 })),
      family(
        thread("t_b", "env_b", "proj_features", {
          updatedAt: 100,
          hasPendingInteraction: true,
          indicator: "waiting-for-input",
        }),
      ),
      family(thread("t_g", "env_g", "proj_features", { updatedAt: 200 })),
    ];

    const byActivity = buildFeatureView({
      families,
      features,
      members: [],
      workspaceIndex: index,
      sort: "activity",
      showEmpty: true,
      searchQuery: "",
      projectNames: new Map(),
      now: 1_000,
    });
    assert.deepEqual(
      byActivity.features.map((n) => n.feature.id),
      ["alpha", "gamma", "beta"],
    );

    const byStatusWithPin = buildFeatureView({
      families,
      features,
      members: [],
      workspaceIndex: index,
      sort: "status",
      pinnedFeatureIds: ["gamma"],
      showEmpty: true,
      searchQuery: "",
      projectNames: new Map(),
      now: 1_000,
    });
    assert.deepEqual(
      byStatusWithPin.features.map((n) => n.feature.id),
      ["gamma", "beta", "alpha"],
    );

    const byName = buildFeatureView({
      families,
      features,
      members: [],
      workspaceIndex: index,
      sort: "name",
      showEmpty: true,
      searchQuery: "",
      projectNames: new Map(),
      now: 1_000,
    });
    assert.deepEqual(
      byName.features.map((n) => n.feature.id),
      ["alpha", "beta", "gamma"],
    );

    const byManual = buildFeatureView({
      families,
      features,
      members: [],
      workspaceIndex: index,
      sort: "manual",
      showEmpty: true,
      searchQuery: "",
      projectNames: new Map(),
      now: 1_000,
    });
    assert.deepEqual(
      byManual.features.map((n) => n.feature.id),
      ["gamma", "beta", "alpha"],
    );
  });
});
