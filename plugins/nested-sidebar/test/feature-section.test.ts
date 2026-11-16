import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  PluginSidebarProject,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";

import type { Feature } from "../lib/domain/features.ts";
import type { GroupScope } from "../lib/domain/groups.ts";
import { buildInboxView, type InboxViewInput } from "../lib/domain/inbox-view.ts";
import type { SidebarMode } from "../lib/domain/organization.ts";
import type {
  WorkspaceEnvironmentDescriptor,
  WorkspacePaths,
} from "../lib/domain/workspace.ts";
import { testWorkspaceIndex } from "./_workspace-index.ts";

function thread(id: string, projectId: string, environmentId: string): PluginSidebarThread {
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
    activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0 },
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
    environment: {
      id: environmentId,
      name: null,
      branchName: null,
      providerId: null,
      workspaceDisplayKind: null,
    },
    host: null,
    createdAt: 0,
    updatedAt: 0,
    lastReadAt: null,
    latestAttentionAt: 0,
  } as PluginSidebarThread;
}

function project(id: string): PluginSidebarProject {
  return { id, name: id, isPersonal: false, href: `/projects/${id}`, settingsHref: `/projects/${id}/settings` };
}

function environment(
  id: string,
  projectId: string,
  path: string,
  isWorktree = true,
): WorkspaceEnvironmentDescriptor {
  return {
    id,
    projectId,
    hostId: "host_1",
    path,
    isGitRepo: true,
    isWorktree,
    branchName: null,
    name: null,
    providerId: null,
    workspaceDisplayKind: isWorktree ? "unmanaged-worktree" : null,
  };
}

function feature(id: string, overrides: Partial<Feature> = {}): Feature {
  return {
    id,
    name: id.toUpperCase(),
    slug: id,
    state: "active",
    position: 0,
    rootPath: `/f/${id}`,
    hostId: "host_1",
    ...overrides,
  };
}

/**
 * Two repositories in two groups, one feature touching both, a second feature
 * touching only the first, and the container project their folders live in.
 */
function viewOf(options: {
  readonly scope?: GroupScope;
  readonly sidebarMode?: SidebarMode;
  readonly features?: readonly Feature[];
} = {}) {
  const features = options.features ?? [
    feature("ai", { position: 0 }),
    feature("pay", { position: 1 }),
  ];
  const paths: WorkspacePaths = {
    environments: {
      env_im: environment("env_im", "proj_im", "/code/im", false),
      env_ai_im: environment("env_ai_im", "proj_im", "/f/ai/im"),
      env_pay_im: environment("env_pay_im", "proj_im", "/f/pay/im"),
      env_buy: environment("env_buy", "proj_buy", "/code/buy", false),
      env_ai_buy: environment("env_ai_buy", "proj_buy", "/f/ai/buy"),
      env_root: environment("env_root", "proj_features", "/f/ai", false),
    },
    projects: {
      proj_im: { projectId: "proj_im", sourcePath: "/code/im", sourceHostId: "host_1" },
      proj_buy: { projectId: "proj_buy", sourcePath: "/code/buy", sourceHostId: "host_1" },
    },
  };
  const input: InboxViewInput = {
    threads: [
      thread("thr_lobby", "proj_im", "env_im"),
      thread("thr_ai_im", "proj_im", "env_ai_im"),
      thread("thr_ai_buy", "proj_buy", "env_ai_buy"),
      thread("thr_plan", "proj_features", "env_root"),
    ],
    projects: [project("proj_im"), project("proj_buy"), project("proj_features")],
    parkedThreadIds: new Set(),
    shelfFor: () => "active",
    wakeAtFor: () => null,
    now: 1_000,
    filterPreset: "all",
    searchQuery: "",
    selectedRootIds: new Set(),
    selectionMode: false,
    sidebarMode: options.sidebarMode ?? "threads",
    groupScope: options.scope ?? { kind: "all" },
    organization: {
      assignment: { proj_im: "grp_im", proj_buy: "grp_iot" },
      sections: [
        { id: "grp_im", name: "IM", icon: "Layer" },
        { id: "grp_iot", name: "IOT", icon: "Layer" },
      ],
    },
    organizationIds: new Set(["grp_im", "grp_iot"]),
    groups: [
      { id: "grp_im", name: "IM", icon: "Layer", position: 0 },
      { id: "grp_iot", name: "IOT", icon: "Layer", position: 1 },
    ],
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
    paths,
    workspaceIndex: testWorkspaceIndex({
      environments: paths.environments,
      projects: paths.projects,
      features,
    }),
    repoFacts: { repoKeyByProject: {} },
    workspaceOwnership: undefined,
    unseenWorkspaces: undefined,
    mergeRepos: false,
    features,
    featureAdoptions: {},
    featureProjectIds: ["proj_features"],
  };
  return buildInboxView(input);
}

