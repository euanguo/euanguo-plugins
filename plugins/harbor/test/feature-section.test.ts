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
  readonly surface?: "features" | "projects";
  readonly sidebarMode?: SidebarMode;
  readonly features?: readonly Feature[];
} = {}) {
  const features = options.features ?? [
    feature("ai", { position: 0 }),
    feature("pay", { position: 1 }),
  ];
  const paths: WorkspacePaths = {
    environments: {
      env_core: environment("env_core", "proj_core", "/code/core", false),
      env_ai_core: environment("env_ai_core", "proj_core", "/f/ai/core"),
      env_pay_core: environment("env_pay_core", "proj_core", "/f/pay/core"),
      env_shop: environment("env_shop", "proj_shop", "/code/shop", false),
      env_ai_shop: environment("env_ai_shop", "proj_shop", "/f/ai/shop"),
      env_root: environment("env_root", "proj_features", "/f/ai", false),
    },
    projects: {
      proj_core: { projectId: "proj_core", sourcePath: "/code/core", sourceHostId: "host_1" },
      proj_shop: { projectId: "proj_shop", sourcePath: "/code/shop", sourceHostId: "host_1" },
    },
  };
  const input: InboxViewInput = {
    threads: [
      thread("thr_lobby", "proj_core", "env_core"),
      thread("thr_ai_core", "proj_core", "env_ai_core"),
      thread("thr_ai_shop", "proj_shop", "env_ai_shop"),
      thread("thr_plan", "proj_features", "env_root"),
    ],
    projects: [project("proj_core"), project("proj_shop"), project("proj_features")],
    parkedThreadIds: new Set(),
    shelfFor: () => "active",
    wakeAtFor: () => null,
    now: 1_000,
    filterPreset: "all",
    searchQuery: "",
    selectedRootIds: new Set(),
    selectionMode: false,
    sidebarMode: options.sidebarMode ?? "threads",
    surface: options.surface ?? "projects",
    groupScope: options.scope ?? { kind: "all" },
    organization: {
      assignment: { proj_core: "grp_core", proj_shop: "grp_infra" },
      sections: [
        { id: "grp_core", name: "Core", icon: "Folder" },
        { id: "grp_infra", name: "Infra", icon: "Folder" },
      ],
    },
    organizationIds: new Set(["grp_core", "grp_infra"]),
    groups: [
      { id: "grp_core", name: "Core", icon: "Folder", position: 0 },
      { id: "grp_infra", name: "Infra", icon: "Folder", position: 1 },
    ],
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
    const core = projectRow(viewOf(), "proj_core");
    assert.deepEqual(core?.workspaces.map((workspace) => workspace.ref.path), ["/code/core"]);
    assert.deepEqual(core?.families.map((family) => family.root.id), ["thr_lobby"]);
  });

  it("draws the member and its conversation under the feature instead", () => {
    const ai = viewOf({ surface: "features" }).featureNodes.find(
      (node) => node.feature.id === "ai",
    );
    const member = ai?.workspaces.find((workspace) => workspace.ref.path === "/f/ai/core");
    assert.deepEqual(member?.families.map((family) => family.root.id), ["thr_ai_core"]);
    assert.equal(member?.projectId, "proj_core");
  });

  it("counts what the project lost and points at the first feature holding it", () => {
    const view = viewOf();
    assert.deepEqual(projectRow(view, "proj_core")?.inFeatures, { count: 2, featureId: "ai" });
    assert.deepEqual(projectRow(view, "proj_shop")?.inFeatures, { count: 1, featureId: "ai" });
  });

  it("follows the Features section's order for the feature it points at", () => {
    const view = viewOf({
      features: [feature("ai", { position: 1 }), feature("pay", { position: 0 })],
    });
    assert.deepEqual(projectRow(view, "proj_core")?.inFeatures, { count: 2, featureId: "pay" });
  });

  it("hands a finished feature's worktrees back to their project", () => {
    const view = viewOf({
      features: [feature("ai", { state: "archived" }), feature("pay", { position: 1 })],
    });
    const core = projectRow(view, "proj_core");
    assert.ok(core?.workspaces.some((workspace) => workspace.ref.path === "/f/ai/core"));
    assert.deepEqual(core?.inFeatures, { count: 1, featureId: "pay" });
    assert.equal(projectRow(view, "proj_shop")?.inFeatures, null);
  });

  it("never draws the container project as a project", () => {
    assert.equal(projectRow(viewOf(), "proj_features"), undefined);
  });
});

describe("the Features switch in both modes", () => {
  for (const mode of ["threads", "workspaces"] as const) {
    it(`shows features cleanly with zero project nodes in ${mode}`, () => {
      const view = viewOf({ surface: "features", sidebarMode: mode });
      assert.deepEqual(view.treeNodes, []);
      assert.deepEqual(view.featureNodes.map((node) => node.feature.id), ["ai", "pay"]);
      assert.deepEqual(
        view.featureNodes[0]?.rootFamilies.map((family) => family.root.id),
        ["thr_plan"],
      );
    });
  }

  it("counts active features even when viewing the Projects surface", () => {
    assert.equal(viewOf({ surface: "projects" }).featureSummary.count, 2);
  });

  it("draws zero features when viewing Projects regardless of group tab", () => {
    assert.deepEqual(viewOf({ surface: "projects" }).featureNodes, []);
    assert.deepEqual(
      viewOf({ surface: "projects", scope: { kind: "group", groupId: "grp_infra" } })
        .featureNodes,
      [],
    );
  });

  it("ignores groupScope when surface is features", () => {
    const view = viewOf({
      surface: "features",
      scope: { kind: "group", groupId: "grp_core" },
    });
    assert.deepEqual(view.treeNodes, []);
    assert.deepEqual(view.featureNodes.map((node) => node.feature.id), ["ai", "pay"]);
  });
});
