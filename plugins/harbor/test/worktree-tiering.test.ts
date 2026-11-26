import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { PluginSidebarProject, PluginSidebarThread } from "@get-bb/plugin-sdk/app";

import { resolveWorkspaceFacts } from "../host/workspace-facts.ts";
import { SIDEBAR_INDEX_MIGRATION, createSidebarIndexCache } from "../lib/agent/index-cache.ts";
import type { Feature, FeatureMember } from "../lib/domain/features.ts";
import { inferRepos } from "../lib/domain/repo-identity.ts";
import { buildTree, searchTree } from "../lib/domain/tree.ts";
import {
  FRESH_WORKTREE_WINDOW_MS,
  UNMANAGED_ACTIVE_WORKTREE_WINDOW_MS,
  classifyWorktreeTier,
  type WorkspaceEnvironmentDescriptor,
  type WorkspaceProjectDescriptor,
  type WorkspaceRef,
} from "../lib/domain/workspace.ts";
import { buildWorkspaceIndex } from "../lib/domain/workspace-index.ts";
import { physicalWorkspaceKey } from "../lib/domain/workspace-key.ts";
import {
  classifyBatchSurvey,
  dirtyBatchWorktreeReason,
  failedBatchSurvey,
  worktreePlanDigest,
  type WorktreeSurvey,
} from "../lib/domain/worktree-removal.ts";
import {
  FEATURE_BRANCH_MIGRATION,
  FEATURE_CONTAINER_MIGRATION,
  FEATURE_LABEL_MIGRATION,
  FEATURE_MIGRATION,
  FEATURE_PARK_MIGRATIONS,
  FEATURE_ROOT_CHOICE_MIGRATION,
  createFeatureStore,
} from "../lib/stores/feature-store.ts";
import { PROJECT_ICON_MIGRATION, createProjectIconStore } from "../lib/stores/project-icon-store.ts";
import { createRepoFactsCache, type WorkspaceProbe } from "../lib/stores/repo-facts.ts";
import { createLifecycleService } from "../server/lifecycle-service.ts";
import { projectIconHandlers, PROJECT_ICON_MISS_TTL_MS } from "../server/rpc/settings.ts";
import { createSidebarIndexService } from "../server/sidebar-index-service.ts";
import { createWorkspaceService } from "../server/workspace-service.ts";
import { createWorktreeRemovalService } from "../server/worktree-removal-service.ts";

const NOW = 2_000_000_000_000;
const HOST = "host_1";

function makeRef(overrides: Partial<WorkspaceRef> = {}): WorkspaceRef {
  return {
    kind: "git-worktree",
    key: physicalWorkspaceKey(HOST, "/repos/acme-app-wt"),
    label: "feat/default",
    alias: null,
    branch: "feat/default",
    environmentId: "env_wt",
    environmentIds: ["env_wt"],
    path: "/repos/acme-app-wt",
    hostId: HOST,
    diagnostic: null,
    managed: true,
    createdAt: NOW - 10 * 24 * 60 * 60 * 1000,
    dangling: false,
    lastActiveAt: null,
    ...overrides,
  };
}

function makeDescriptor(
  id: string,
  projectId: string,
  workspacePath: string,
  overrides: Partial<WorkspaceEnvironmentDescriptor> = {},
): WorkspaceEnvironmentDescriptor {
  return {
    id,
    projectId,
    hostId: HOST,
    path: workspacePath,
    isGitRepo: true,
    isWorktree: true,
    branchName: `feat/${id}`,
    name: null,
    providerId: "git-worktree",
    workspaceDisplayKind: "managed-worktree",
    managed: true,
    createdAt: NOW - 10 * 24 * 60 * 60 * 1000,
    updatedAt: null,
    providerInstanceKey: null,
    dangling: false,
    ...overrides,
  };
}

function makeProject(id: string, name = id): PluginSidebarProject {
  return {
    id,
    name,
    isPersonal: false,
    href: `/projects/${id}`,
    settingsHref: `/projects/${id}/settings`,
  };
}

function makeThread(
  id: string,
  projectId: string,
  environmentId: string,
  overrides: Partial<PluginSidebarThread> = {},
): PluginSidebarThread {
  return {
    id,
    projectId,
    title: `Thread ${id}`,
    titleFallback: null,
    displayTitle: `Thread ${id}`,
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
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    pinnedAt: null,
    pinSortKey: null,
    isArchived: false,
    archivedAt: null,
    activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0 },
    href: `/projects/${projectId}/threads/${id}`,
    isHidden: false,
    environment: {
      id: environmentId,
      name: null,
      branchName: null,
      path: `/repos/acme-app-${environmentId}`,
      isWorktree: true,
      providerId: "git-worktree",
      workspaceDisplayKind: "managed-worktree",
    },
    host: null,
    createdAt: NOW - 1_000,
    updatedAt: NOW - 1_000,
    lastReadAt: NOW,
    latestAttentionAt: 0,
    ...overrides,
  };
}

