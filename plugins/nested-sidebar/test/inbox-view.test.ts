import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  PluginSidebarProject,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";

import { buildInboxView } from "../lib/domain/inbox-view.ts";
import { UNGROUPED_SCOPE_KEY } from "../lib/ui/view-state.ts";
import { testWorkspaceIndex } from "./_workspace-index.ts";

function thread(
  id: string,
  projectId: string,
  overrides: Partial<PluginSidebarThread> = {},
): PluginSidebarThread {
  return {
    id,
    projectId,
    title: id,
    titleFallback: null,
    displayTitle: id,
    parentThreadId: null,
    parentNotifications: "auto",
    lifecycleOwnerThreadId: null,
    sourceThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "codex",
    status: "idle",
    runtimeStatus: "idle",
    queuedWork: "none",
    hasPendingInteraction: false,
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
    },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    pinnedAt: null,
    pinSortKey: null,
    isArchived: false,
    archivedAt: null,
    href: `/projects/${projectId}/threads/${id}`,
    isHidden: false,
    environment: null,
    host: null,
    createdAt: 0,
    updatedAt: 0,
    lastReadAt: null,
    latestAttentionAt: 0,
    ...overrides,
  };
}

function environmentRow(id: string): PluginSidebarThread["environment"] {
  return {
    id,
    name: null,
    branchName: null,
    providerId: null,
    workspaceDisplayKind: null,
  } as PluginSidebarThread["environment"];
}

function project(id: string): PluginSidebarProject {
  return {
    id,
    name: id,
    isPersonal: false,
    href: `/projects/${id}`,
    settingsHref: `/projects/${id}/settings`,
  };
}

