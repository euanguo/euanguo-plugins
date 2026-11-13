import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  PluginSidebarProject,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";

import { buildInboxView } from "../lib/inbox-view.ts";
import { UNGROUPED_SCOPE_KEY } from "../lib/view-state.ts";

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
      groupAssignment: { proj_a: "grp_a" },
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
      groupAssignment: { proj_a: "grp_a" },
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
   * The Features project is where a feature's root conversation runs. With no
   * separate feature view, hiding it would make that conversation unreachable,
   * so it is a normal project whose workspaces are feature roots.
   */
  it("shows the Features project so its root conversations stay reachable", () => {
    const view = buildInboxView({
      threads: [
        thread("thr_root", "proj_features"),
        thread("thr_repo", "proj_a"),
        thread("thr_pinned_root", "proj_features", {
          isPinned: true,
          pinnedAt: 1,
          pinSortKey: "a",
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
      groupAssignment: { proj_a: "grp_a", proj_features: "grp_a" },
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
    });

    assert.deepEqual(
      view.unfilteredProjectGroups.map((group) => group.project.id),
      ["proj_a", "proj_features"],
      "every project is drawn, including the one holding feature roots",
    );
    assert.deepEqual(
      view.projectGroups.map((group) => group.project.id),
      ["proj_a", "proj_features"],
    );
    assert.equal(
      view.pinnedFamilies.length,
      1,
      "a pinned feature root is visible because its project is visible",
    );
    const featuresProject = view.workspaceTreeNodes
      .flatMap((node) => node.projects)
      .find((node) => node.project.id === "proj_features");
    assert.equal(featuresProject?.workspaces[0]?.ref.label, "AI");
    assert.deepEqual(view.groupTabs.map((tab) => [tab.label, tab.count]), [["All", 2], ["Work", 2]]);
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
      groupAssignment: { proj_features: "grp_a" },
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