function makeSurvey(overrides: Partial<WorktreeSurvey> = {}): WorktreeSurvey {
  return {
    path: "/repos/acme-app-wt",
    hostId: HOST,
    branch: "feat/cleanup",
    bbOwned: true,
    gitWorktree: true,
    directoryExists: true,
    mainRepoPath: "/repos/acme-app",
    changedFiles: 0,
    untrackedFiles: 0,
    aheadCommits: 0,
    baseRef: "origin/main",
    threads: 1,
    liveThreads: 0,
    openTerminals: 0,
    ...overrides,
  };
}

describe("classifyWorktreeTier", () => {
  const baseInput = {
    openFamilyCount: 0,
    isActiveWorkspace: false,
    hasOpenPullRequest: false,
    inManualOrder: false,
    lastActiveAt: null as number | null,
    now: NOW,
  };

  it("keeps project-checkout primary even when empty, dangling, and old", () => {
    const tier = classifyWorktreeTier({
      ...baseInput,
      ref: makeRef({ kind: "project-checkout", dangling: true, createdAt: 1 }),
    });
    assert.equal(tier, "primary");
  });

  it("keeps active workspace, open threads, open PRs, aliases, and manual order primary", () => {
    const oldIdle = makeRef();
    assert.equal(classifyWorktreeTier({ ...baseInput, ref: oldIdle }), "inactive");
    assert.equal(
      classifyWorktreeTier({ ...baseInput, ref: oldIdle, isActiveWorkspace: true }),
      "primary",
    );
    assert.equal(
      classifyWorktreeTier({ ...baseInput, ref: oldIdle, openFamilyCount: 1 }),
      "primary",
    );
    assert.equal(
      classifyWorktreeTier({ ...baseInput, ref: oldIdle, hasOpenPullRequest: true }),
      "primary",
    );
    assert.equal(
      classifyWorktreeTier({
        ...baseInput,
        ref: makeRef({ alias: "custom-name" }),
      }),
      "primary",
    );
    assert.equal(
      classifyWorktreeTier({ ...baseInput, ref: oldIdle, inManualOrder: true }),
      "primary",
    );
  });

  it("keeps fresh non-dangling worktrees primary for 24h", () => {
    const fresh = makeRef({ createdAt: NOW - FRESH_WORKTREE_WINDOW_MS + 1_000 });
    const expired = makeRef({ createdAt: NOW - FRESH_WORKTREE_WINDOW_MS });
    const danglingFresh = makeRef({
      createdAt: NOW - 1_000,
      dangling: true,
    });
    assert.equal(classifyWorktreeTier({ ...baseInput, ref: fresh }), "primary");
    assert.equal(classifyWorktreeTier({ ...baseInput, ref: expired }), "inactive");
    assert.equal(classifyWorktreeTier({ ...baseInput, ref: danglingFresh }), "inactive");
  });

  it("keeps unmanaged non-dangling worktrees primary within 7d of activity", () => {
    const recent = NOW - UNMANAGED_ACTIVE_WORKTREE_WINDOW_MS + 1_000;
    const stale = NOW - UNMANAGED_ACTIVE_WORKTREE_WINDOW_MS;
    const unmanaged = makeRef({ managed: false, createdAt: null, lastActiveAt: null });

    assert.equal(
      classifyWorktreeTier({ ...baseInput, ref: unmanaged, lastActiveAt: recent }),
      "primary",
    );
    assert.equal(
      classifyWorktreeTier({ ...baseInput, ref: unmanaged, lastActiveAt: stale }),
      "inactive",
    );
    assert.equal(
      classifyWorktreeTier({
        ...baseInput,
        ref: makeRef({ managed: true, createdAt: null }),
        lastActiveAt: recent,
      }),
      "inactive",
    );
    assert.equal(
      classifyWorktreeTier({
        ...baseInput,
        ref: makeRef({ managed: false, dangling: true, createdAt: null }),
        lastActiveAt: recent,
      }),
      "inactive",
    );
  });

  it("treats null lastActiveAt on unmanaged worktree with small now clock as inactive", () => {
    const ref = makeRef({ managed: false, createdAt: null, lastActiveAt: null });
    assert.equal(
      classifyWorktreeTier({
        ...baseInput,
        ref,
        now: 1_000,
      }),
      "inactive",
    );
  });
});

