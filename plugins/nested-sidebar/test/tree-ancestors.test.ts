import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { threadAncestors, type GroupNode } from "../lib/tree.ts";
import type { ThreadFamily } from "../lib/inbox.ts";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk";

function thread(id: string): PluginSidebarThread {
  return {
    id,
    projectId: "proj_1",
    title: id,
    titleFallback: null,
    displayTitle: id,
    parentThreadId: null,
    lifecycleOwnerThreadId: null,
    sourceThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "openai",
    status: "idle",
    runtimeStatus: "idle",
    queuedWork: "none",
    hasPendingInteraction: false,
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
    },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    pinnedAt: null,
    pinSortKey: null,
    isArchived: false,
    archivedAt: null,
    href: `/projects/proj_1/threads/${id}`,
    isHidden: false,
    environment: null,
    host: null,
    createdAt: 0,
    updatedAt: 0,
    lastReadAt: null,
    latestAttentionAt: 0,
  };
}

function family(rootId: string, childIds: readonly string[]): ThreadFamily {
  return { root: thread(rootId), children: childIds.map(thread) };
}

const nodes: GroupNode[] = [
  {
    groupId: "grp_a",
    name: "Alpha",
    icon: "LayerIcon",
    rollup: null as never,
    projects: [
      {
        project: {
          id: "proj_1",
          name: "One",
          isPersonal: false,
          href: "/projects/proj_1",
          settingsHref: "/projects/proj_1/settings",
        },
        families: [family("thr_root", ["thr_child"])],
        showWorkspaces: false,
        rollup: null as never,
        // This fixture predates the repository axis, so it is the shape a row
        // has when nobody asked: no key, and the one project it stands for.
        repoKey: null,
        mergedProjectIds: ["proj_1"],
        foreignClaimProjectIds: [],
        workspaces: [
          {
            ref: {
              kind: "git-worktree",
              key: "env_1",
              label: "feature",
              alias: null,
              branch: "feature",
              environmentId: "env_1",
              environmentIds: ["env_1"],
              path: "/repo/worktree",
              hostId: "host_fixture",
              diagnostic: null,
            },
            families: [family("thr_root", ["thr_child"])],
            rollup: null as never,
          },
        ],
      },
    ],
  },
];

describe("threadAncestors", () => {
  it("names every level a thread is nested under", () => {
    assert.deepEqual(threadAncestors(nodes, "thr_child"), {
      groupId: "grp_a",
      projectId: "proj_1",
      workspaceKey: "env_1",
      rootId: "thr_root",
    });
  });

  it("resolves a root thread to its own family", () => {
    assert.equal(threadAncestors(nodes, "thr_root")?.rootId, "thr_root");
  });

  it("returns null for a thread the tree does not draw", () => {
    assert.equal(threadAncestors(nodes, "thr_missing"), null);
  });
});
