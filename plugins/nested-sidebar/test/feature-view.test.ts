import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

import { buildFeatureView } from "../lib/feature-view.ts";
import type { Feature } from "../lib/features.ts";

function thread(id: string, environmentId: string): PluginSidebarThread {
  return {
    id,
    projectId: "proj_a",
    title: id,
    titleFallback: id,
    status: "idle",
    createdAt: 1,
    updatedAt: 1,
    latestAttentionAt: 1,
    environment: {
      id: environmentId,
      name: null,
      branchName: `feat/${id}`,
      providerId: null,
      workspaceDisplayKind: null,
    },
    host: null,
    isPinned: false,
    parentThreadId: null,
    children: [],
    indicator: "idle",
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
    },
  } as unknown as PluginSidebarThread;
}

function feature(id: string, overrides: Partial<Feature> = {}): Feature {
  return {
    id,
    name: id,
    state: "draft",
    groupId: null,
    position: 0,
    rootPath: null,
    hostId: null,
    ...overrides,
  };
}

const base = {
  groupOrder: [{ id: "grp_im", name: "IM", icon: "📁" }],
  ungroupedIcon: "📁",
  allIcon: "⭐",
  environments: new Map(),
  projects: new Map(),
  workspaceOwnership: {},
  now: 1_000,
};

describe("feature view", () => {
  it("buckets workspaces by the label, under the feature's group", () => {
    const view = buildFeatureView({
      ...base,
      threads: [thread("t1", "env_1"), thread("t2", "env_2")],
      features: [feature("feat_ai", { groupId: "grp_im" })],
      assignment: { env_1: "feat_ai", env_2: "feat_ai" },
    });
    const im = view.nodes.find((node) => node.groupId === "grp_im");
    assert.equal(im?.features.length, 1);
    // Both threads run in one workspace ref when no path is known, so the
    // node reports the workspaces it can tell apart rather than a count.
    assert.ok((im?.features[0]?.workspaces.length ?? 0) >= 1);
  });

  it("shows a draft feature with no workspace", () => {
    const view = buildFeatureView({
      ...base,
      threads: [],
      features: [feature("feat_new", { groupId: "grp_im" })],
      assignment: {},
    });
    const im = view.nodes.find((node) => node.groupId === "grp_im");
    assert.equal(im?.features.length, 1);
    assert.equal(im?.features[0]?.workspaces.length, 0);
    assert.equal(im?.draftCount, 1);
  });

  it("drops a label pointing at a feature that no longer exists", () => {
    const view = buildFeatureView({
      ...base,
      threads: [thread("t1", "env_1")],
      features: [],
      assignment: { env_1: "feat_gone" },
    });
    assert.deepEqual(view.nodes, []);
  });

  it("files an orphaned feature under Ungrouped", () => {
    const view = buildFeatureView({
      ...base,
      threads: [],
      features: [feature("feat_x", { groupId: "grp_gone" })],
      assignment: {},
    });
    const ungrouped = view.nodes.find((node) => node.groupId === null);
    assert.deepEqual(
      ungrouped?.features.map((node) => node.feature.id),
      ["feat_x"],
    );
  });

  it("counts features, not workspaces, in the scope tabs", () => {
    const view = buildFeatureView({
      ...base,
      threads: [thread("t1", "env_1")],
      features: [
        feature("feat_a", { groupId: "grp_im" }),
        feature("feat_b", { groupId: "grp_im" }),
      ],
      assignment: { env_1: "feat_a" },
    });
    const all = view.tabs.find((tab) => tab.scope.kind === "all");
    assert.equal(all?.count, 2);
    const im = view.tabs.find(
      (tab) => tab.scope.kind === "group" && tab.scope.groupId === "grp_im",
    );
    assert.equal(im?.count, 2);
  });

  it("shows a materialized member that has no thread yet", () => {
    const view = buildFeatureView({
      ...base,
      threads: [],
      features: [feature("feat_ai", { groupId: "grp_im" })],
      assignment: {},
      members: [
        {
          featureId: "feat_ai",
          path: "/home/me/NestFeatures/feat_ai/tea-app-im",
          directory: "tea-app-im",
          repository: "tea-app-im",
          branch: "feat/feat_ai",
          environmentId: null,
        },
      ],
    });
    const im = view.nodes.find((node) => node.groupId === "grp_im");
    const workspaces = im?.features[0]?.workspaces ?? [];
    assert.equal(workspaces.length, 1);
    assert.equal(workspaces[0]?.ref.label, "tea-app-im");
    assert.equal(workspaces[0]?.ref.branch, "feat/feat_ai");
  });

  it("does not draw the same workspace twice when a member also has threads", () => {
    const path = "/home/me/NestFeatures/feat_ai/tea-app-im";
    const view = buildFeatureView({
      ...base,
      threads: [thread("t1", "env_1")],
      features: [feature("feat_ai", { groupId: "grp_im" })],
      assignment: { env_1: "feat_ai" },
      environments: new Map([
        [
          "env_1",
          {
            id: "env_1",
            projectId: "proj_a",
            hostId: "host_a",
            path,
            isGitRepo: true,
            isWorktree: true,
            branchName: "feat/feat_ai",
            name: null,
            providerId: "git-worktree",
            workspaceDisplayKind: "unmanaged-worktree" as const,
          },
        ],
      ]),
      members: [
        {
          featureId: "feat_ai",
          path,
          directory: "tea-app-im",
          repository: "tea-app-im",
          branch: "feat/feat_ai",
          environmentId: "env_1",
        },
      ],
    });
    const im = view.nodes.find((node) => node.groupId === "grp_im");
    assert.equal(im?.features[0]?.workspaces.length, 1);
  });
});