describe("buildTree & searchTree worktree tiering", () => {
  const projectId = "proj_1";
  const envMain = makeDescriptor("env_main", projectId, "/repos/acme-app", {
    isWorktree: false,
    branchName: "main",
    workspaceDisplayKind: "other",
    managed: false,
  });
  const envInactiveOld = makeDescriptor("env_old", projectId, "/repos/acme-app-old", {
    branchName: "feat/old-branch",
    updatedAt: NOW - 30 * 24 * 60 * 60 * 1000,
  });
  const envInactiveNew = makeDescriptor("env_new", projectId, "/repos/acme-app-new", {
    branchName: "feat/newer-idle",
    updatedAt: NOW - 2 * 24 * 60 * 60 * 1000,
  });
  const envBusy = makeDescriptor("env_busy", projectId, "/repos/acme-app-busy", {
    branchName: "feat/busy",
  });
  const projects: Record<string, WorkspaceProjectDescriptor> = {
    [projectId]: {
      projectId,
      sourcePath: "/repos/acme-app",
      sourceHostId: HOST,
    },
  };
  const environments: Record<string, WorkspaceEnvironmentDescriptor> = {
    env_main: envMain,
    env_old: envInactiveOld,
    env_new: envInactiveNew,
    env_busy: envBusy,
  };

  function runTree(options: {
    filterActive?: boolean;
    activeWorkspaceKey?: string | null;
    openPullRequestWorkspaceKeys?: ReadonlySet<string>;
  } = {}) {
    return buildTree({
      projectGroups: [
        {
          project: makeProject(projectId, "Acme App"),
          families: [{ root: makeThread("thr_1", projectId, "env_busy"), children: [] }],
        },
      ],
      now: NOW,
      assignment: {},
      groupOrder: [],
      workspaceOrder: {},
      ungroupedIcon: "LayerIcon",
      workspaceIndex: buildWorkspaceIndex({ environments, projects }),
      environments: new Map(Object.entries(environments)),
      ...options,
    });
  }

  it("folds inactive worktrees sorted by recent activity while keeping primary tier lean", () => {
    const groups = runTree();
    const project = groups[0]?.projects[0];
    assert.ok(project);
    assert.deepEqual(
      project.workspaces.map((ws) => ws.ref.environmentId),
      ["env_main", "env_busy"],
    );
    assert.deepEqual(
      project.inactiveWorkspaces.map((ws) => ws.ref.environmentId),
      ["env_new", "env_old"],
    );
  });

  it("promotes active workspace or open-PR workspace to primary tier", () => {
    const groups = runTree({
      activeWorkspaceKey: physicalWorkspaceKey(HOST, "/repos/acme-app-old"),
      openPullRequestWorkspaceKeys: new Set([
        physicalWorkspaceKey(HOST, "/repos/acme-app-new"),
      ]),
    });
    const project = groups[0]?.projects[0];
    assert.ok(project);
    assert.deepEqual(
      project.workspaces.map((ws) => ws.ref.environmentId),
      ["env_main", "env_busy", "env_new", "env_old"],
    );
    assert.equal(project.inactiveWorkspaces.length, 0);
  });

  it("drops empty primary checkouts and clears inactiveWorkspaces when filterActive is true", () => {
    const groups = runTree({ filterActive: true });
    const project = groups[0]?.projects[0];
    assert.ok(project);
    assert.deepEqual(
      project.workspaces.map((ws) => ws.ref.environmentId),
      ["env_busy"],
    );
    assert.deepEqual(project.inactiveWorkspaces, []);
  });

  it("promotes matching inactive worktrees on branch/path search and keeps them folded on project match", () => {
    const groups = runTree();
    const byBranch = searchTree(groups, "newer-idle");
    const branchProject = byBranch[0]?.projects[0];
    assert.ok(branchProject);
    assert.deepEqual(
      branchProject.workspaces.map((ws) => ws.ref.environmentId),
      ["env_new"],
    );
    assert.equal(branchProject.inactiveWorkspaces.length, 0);
    assert.equal(branchProject.showWorkspaces, true);

    const byPath = searchTree(groups, "acme-app-old");
    assert.deepEqual(
      byPath[0]?.projects[0]?.workspaces.map((ws) => ws.ref.environmentId),
      ["env_old"],
    );

    const byProjectName = searchTree(groups, "Acme App");
    assert.equal(byProjectName[0]?.projects[0]?.inactiveWorkspaces.length, 2);
  });
});