describe("inbox view model", () => {
  it("orders the complete tree, splits pins, and counts each scope", () => {
    const view = buildInboxView({
      threads: [
        thread("thr_pinned", "proj_a", {
          isPinned: true,
          pinnedAt: 1,
          pinSortKey: "a",
        }),
        thread("thr_active", "proj_a"),
      ],
      projects: [project("proj_a")],
      parkedThreadIds: new Set(),
      shelfFor: () => "active",
      wakeAtFor: () => null,
      now: 1_000,
      filterPreset: "all",
      searchQuery: "",
      selectedRootIds: new Set(),
      selectionMode: false,
      sidebarMode: "threads",
      groupScope: { kind: "all" },
      organization: {
        assignment: { proj_a: "grp_a" },
        sections: [{ id: "grp_a", name: "Work", icon: "Layer" }],
      },
      organizationIds: new Set(["grp_a"]),
      groups: [
        {
          id: "grp_a",
          name: "Work",
          icon: "Layer",
          position: 0,
        },
      ],
      groupIcons: { all: "Layer", ungrouped: "Layer" },
      viewPreferences: {
        organizationMode: "project",
        projectSort: "manual",
        threadSort: "manual",
        worktreeSort: "manual",
      },
      projectOrder: { grp_a: ["proj_a"] },
      familyOrder: { proj_a: ["thr_pinned", "thr_active"] },
      workspaceOrder: {},
      paths: {
        environments: {},
        projects: {
          proj_a: {
            projectId: "proj_a",
            sourcePath: "/repo/a",
            sourceHostId: "host_1",
          },
        },
      },
      workspaceIndex: testWorkspaceIndex(),
      repoFacts: { repoKeyByProject: {} },
      workspaceOwnership: undefined,
      unseenWorkspaces: undefined,
      mergeRepos: false,
      features: [],
      featureAdoptions: {},
    });

    assert.deepEqual(
      view.pinnedFamilies.map((entry) => entry.family.root.id),
      ["thr_pinned"],
    );
    assert.deepEqual(
      view.unfilteredProjectGroups[0]?.families.map(
        (family) => family.root.id,
      ),
      ["thr_pinned", "thr_active"],
    );
    assert.deepEqual(
      view.projectGroups[0]?.families.map((family) => family.root.id),
      ["thr_active"],
    );
    assert.deepEqual(
      view.groupTabs.map((tab) => [tab.label, tab.count]),
      [
        ["All", 1],
        ["Work", 1],
      ],
    );
  });

  it("filters the tree by the machine tab it counts", () => {
    const view = buildInboxView({
      threads: [thread("thr_active", "proj_a")],
      projects: [project("proj_a")],
      parkedThreadIds: new Set(),
      shelfFor: () => "active",
      wakeAtFor: () => null,
      now: 1_000,
      filterPreset: "all",
      searchQuery: "",
      selectedRootIds: new Set(),
      selectionMode: false,
      sidebarMode: "threads",
      groupScope: { kind: "group", groupId: "host_1" },
      organization: {
        assignment: { proj_a: "host_1" },
        sections: [{ id: "host_1", name: "Machine A", icon: "ComputerIcon" }],
      },
      organizationIds: new Set(["host_1"]),
      groups: [],
      groupIcons: { all: "Layer", ungrouped: "Layer" },
      viewPreferences: {
        organizationMode: "machine",
        projectSort: "manual",
        threadSort: "manual",
        worktreeSort: "manual",
      },
      projectOrder: {},
      familyOrder: {},
      workspaceOrder: {},
      paths: {
        environments: {},
        projects: {
          proj_a: {
            projectId: "proj_a",
            sourcePath: "/repo/a",
            sourceHostId: "host_1",
          },
        },
      },
      workspaceIndex: testWorkspaceIndex(),
      repoFacts: { repoKeyByProject: {} },
      workspaceOwnership: undefined,
      unseenWorkspaces: undefined,
      mergeRepos: false,
      features: [],
      featureAdoptions: {},
    });

    assert.equal(view.groupTabs[1]?.count, 1);
    assert.deepEqual(
      view.projectGroups.map((group) => group.project.id),
      ["proj_a"],
    );
    assert.equal(view.treeNodes.length, 1);
  });

  it("keeps an empty ungrouped destination out of the strip", () => {
    const view = buildInboxView({
      threads: [thread("thr_active", "proj_a")],
      projects: [project("proj_a")],
      parkedThreadIds: new Set(),
      shelfFor: () => "active",
      wakeAtFor: () => null,
      now: 1_000,
      filterPreset: "all",
      searchQuery: "",
      selectedRootIds: new Set(),
      selectionMode: false,
      sidebarMode: "threads",
      groupScope: { kind: "ungrouped" },
      organization: {
        assignment: { proj_a: "grp_a" },
        sections: [{ id: "grp_a", name: "Work", icon: "Layer" }],
      },
      organizationIds: new Set(["grp_a"]),
      groups: [
        {
          id: "grp_a",
          name: "Work",
          icon: "Layer",
          position: 0,
        },
      ],
      groupIcons: { all: "Layer", ungrouped: UNGROUPED_SCOPE_KEY },
      viewPreferences: {
        organizationMode: "project",
        projectSort: "manual",
        threadSort: "manual",
        worktreeSort: "manual",
      },
      projectOrder: {},
      familyOrder: {},
      workspaceOrder: {},
      paths: { environments: {}, projects: {} },
      workspaceIndex: testWorkspaceIndex(),
      repoFacts: { repoKeyByProject: {} },
      workspaceOwnership: undefined,
      unseenWorkspaces: undefined,
      mergeRepos: false,
      features: [],
      featureAdoptions: {},
    });

    assert.equal(
      view.groupTabs.some((tab) => tab.scope.kind === "ungrouped"),
      false,
    );
  });

  /**
   * The Features project is where a feature's root conversation runs. The
   * Features section draws that conversation, so the project is a second
   * entrance to the same work and the project rows leave it out.
   */
  it("hides the Features project and draws its root conversations under the feature", () => {
    const view = buildInboxView({
      threads: [
        thread("thr_root", "proj_features", {
          environment: environmentRow("env_root"),
        }),
        thread("thr_repo", "proj_a"),
        thread("thr_pinned_root", "proj_features", {
          isPinned: true,
          pinnedAt: 1,
          pinSortKey: "a",
          environment: environmentRow("env_root"),
        }),
      ],
      projects: [project("proj_a"), project("proj_features")],
      parkedThreadIds: new Set(),
      shelfFor: () => "active",
      wakeAtFor: () => null,
      now: 1_000,
      filterPreset: "all",
      searchQuery: "",
      selectedRootIds: new Set(),
      selectionMode: false,
      sidebarMode: "threads",
      groupScope: { kind: "all" },
      organization: {
        assignment: { proj_a: "grp_a", proj_features: "grp_a" },
        sections: [{ id: "grp_a", name: "Work", icon: "Layer" }],
      },
      organizationIds: new Set(["grp_a"]),
      groups: [{ id: "grp_a", name: "Work", icon: "Layer", position: 0 }],
      groupIcons: { all: "Layer", ungrouped: "Layer" },
      viewPreferences: {
        organizationMode: "project",
        projectSort: "manual",
        threadSort: "manual",
        worktreeSort: "manual",
      },
      projectOrder: {},
      familyOrder: {},
      workspaceOrder: {},
      paths: {
        environments: {
          env_root: {
            id: "env_root",
            projectId: "proj_features",
            hostId: "host_1",
            path: "/home/u/NestFeatures/ai",
            isGitRepo: false,
            isWorktree: false,
            branchName: null,
            name: null,
            providerId: null,
            workspaceDisplayKind: null,
          },
        },
        projects: {},
      },
      workspaceIndex: testWorkspaceIndex({
        environments: {
          env_root: {
            id: "env_root",
            projectId: "proj_features",
            hostId: "host_1",
            path: "/home/u/NestFeatures/ai",
            isGitRepo: false,
            isWorktree: false,
            branchName: null,
            name: null,
            providerId: null,
            workspaceDisplayKind: null,
          },
        },
        features: [
          {
            id: "ai",
            name: "AI",
            slug: "ai",
            state: "active",
            position: 0,
            rootPath: "/home/u/NestFeatures/ai",
            hostId: "host_1",
          },
        ],
      }),
      repoFacts: { repoKeyByProject: {} },
      workspaceOwnership: undefined,
      unseenWorkspaces: undefined,
      mergeRepos: false,
      features: [
        {
          id: "ai",
          name: "AI",
          slug: "ai",
          state: "active",
          position: 0,
          rootPath: "/home/u/NestFeatures/ai",
          hostId: "host_1",
        },
      ],
      featureAdoptions: {},
      featureProjectIds: ["proj_features"],
    });

    assert.deepEqual(
      view.unfilteredProjectGroups.map((group) => group.project.id),
      ["proj_a"],
      "the container project is not a project row",
    );
    assert.deepEqual(
      view.treeNodes.flatMap((node) => node.projects.map((item) => item.project.id)),
      ["proj_a"],
    );
    assert.deepEqual(
      view.featureNodes.map((node) => node.rootFamilies.map((family) => family.root.id)),
      [["thr_root"]],
      "the root conversation is reached through its feature",
    );
    assert.equal(view.featureNodes[0]?.root?.ref.label, "AI");
    assert.deepEqual(
      view.pinnedFamilies.map((entry) => entry.family.root.id),
      ["thr_pinned_root"],
      "a pin keeps its row although its project is hidden",
    );
    assert.deepEqual(view.groupTabs.map((tab) => [tab.label, tab.count]), [
      ["All", 1],
      ["Work", 1],
    ]);
    assert.equal(
      view.featureSummary.count,
      1,
      "the switch above the strip still counts the feature",
    );
  });

  it("keeps the project strip in workspace mode", () => {
    const view = buildInboxView({
      threads: [thread("thr_root", "proj_features")],
      projects: [project("proj_features")],
      parkedThreadIds: new Set(),
      shelfFor: () => "active",
      wakeAtFor: () => null,
      now: 1_000,
      filterPreset: "all",
      searchQuery: "",
      selectedRootIds: new Set(),
      selectionMode: false,
      sidebarMode: "workspaces",
      groupScope: { kind: "all" },
      organization: {
        assignment: { proj_features: "grp_a" },
        sections: [{ id: "grp_a", name: "Work", icon: "Layer" }],
      },
      organizationIds: new Set(["grp_a"]),
      groups: [{ id: "grp_a", name: "Work", icon: "Layer", position: 0 }],
      groupIcons: { all: "Layer", ungrouped: "Layer" },
      viewPreferences: {
        organizationMode: "project",
        projectSort: "manual",
        threadSort: "manual",
        worktreeSort: "manual",
      },
      projectOrder: {},
      familyOrder: {},
      workspaceOrder: {},
      paths: { environments: {}, projects: {} },
      workspaceIndex: testWorkspaceIndex(),
      repoFacts: { repoKeyByProject: {} },
      workspaceOwnership: undefined,
      unseenWorkspaces: undefined,
      mergeRepos: false,
      features: [],
      featureAdoptions: {},
    });
    assert.equal(view.firstLevel, "workspaces");
    assert.deepEqual(view.groupTabs.map((tab) => tab.label), ["All", "Work"]);
  });
});