function projectRow(view: ReturnType<typeof viewOf>, projectId: string) {
  return view.treeNodes
    .flatMap((node) => node.projects)
    .find((node) => node.project.id === projectId);
}

describe("a worktree in a feature is drawn once", () => {
  it("leaves the project with its own workspaces and conversations only", () => {
    const im = projectRow(viewOf(), "proj_im");
    assert.deepEqual(im?.workspaces.map((workspace) => workspace.ref.path), ["/code/im"]);
    assert.deepEqual(im?.families.map((family) => family.root.id), ["thr_lobby"]);
  });

  it("draws the member and its conversation under the feature instead", () => {
    const ai = viewOf().featureNodes.find((node) => node.feature.id === "ai");
    const member = ai?.workspaces.find((workspace) => workspace.ref.path === "/f/ai/im");
    assert.deepEqual(member?.families.map((family) => family.root.id), ["thr_ai_im"]);
    assert.equal(member?.projectId, "proj_im");
  });

  it("counts what the project lost and points at the first feature holding it", () => {
    const view = viewOf();
    assert.deepEqual(projectRow(view, "proj_im")?.inFeatures, { count: 2, featureId: "ai" });
    assert.deepEqual(projectRow(view, "proj_buy")?.inFeatures, { count: 1, featureId: "ai" });
  });

  it("follows the Features section's order for the feature it points at", () => {
    const view = viewOf({
      features: [feature("ai", { position: 1 }), feature("pay", { position: 0 })],
    });
    assert.deepEqual(projectRow(view, "proj_im")?.inFeatures, { count: 2, featureId: "pay" });
  });

  it("hands a finished feature's worktrees back to their project", () => {
    const view = viewOf({
      features: [feature("ai", { state: "archived" }), feature("pay", { position: 1 })],
    });
    const im = projectRow(view, "proj_im");
    assert.ok(im?.workspaces.some((workspace) => workspace.ref.path === "/f/ai/im"));
    assert.deepEqual(im?.inFeatures, { count: 1, featureId: "pay" });
    assert.equal(projectRow(view, "proj_buy")?.inFeatures, null);
  });

  it("never draws the container project as a project", () => {
    assert.equal(projectRow(viewOf(), "proj_features"), undefined);
  });
});

describe("the Features section in both modes", () => {
  for (const mode of ["threads", "workspaces"] as const) {
    it(`is there in ${mode}`, () => {
      const view = viewOf({ sidebarMode: mode });
      assert.deepEqual(view.featureNodes.map((node) => node.feature.id), ["ai", "pay"]);
      assert.deepEqual(
        view.featureNodes[0]?.rootFamilies.map((family) => family.root.id),
        ["thr_plan"],
      );
    });
  }
});

describe("the strip's Features tab", () => {
  it("sits after All and counts the features", () => {
    const tabs = viewOf().groupTabs;
    assert.deepEqual(tabs.map((tab) => tab.label).slice(0, 2), ["All", "Features"]);
    assert.equal(tabs[1]?.count, 2);
  });

  it("shows the features and no project", () => {
    const view = viewOf({ scope: { kind: "features" } });
    assert.deepEqual(view.treeNodes, []);
    assert.deepEqual(view.featureNodes.map((node) => node.feature.id), ["ai", "pay"]);
  });

  it("draws no features under a project group", () => {
    assert.deepEqual(
      viewOf({ scope: { kind: "group", groupId: "grp_iot" } }).featureNodes,
      [],
    );
    assert.deepEqual(
      viewOf({ scope: { kind: "group", groupId: "grp_im" } }).featureNodes,
      [],
      "a feature is its own axis, not something filed under a group",
    );
  });
});
