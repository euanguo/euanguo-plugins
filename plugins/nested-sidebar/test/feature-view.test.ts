import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

import {
  buildFeatureView,
  featureThreadAncestors,
  rollupFeatureFamilies,
} from "../lib/feature-view.ts";
import type { Feature } from "../lib/features.ts";
import type { ThreadFamily } from "../lib/inbox.ts";
import type { WorkspaceEnvironmentDescriptor } from "../lib/workspace.ts";

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
    activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
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

const base = {
  adoptions: {},
  members: [],
  showEmpty: true,
  searchQuery: "",
  projects: new Map(),
  projectNames: new Map([["proj_repo", "tea-app-im"]]),
  workspaceOwnership: {},
  now: 1_000,
};

const environments = new Map([
  ["env_root", environment("env_root", "/f/ai", "proj_features")],
  ["env_member", environment("env_member", "/f/ai/tea-app-im")],
  ["env_elsewhere", environment("env_elsewhere", "/code/tea-app-im")],
]);

describe("the status of the whole feature view", () => {
  const rolling = (id: string, environmentId: string, projectId?: string) =>
    thread(id, environmentId, projectId, { indicator: "runtime" });

  it("counts every thread that resolves to a checked feature, children included", () => {
    const rollup = rollupFeatureFamilies({
      ...base,
      families: [
        { root: rolling("a", "env_member"), children: [rolling("b", "env_member")] },
        { root: rolling("c", "env_root", "proj_features"), children: [] },
        { root: rolling("outside", "env_elsewhere"), children: [] },
      ],
      features: [feature("ai")],
      environments,
    });
    assert.equal(rollup.working, 3);
  });

  it("leaves out a feature the selector unchecked", () => {
    const rollup = rollupFeatureFamilies({
      ...base,
      families: [{ root: rolling("a", "env_member"), children: [] }],
      features: [feature("ai")],
      hiddenFeatureIds: ["ai"],
      environments,
    });
    assert.equal(rollup.total, 0);
  });
});

describe("feature view", () => {
  it("puts root conversations flat and member conversations under their worktree", () => {
    const view = buildFeatureView({
      ...base,
      environments,
      families: [
        family(thread("plan", "env_root", "proj_features")),
        family(thread("fix", "env_member")),
        family(thread("other", "env_elsewhere")),
      ],
      features: [feature("ai")],
    });
    const node = view.features[0];
    assert.deepEqual(node?.rootFamilies.map((item) => item.root.id), ["plan"]);
    assert.deepEqual(node?.workspaces.map((item) => item.families.map((f) => f.root.id)), [["fix"]]);
    assert.equal(node?.workspaces[0]?.projectName, "tea-app-im");
    assert.equal(node?.threadCount, 2, "a thread outside the folder is not the feature's");
  });

  it("counts an adopted worktree from outside the folder", () => {
    const view = buildFeatureView({
      ...base,
      environments,
      adoptions: { env_elsewhere: "ai" },
      families: [family(thread("other", "env_elsewhere"))],
      features: [feature("ai")],
    });
    assert.equal(view.features[0]?.threadCount, 1);
  });

  it("draws an empty feature only when nothing narrows the view", () => {
    const shown = buildFeatureView({ ...base, environments, families: [], features: [feature("ai")] });
    assert.equal(shown.features.length, 1);
    const filtered = buildFeatureView({
      ...base,
      environments,
      showEmpty: false,
      families: [],
      features: [feature("ai")],
    });
    assert.equal(filtered.features.length, 0);
    const named = buildFeatureView({
      ...base,
      environments,
      showEmpty: false,
      searchQuery: "A",
      families: [],
      features: [feature("ai")],
    });
    assert.equal(named.features.length, 1, "a search that names the feature finds it");
  });

  /** Features are a flat list, in the user's own order, with no group above them. */
  it("draws features in their own order, with no group level", () => {
    const view = buildFeatureView({
      ...base,
      environments,
      families: [],
      features: [
        feature("second", { position: 1 }),
        feature("first", { position: 0 }),
      ],
    });
    assert.deepEqual(view.features.map((node) => node.feature.id), ["first", "second"]);
    assert.equal("nodes" in view, false);
    assert.equal("tabs" in view, false);
  });

  it("draws only the features the selector left checked", () => {
    const view = buildFeatureView({
      ...base,
      environments,
      families: [],
      features: [feature("shown"), feature("hidden")],
      hiddenFeatureIds: ["hidden"],
    });
    assert.deepEqual(view.features.map((node) => node.feature.id), ["shown"]);
  });

  it("keeps finished features off the list and on the shelf", () => {
    const view = buildFeatureView({
      ...base,
      environments,
      families: [],
      features: [feature("ai"), feature("done", { state: "archived" })],
    });
    assert.deepEqual(view.features.map((node) => node.feature.id), ["ai"]);
    assert.deepEqual(view.archived.map((item) => item.id), ["done"]);
  });

  it("finds the branch that leads to a thread, so it can be revealed", () => {
    const view = buildFeatureView({
      ...base,
      environments,
      families: [family(thread("plan", "env_root", "proj_features")), family(thread("fix", "env_member"))],
      features: [feature("ai")],
    });
    assert.deepEqual(featureThreadAncestors(view.features, "plan"), {
      featureId: "ai",
      workspaceKey: null,
      rootId: "plan",
    });
    assert.equal(featureThreadAncestors(view.features, "fix")?.featureId, "ai");
    assert.notEqual(featureThreadAncestors(view.features, "fix")?.workspaceKey, null);
    assert.equal(featureThreadAncestors(view.features, "nope"), null);
  });
});