describe("Feature containment across inferRepos, workspaceIndex, host, and sidebarIndexService", () => {
  it("suppresses unseen-worktree for active/parked/archived features while excluding refs and keeping external unseen", () => {
    const environments: WorkspaceEnvironmentDescriptor[] = [
      makeDescriptor("env_src", "proj_app", "/repos/acme-app", {
        isWorktree: false,
        branchName: "main",
        workspaceDisplayKind: "other",
        managed: false,
      }),
      makeDescriptor("env_sdk_src", "proj_sdk", "/repos/acme-sdk", {
        isWorktree: false,
        branchName: "main",
        workspaceDisplayKind: "other",
        managed: false,
      }),
    ];
    const projects = new Map<string, WorkspaceProjectDescriptor>([
      ["proj_app", { projectId: "proj_app", sourcePath: "/repos/acme-app", sourceHostId: HOST }],
      ["proj_sdk", { projectId: "proj_sdk", sourcePath: "/repos/acme-sdk", sourceHostId: HOST }],
    ]);
    const facts = [
      {
        hostId: HOST,
        path: "/repos/acme-app",
        realPath: "/repos/acme-app",
        isDirectory: true,
        isMainWorktree: true,
        isLinkedWorktree: false,
        isNestedRepository: false,
        repositoryRoot: "/repos/acme-app",
        commonDir: "/repos/acme-app/.git",
        remoteUrl: "git@github.com:example/acme-app.git",
        worktrees: [
          { path: "/repos/acme-app", branch: "main", head: null, detached: false, prunable: false },
          {
            path: "/private/Users/example/.bb/features/feat-active/acme-app",
            branch: "feat/active",
            head: null,
            detached: false,
            prunable: false,
          },
          {
            path: "/Users/example/.bb/features/feat-parked/acme-app",
            branch: "feat/parked",
            head: null,
            detached: false,
            prunable: false,
          },
          {
            path: "/Users/example/.bb/features/feat-archived/acme-app",
            branch: "feat/archived",
            head: null,
            detached: false,
            prunable: false,
          },
          {
            path: "/repos/acme-app-manual-unseen",
            branch: "feat/manual",
            head: null,
            detached: false,
            prunable: false,
          },
        ],
      },
      {
        hostId: HOST,
        path: "/repos/acme-sdk",
        realPath: "/repos/acme-sdk",
        isDirectory: true,
        isMainWorktree: true,
        isLinkedWorktree: false,
        isNestedRepository: false,
        repositoryRoot: "/repos/acme-sdk",
        commonDir: "/repos/acme-sdk/.git",
        remoteUrl: "git@github.com:example/acme-sdk.git",
        worktrees: [
          { path: "/repos/acme-sdk", branch: "main", head: null, detached: false, prunable: false },
          {
            path: "/repos/acme-sdk-unseen",
            branch: "feat/sdk-unseen",
            head: null,
            detached: false,
            prunable: false,
          },
        ],
      },
    ];

    const inferred = inferRepos({
      environments,
      projects,
      facts,
      featureOwnedPaths: [
        { hostId: HOST, path: "/private/Users/example/.bb/features/feat-active" },
        { hostId: HOST, path: "/Users/example/.bb/features/feat-parked" },
        { hostId: HOST, path: "/Users/example/.bb/features/feat-archived" },
      ],
    });
    const appRepo = inferred.repos.find((repo) => repo.name === "acme-app");
    const sdkRepo = inferred.repos.find((repo) => repo.name === "acme-sdk");
    assert.ok(appRepo && sdkRepo);
    assert.deepEqual(
      appRepo.unseenWorktrees.map((wt) => wt.path),
      ["/repos/acme-app-manual-unseen"],
    );
    assert.deepEqual(
      sdkRepo.unseenWorktrees.map((wt) => wt.path),
      ["/repos/acme-sdk-unseen"],
    );
    assert.equal(
      inferred.diagnostics.some(
        (diag) =>
          diag.code === "unseen-worktree" &&
          diag.subjects.some((subject) => subject.includes("/.bb/features/")),
      ),
      false,
    );
  });

  it("synthesizes non-ref feature members in workspace-index without ref symlinks", () => {
    const features: Feature[] = [
      {
        id: "feat_1",
        name: "Checkout Flow",
        slug: "checkout-flow",
        state: "active",
        position: 0,
        rootPath: "/f/checkout-flow",
        hostId: HOST,
      },
    ];
    const members: FeatureMember[] = [
      {
        featureId: "feat_1",
        directory: "acme-app",
        path: "/f/checkout-flow/acme-app",
        repository: "acme-app",
        repositoryPath: "/repos/acme-app",
        branch: "feat/checkout-flow",
        hostId: HOST,
        role: "worktree",
      },
      {
        featureId: "feat_1",
        directory: "acme-sdk",
        path: "/f/checkout-flow/acme-sdk",
        repository: "acme-sdk",
        repositoryPath: "/repos/acme-sdk",
        branch: null,
        hostId: HOST,
        role: "ref",
      },
    ];
    const index = buildWorkspaceIndex({
      environments: {},
      projects: {
        proj_app: { projectId: "proj_app", sourcePath: "/repos/acme-app", sourceHostId: HOST },
      },
      features,
      featureMembers: members,
    });
    const featureRows = index.byFeature.get("feat_1") ?? [];
    assert.deepEqual(
      featureRows.map((row) => row.path),
      ["/f/checkout-flow/acme-app"],
    );
    assert.equal(featureRows[0]?.unseen, false);
    assert.equal(featureRows[0]?.canonicalEnvironmentId, null);
    assert.equal(featureRows[0]?.launchable, false);
    assert.equal(featureRows[0]?.projectId, "proj_app");
  });

  it("resolves relative gitdir worktree paths against entryDir and realpath on disk", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "harbor-facts-wt-"));
    try {
      const repoDir = path.join(root, "real", "acme-app");
      const wtDir = path.join(root, "real", "wt-1");
      const entryDir = path.join(repoDir, ".git", "worktrees", "wt-1");
      const symlinkLink = path.join(root, "alias-wt-1");
      await mkdir(entryDir, { recursive: true });
      await mkdir(wtDir, { recursive: true });
      await symlink(wtDir, symlinkLink);

      const relGitFile = `${path.relative(entryDir, path.join(symlinkLink, ".git"))}\n`;
      await writeFile(path.join(repoDir, ".git", "HEAD"), "ref: refs/heads/main\n");
      await writeFile(path.join(entryDir, "gitdir"), relGitFile);
      await writeFile(path.join(entryDir, "commondir"), "../..\n");
      await writeFile(path.join(entryDir, "HEAD"), "ref: refs/heads/feat/rel\n");

      const facts = await resolveWorkspaceFacts([repoDir]);
      const resolvedWt = await realpath(wtDir);
      const wt = facts[0]?.worktrees.find((item) => item.branch === "feat/rel");
      assert.ok(wt);
      assert.equal(wt.path, resolvedWt);
      assert.equal(wt.prunable, false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("filters destroyed envs, chunks >500 probes, sets dangling, and feeds features into sidebarIndexService", async () => {
    const db = new Database(":memory:");
    db.exec(SIDEBAR_INDEX_MIGRATION);
    db.exec(FEATURE_MIGRATION);
    for (const ddl of FEATURE_PARK_MIGRATIONS) db.exec(ddl);
    db.exec(FEATURE_ROOT_CHOICE_MIGRATION);
    db.exec(FEATURE_CONTAINER_MIGRATION);
    db.exec(FEATURE_LABEL_MIGRATION);
    db.exec(FEATURE_BRANCH_MIGRATION);

    const featureStore = createFeatureStore(db);
    featureStore.recordContainer("/f");
    featureStore.setFeaturesRoot(HOST, "/f", "flat");
    featureStore.create({
      id: "feat_p",
      name: "Parked Feature",
      slug: "parked-feature",
      rootPath: "/link/f/parked-feature",
      hostId: HOST,
    });
    featureStore.park("feat_p", { reason: "waiting-qa" });

    const probeChunks: number[] = [];
    const envList = [
      {
        id: "env_main",
        projectId: "proj_main",
        hostId: HOST,
        path: "/repos/acme-app",
        isGitRepo: true,
        isWorktree: false,
        branchName: "main",
        name: null,
        environmentProviderId: null,
        workspaceProvisionType: "unmanaged",
        managed: false,
        createdAt: 10,
        updatedAt: 20,
        environmentProviderInstanceKey: null,
      },
      {
        id: "env_sdk_main",
        projectId: "proj_sdk",
        hostId: HOST,
        path: "/repos/acme-sdk",
        isGitRepo: true,
        isWorktree: false,
        branchName: "main",
        name: null,
        environmentProviderId: null,
        workspaceProvisionType: "unmanaged",
        managed: false,
        createdAt: 10,
        updatedAt: 20,
        environmentProviderInstanceKey: null,
      },
      {
        id: "env_destroyed",
        projectId: "proj_main",
        hostId: HOST,
        path: "/repos/destroyed",
        isGitRepo: true,
        isWorktree: true,
        branchName: "gone",
        name: null,
        environmentProviderId: "git-worktree",
        workspaceProvisionType: "managed-worktree",
        managed: true,
        createdAt: 10,
        updatedAt: 20,
        environmentProviderInstanceKey: "k_gone",
        status: "destroyed",
      },
      {
        id: "env_phase_destroyed",
        projectId: "proj_main",
        hostId: HOST,
        path: "/repos/phase-gone",
        isGitRepo: true,
        isWorktree: true,
        branchName: "gone2",
        name: null,
        environmentProviderId: "git-worktree",
        workspaceProvisionType: "managed-worktree",
        managed: true,
        createdAt: 10,
        updatedAt: 20,
        environmentProviderInstanceKey: "k_gone2",
        lifecycle: { phase: "destroyed" },
      },
      {
        id: "env_host_removed",
        projectId: "proj_main",
        hostId: "host_gone",
        path: "/repos/host-gone",
        isGitRepo: true,
        isWorktree: true,
        branchName: "gone3",
        name: null,
        environmentProviderId: "git-worktree",
        workspaceProvisionType: "managed-worktree",
        managed: true,
        createdAt: 10,
        updatedAt: 20,
        environmentProviderInstanceKey: "k_gone3",
        hostLifecycle: "removed",
      },
      {
        id: "env_dangling",
        projectId: "proj_main",
        hostId: HOST,
        path: "/repos/missing-on-disk",
        isGitRepo: true,
        isWorktree: true,
        branchName: "feat/missing",
        name: null,
        environmentProviderId: "git-worktree",
        workspaceProvisionType: "managed-worktree",
        managed: true,
        createdAt: NOW,
        updatedAt: NOW,
        environmentProviderInstanceKey: "k_missing",
      },
      {
        id: "env_offline_host",
        projectId: "proj_main",
        hostId: "host_offline",
        path: "/repos/remote-wt",
        isGitRepo: true,
        isWorktree: true,
        branchName: "feat/remote",
        name: null,
        environmentProviderId: "git-worktree",
        workspaceProvisionType: "managed-worktree",
        managed: true,
        createdAt: NOW,
        updatedAt: NOW,
        environmentProviderInstanceKey: null,
      },
      ...Array.from({ length: 495 }, (_, index) => ({
        id: `env_extra_${index}`,
        projectId: "proj_main",
        hostId: HOST,
        path: `/repos/wt_${index}`,
        isGitRepo: true,
        isWorktree: true,
        branchName: `feat/${index}`,
        name: null,
        environmentProviderId: "git-worktree",
        workspaceProvisionType: "managed-worktree",
        managed: true,
        createdAt: 100,
        updatedAt: 200,
        environmentProviderInstanceKey: null,
      })),
    ];

    const members: FeatureMember[] = [
      {
        featureId: "feat_p",
        directory: "acme-app",
        path: "/link/f/parked-feature/acme-app",
        repository: "acme-app",
        repositoryPath: "/repos/acme-app",
        branch: "feat/parked-feature",
        hostId: HOST,
        role: "worktree",
      },
      {
        featureId: "feat_p",
        directory: "acme-sdk",
        path: "/link/f/parked-feature/acme-sdk",
        repository: "acme-sdk",
        repositoryPath: "/repos/acme-sdk",
        branch: null,
        hostId: HOST,
        role: "ref",
      },
    ];

    const probe: WorkspaceProbe = async (hostId, paths) => {
      probeChunks.push(paths.length);
      if (hostId === "host_offline") throw new Error("host unreachable");
      return paths.map((targetPath) => {
        if (targetPath === "/repos/acme-app") {
          return {
            hostId,
            path: targetPath,
            realPath: targetPath,
            isDirectory: true,
            isMainWorktree: true,
            isLinkedWorktree: false,
            isNestedRepository: false,
            repositoryRoot: targetPath,
            commonDir: "/repos/acme-app/.git",
            remoteUrl: "git@github.com:example/acme-app.git",
            worktrees: [
              { path: "/repos/acme-app", branch: "main", head: null, detached: false, prunable: false },
              {
                path: "/real/f/parked-feature/acme-app",
                branch: "feat/parked-feature",
                head: null,
                detached: false,
                prunable: false,
              },
            ],
          };
        }
        if (targetPath === "/repos/acme-sdk") {
          return {
            hostId,
            path: targetPath,
            realPath: targetPath,
            isDirectory: true,
            isMainWorktree: true,
            isLinkedWorktree: false,
            isNestedRepository: false,
            repositoryRoot: targetPath,
            commonDir: "/repos/acme-sdk/.git",
            remoteUrl: "git@github.com:example/acme-sdk.git",
            worktrees: [
              { path: "/repos/acme-sdk", branch: "main", head: null, detached: false, prunable: false },
              { path: "/repos/sdk-unseen", branch: "feat/unseen", head: null, detached: false, prunable: false },
            ],
          };
        }
        if (targetPath.startsWith("/link/f/")) {
          const realPath = targetPath.replace("/link/", "/real/");
          return {
            hostId,
            path: targetPath,
            realPath,
            isDirectory: true,
            isMainWorktree: false,
            isLinkedWorktree: targetPath.endsWith("/acme-app"),
            isNestedRepository: false,
            repositoryRoot: targetPath.endsWith("/acme-app") ? targetPath : null,
            commonDir: targetPath.endsWith("/acme-app") ? "/repos/acme-app/.git" : null,
            remoteUrl: targetPath.endsWith("/acme-app") ? "git@github.com:example/acme-app.git" : null,
            worktrees: [],
          };
        }
        if (targetPath === "/repos/missing-on-disk") {
          return {
            hostId,
            path: targetPath,
            realPath: null,
            isDirectory: false,
            isMainWorktree: false,
            isLinkedWorktree: false,
            isNestedRepository: false,
            repositoryRoot: null,
            commonDir: null,
            remoteUrl: null,
            worktrees: [],
          };
        }
        return {
          hostId,
          path: targetPath,
          realPath: targetPath,
          isDirectory: true,
          isMainWorktree: false,
          isLinkedWorktree: false,
          isNestedRepository: false,
          repositoryRoot: null,
          commonDir: null,
          remoteUrl: null,
          worktrees: [],
        };
      });
    };

    try {
      const repoFacts = createRepoFactsCache({ probe });
      const indexCache = createSidebarIndexCache(db);
      const service = createSidebarIndexService({
        bb: {
          sdk: {
            environments: { list: async () => envList },
            projects: {
              list: async () => [
                {
                  id: "proj_main",
                  name: "Acme App",
                  sources: [{ path: "/repos/acme-app", hostId: HOST }],
                },
                {
                  id: "proj_sdk",
                  name: "Acme SDK",
                  sources: [{ path: "/repos/acme-sdk", hostId: HOST }],
                },
              ],
            },
          },
          log: { warn() {} },
        } as unknown as BbPluginApi,
        groups: { list: () => [], assignments: () => ({}) } as never,
        repoFacts,
        index: indexCache,
        featureStore,
        featureMembers: () => members,
      });

      const refreshed = await service.refresh();
      assert.ok(refreshed);
      assert.equal(refreshed.environments.env_destroyed, undefined);
      assert.equal(refreshed.environments.env_phase_destroyed, undefined);
      assert.equal(refreshed.environments.env_host_removed, undefined);
      assert.equal(refreshed.environments.env_dangling?.dangling, true);
      assert.equal(refreshed.environments.env_dangling?.managed, true);
      assert.equal(refreshed.environments.env_dangling?.createdAt, NOW);
      assert.equal(refreshed.environments.env_dangling?.providerInstanceKey, "k_missing");
      assert.equal(refreshed.environments.env_offline_host?.dangling, false);
      assert.ok(probeChunks.every((size) => size <= 500));

      // `ref` symlink paths are never added to `featureOwnedPaths` or probed as feature worktrees.
      assert.equal(refreshed.repoFacts.unseenWorkspaces.proj_main, undefined);
      assert.deepEqual(
        refreshed.repoFacts.unseenWorkspaces.proj_sdk?.map((item) => item.path),
        ["/repos/sdk-unseen"],
      );

      // Subsequent descriptor read sees cached `dangling` state.
      const descriptors = await service.readWorkspaceDescriptors();
      assert.equal(descriptors.environments.env_dangling?.dangling, true);
    } finally {
      db.close();
    }
  });
});

describe("batchSurveyWorktrees, batchRemoveWorktrees, and P1 backend fixes", () => {
  it("classifies clean, dirty, in-use, and failed surveys safely", async () => {
    assert.equal(dirtyBatchWorktreeReason(makeSurvey()), null);
    assert.match(dirtyBatchWorktreeReason(makeSurvey({ changedFiles: 2 })) ?? "", /2 changed files/);
    assert.match(dirtyBatchWorktreeReason(makeSurvey({ statusUnavailable: true })) ?? "", /git status/);
    assert.match(dirtyBatchWorktreeReason(makeSurvey({ liveThreads: 1 })) ?? "", /1 live thread/);

    const cleanItem = classifyBatchSurvey("env_clean", makeSurvey());
    assert.equal(cleanItem.ok, true);
    assert.equal(cleanItem.dirty, false);
    assert.equal(failedBatchSurvey("env_err", "boom").dirty, true);

    const deleted: string[] = [];
    const removedDirs: string[] = [];
    const service = createWorktreeRemovalService({
      bb: {
        sdk: {
          environments: {
            archiveThreads: async () => {},
            delete: async ({ environmentId }: { environmentId: string }) => {
              deleted.push(environmentId);
            },
          },
        },
      } as unknown as BbPluginApi,
      surveyWorktree: async (environmentId) => {
        if (environmentId === "env_timeout") {
          return new Promise(() => {});
        }
        if (environmentId === "env_dirty") {
          return makeSurvey({ path: "/repos/dirty", changedFiles: 1 });
        }
        if (environmentId === "env_dangling") {
          return makeSurvey({ path: "/repos/dangling", directoryExists: false });
        }
        if (environmentId === "env_dir_fail") {
          return makeSurvey({ path: "/repos/dir-fail" });
        }
        return makeSurvey({ path: `/repos/${environmentId}` });
      },
      removeWorktreeDirectory: async ({ path: targetPath }) => {
        if (targetPath === "/repos/dir-fail") {
          return { directory: "failed", message: "permission denied" };
        }
        removedDirs.push(targetPath);
        return { directory: "removed", message: null };
      },
      invalidateFacts: () => {},
      surveyTimeoutMs: 25,
    });

    const surveyed = await service.batchSurvey(["env_clean", "env_dirty", "env_timeout", "env_clean"]);
    assert.equal(surveyed.items.length, 3);
    assert.equal(surveyed.items[0]?.dirty, false);
    assert.equal(surveyed.items[1]?.dirty, true);
    assert.equal(surveyed.items[2]?.ok, false);
    assert.equal(surveyed.items[2]?.dirty, true);

    const dry = await service.batchRemove({
      environmentIds: ["env_clean", "env_dirty", "env_dangling", "env_dir_fail"],
      deleteDirectory: true,
      force: false,
    });
    assert.equal(dry.removedCount, 2);
    assert.equal(dry.skippedCount, 1);
    assert.equal(dry.failedCount, 1);
    assert.equal(dry.items[1]?.status, "skipped");
    assert.equal(dry.items[2]?.status, "removed");
    assert.equal(dry.items[2]?.outcome?.directory, "kept");
    assert.equal(dry.items[3]?.status, "failed");
    assert.deepEqual(deleted, ["env_clean", "env_dangling", "env_dir_fail"]);
    assert.deepEqual(removedDirs, ["/repos/env_clean"]);

    const forced = await service.batchRemove({
      environmentIds: ["env_dirty"],
      deleteDirectory: true,
      force: true,
    });
    assert.equal(forced.removedCount, 1);
    assert.ok(removedDirs.includes("/repos/dirty"));
  });

  it("includes trimmed alias on surveyWorktree when set and omits when blank", async () => {
    const mkService = (name: string | null) =>
      createWorkspaceService({
        bb: {
          sdk: {
            environments: {
              get: async () => ({
                id: "env_1",
                projectId: "proj_1",
                hostId: HOST,
                path: "/repos/acme-app-wt",
                branchName: "feat/x",
                name,
                managed: true,
                isWorktree: true,
                mergeBaseBranch: null,
                baseBranch: null,
                defaultBranch: null,
              }),
            },
            threads: { list: async () => [] },
            terminals: { list: async () => ({ sessions: [] }) },
            projects: {
              get: async () => ({
                id: "proj_1",
                name: "Acme",
                sources: [{ path: "/repos/acme-app", isDefault: true }],
              }),
            },
            hosts: {
              pathsExist: async () => ({ existence: { "/repos/acme-app-wt": true } }),
            },
            plugins: {
              callRpc: async () => ({ outcome: "unavailable" }),
            },
          },
        } as unknown as BbPluginApi,
        removeViaGit: async () => ({ status: "removed" }),
      });

    const named = await mkService("  UI Cleanup  ").surveyWorktree("env_1");
    assert.equal(named.alias, "UI Cleanup");
    const unnamed = await mkService("   ").surveyWorktree("env_1");
    assert.equal("alias" in unnamed, false);
    assert.equal(worktreePlanDigest(named), worktreePlanDigest(unnamed));
  });

  it("expires cached project icon misses after PROJECT_ICON_MISS_TTL_MS in detectProjectIcon", async () => {
    const db = new Database(":memory:");
    db.exec(PROJECT_ICON_MIGRATION);
    const projectIcons = createProjectIconStore(db);
    let hostCalls = 0;

    try {
      const handlers = projectIconHandlers({
        bb: { realtime: { publish() {} } } as unknown as BbPluginApi,
        projectIcons,
        worktreeHost: {
          async call() {
            hostCalls += 1;
            return {
              status: "found",
              src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
              label: "favicon.png",
              source: "file",
            };
          },
        },
        appearance: {
          async get() {
            return { autoProjectIcons: true };
          },
        },
        projectSource: async () => ({ path: "/repos/acme-app", hostId: HOST }),
      });

      projectIcons.set(
        {
          projectId: "proj_fresh",
          icon: null,
          sourcePath: "/repos/acme-app",
          sourceHostId: HOST,
        },
        Date.now() - 1_000,
      );
      const fresh = await handlers.detectProjectIcon({ projectId: "proj_fresh" });
      assert.equal(fresh.icon, null);
      assert.equal(hostCalls, 0);

      projectIcons.set(
        {
          projectId: "proj_expired",
          icon: null,
          sourcePath: "/repos/acme-app",
          sourceHostId: HOST,
        },
        Date.now() - PROJECT_ICON_MISS_TTL_MS - 1_000,
      );
      const expired = await handlers.detectProjectIcon({ projectId: "proj_expired" });
      assert.equal(hostCalls, 1);
      assert.equal(expired.icon?.label, "favicon.png");
    } finally {
      db.close();
    }
  });

  it("does not clear a settled thread record when unsnooze is called", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE thread_lifecycle (
        thread_id TEXT PRIMARY KEY,
        settled_at INTEGER,
        snoozed_until INTEGER,
        snoozed_at INTEGER,
        archived_thread_ids TEXT
      )
    `);
    try {
      const lifecycle = createLifecycleService({
        bb: {
          sdk: {
            threads: {
              archive: async () => ({ archivedThreadIds: ["thr_settled"] }),
              unarchive: async () => {},
            },
          },
          realtime: { publish() {} },
        } as unknown as BbPluginApi,
        db,
      });

      await lifecycle.settleThread("thr_settled");
      await lifecycle.snoozeThread("thr_settled", null);
      const settled = lifecycle.readOne("thr_settled");
      assert.ok(settled?.settledAt !== null && settled?.settledAt !== undefined);

      await lifecycle.snoozeThread("thr_snoozed", NOW + 60_000);
      assert.ok(lifecycle.readOne("thr_snoozed")?.snoozedUntil !== null);
      await lifecycle.snoozeThread("thr_snoozed", null);
      assert.equal(lifecycle.readOne("thr_snoozed"), undefined);
    } finally {
      db.close();
    }
  });
});
