import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

import { buildFeatureView, featureThreadAncestors } from "../lib/feature-view.ts";
import type { Feature } from "../lib/features.ts";
import type { ThreadFamily } from "../lib/inbox.ts";
import type { WorkspaceEnvironmentDescriptor } from "../lib/workspace.ts";

function thread(id: string, environmentId: string, projectId = "proj_repo"): PluginSidebarThread {
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
    groupId: null,
    position: 0,
    rootPath: `/f/${id}`,
    hostId: "host_a",
    ...overrides,
  };
}

const base = {
  adoptions: {},
  members: [],
  groupOrder: [{ id: "grp_im", name: "IM", icon: "Layer" }],
  ungroupedIcon: "Layer",
  allIcon: "Layer",
  scope: { kind: "all" } as const,
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
      features: [feature("ai", { groupId: "grp_im" })],
    });
    const node = view.nodes[0]?.features[0];
    assert.equal(view.nodes[0]?.groupId, "grp_im");
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
    assert.equal(view.nodes[0]?.features[0]?.threadCount, 1);
  });

  it("draws an empty feature only when nothing narrows the view", () => {
    const shown = buildFeatureView({ ...base, environments, families: [], features: [feature("ai")] });
    assert.equal(shown.nodes[0]?.features.length, 1);
    const filtered = buildFeatureView({
      ...base,
      environments,
      showEmpty: false,
      families: [],
      features: [feature("ai")],
    });
    assert.equal(filtered.nodes.length, 0);
    const named = buildFeatureView({
      ...base,
      environments,
      showEmpty: false,
      searchQuery: "A",
      families: [],
      features: [feature("ai")],
    });
    assert.equal(named.nodes.length, 1, "a search that names the feature finds it");
  });

  it("scopes by the feature's own group and counts features on the tabs", () => {
    const features = [feature("ai", { groupId: "grp_im" }), feature("billing")];
    const view = buildFeatureView({
      ...base,
      environments,
      families: [],
      features,
      scope: { kind: "group", groupId: "grp_im" },
    });
    assert.deepEqual(view.nodes.map((node) => node.groupId), ["grp_im"]);
    assert.deepEqual(
      view.tabs.map((tab) => [tab.label, tab.count]),
      [["All", 2], ["IM", 1], ["Ungrouped", 1]],
    );
  });

  it("keeps finished features off the tree and on the shelf", () => {
    const view = buildFeatureView({
      ...base,
      environments,
      families: [],
      features: [feature("ai"), feature("done", { state: "archived" })],
    });
    assert.deepEqual(view.nodes[0]?.features.map((node) => node.feature.id), ["ai"]);
    assert.deepEqual(view.archived.map((item) => item.id), ["done"]);
  });

  it("finds the branch that leads to a thread, so it can be revealed", () => {
    const view = buildFeatureView({
      ...base,
      environments,
      families: [family(thread("plan", "env_root", "proj_features")), family(thread("fix", "env_member"))],
      features: [feature("ai", { groupId: "grp_im" })],
    });
    assert.deepEqual(featureThreadAncestors(view.nodes, "plan"), {
      groupId: "grp_im",
      featureId: "ai",
      workspaceKey: null,
      rootId: "plan",
    });
    assert.equal(featureThreadAncestors(view.nodes, "fix")?.featureId, "ai");
    assert.notEqual(featureThreadAncestors(view.nodes, "fix")?.workspaceKey, null);
    assert.equal(featureThreadAncestors(view.nodes, "nope"), null);
  });
});
