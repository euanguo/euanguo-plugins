import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

import {
  buildFeatureView,
  featureInScope,
  featureThreadAncestors,
  rollupFeatureFamilies,
  type FeatureViewInput,
} from "../lib/domain/feature-view.ts";
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
  env_member: environment("env_member", "/f/ai/tea-app-im"),
  env_buy: environment("env_buy", "/f/ai/tea-app-im-buy", "proj_buy"),
  env_elsewhere: environment("env_elsewhere", "/code/tea-app-im"),
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
    projectNames: new Map([["proj_repo", "tea-app-im"]]),
    workspaceIndex: testWorkspaceIndex({ environments, features, adoptions }),
    scope: { kind: "all" },
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

  it("leaves out a feature the selector unchecked", () => {
    const features = [feature("ai")];
    const rollup = rollupFeatureFamilies({
      families: [{ root: rolling("a", "env_member"), children: [] }],
      features,
      hiddenFeatureIds: ["ai"],
      workspaceIndex: testWorkspaceIndex({ environments, features }),
      now: 1_000,
    });
    assert.equal(rollup.total, 0);
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
    const member = node?.workspaces.find((item) => item.ref.path === "/f/ai/tea-app-im");
    assert.deepEqual(member?.families.map((item) => item.root.id), ["fix"]);
    assert.equal(member?.projectName, "tea-app-im");
    assert.equal(node?.threadCount, 2, "a thread outside the folder is not the feature's");
  });

  it("draws every member workspace, conversation or not, when nothing narrows the list", () => {
    const node = view([feature("ai")]).features[0];
    assert.deepEqual(
      node?.workspaces.map((item) => item.ref.path).sort(),
      ["/f/ai/tea-app-im", "/f/ai/tea-app-im-buy"],
    );
  });

  it("keeps only the members a filter matched", () => {
    const node = view([feature("ai")], {
      showEmpty: false,
      families: [family(thread("fix", "env_member"))],
    }).features[0];
    assert.deepEqual(node?.workspaces.map((item) => item.ref.path), ["/f/ai/tea-app-im"]);
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
    const member = index.byPath.get("host_a\u0000/f/ai/tea-app-im");
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

  it("draws only the features the selector left checked", () => {
    const result = view([feature("shown"), feature("hidden")], {
      hiddenFeatureIds: ["hidden"],
    });
    assert.deepEqual(result.features.map((node) => node.feature.id), ["shown"]);
  });

  it("keeps finished features off the list and on the shelf", () => {
    const result = view([feature("ai"), feature("done", { state: "archived" })]);
    assert.deepEqual(result.features.map((node) => node.feature.id), ["ai"]);
    assert.deepEqual(result.archived.map((item) => item.id), ["done"]);
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
});

/**
 * Only All and the Features tab draw features.
 *
 * A group tab answers "which projects". Deriving features from a group's
 * projects made the IM tab open onto five features above the IM projects,
 * which reads as features filed under a group — they are not.
 */
describe("which scopes draw features", () => {
  it("draws them under All and Features, and nowhere under a group", () => {
    for (const scope of [
      { kind: "all" },
      { kind: "features" },
    ] as const) {
      assert.equal(featureInScope(scope), true);
    }
    for (const scope of [
      { kind: "group", groupId: "grp_im" },
      { kind: "ungrouped" },
    ] as const) {
      assert.equal(featureInScope(scope), false);
    }
  });

  it("keeps a group's own view free of features, whatever its members", () => {
    for (const scope of [
      { kind: "group", groupId: "grp_im" },
      { kind: "ungrouped" },
    ] as const) {
      assert.deepEqual(view([feature("ai")], { scope, showEmpty: true }).features, []);
    }
  });

  it("shows every feature under All and under Features", () => {
    assert.equal(view([feature("ai")], { scope: { kind: "all" } }).features.length, 1);
    assert.equal(
      view([feature("ai")], { scope: { kind: "features" } }).features.length,
      1,
    );
  });
});
