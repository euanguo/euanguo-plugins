import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk";

import type { Feature } from "../lib/domain/features.ts";
import type {
  WorkspaceEnvironmentDescriptor,
  WorkspaceProjectDescriptor,
} from "../lib/domain/workspace.ts";
import type { WorkspaceOwnership } from "../lib/domain/workspace-ownership.ts";
import type { RepoIdentity } from "../lib/domain/repo-identity.ts";
import {
  NO_WORKSPACE_KEY,
  createWorkspace,
} from "../lib/domain/workspace-index.ts";
import { physicalWorkspaceKey } from "../lib/domain/workspace-key.ts";
import { testWorkspaceIndex } from "./_workspace-index.ts";

const HOST = "host_1";

function environment(
  id: string,
  path: string | null,
  projectId = "p1",
  overrides: Partial<WorkspaceEnvironmentDescriptor> = {},
): WorkspaceEnvironmentDescriptor {
  return {
    id,
    projectId,
    hostId: HOST,
    path,
    isGitRepo: true,
    isWorktree: path?.includes("/worktrees/") ?? false,
    branchName: null,
    name: null,
    providerId: "git-worktree",
    workspaceDisplayKind: "other",
    ...overrides,
  };
}

function project(
  id: string,
  sourcePath = "/work/repo",
): WorkspaceProjectDescriptor {
  return { projectId: id, sourcePath, sourceHostId: HOST };
}

function ownership(
  environmentId: string,
  claimedProjectId: string,
  ownerProjectId: string,
  conflict = claimedProjectId !== ownerProjectId,
): WorkspaceOwnership {
  return {
    environmentId,
    claimedProjectId,
    ownerProjectId,
    workspaceKey: physicalWorkspaceKey(HOST, "/work/tree"),
    repoKey: "repo:local:/work/repo",
    kind: "git-worktree",
    confidence: "exact-source",
    conflict,
  };
}

function feature(id: string, rootPath: string): Feature {
  return {
    id,
    name: `Feature ${id}`,
    slug: id,
    state: "active",
    position: 0,
    rootPath,
    hostId: HOST,
  };
}

function thread(id: string, environmentId: string | null): PluginSidebarThread {
  return {
    id,
    projectId: "p1",
    title: id,
    titleFallback: id,
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
    createdAt: 1,
    updatedAt: 1,
    lastReadAt: null,
    latestAttentionAt: 1,
    environment:
      environmentId === null
        ? null
        : {
            id: environmentId,
            name: null,
            branchName: null,
            providerId: null,
            workspaceDisplayKind: null,
          },
    host: { id: HOST, name: "Host" },
    href: `/threads/${id}`,
  } as unknown as PluginSidebarThread;
}

describe("the workspace index", () => {
  it("keys a directory by host and path, not by its project claim", () => {
    const index = testWorkspaceIndex({
      environments: {
        env_a: environment("env_a", "/work/tree"),
        env_b: environment("env_b", "/work/tree", "p2"),
      },
      projects: { p1: project("p1"), p2: project("p2") },
    });

    const workspace = index.byKey.get(physicalWorkspaceKey(HOST, "/work/tree"));
    assert.ok(workspace);
    assert.deepEqual([...workspace.environmentIds].sort(), ["env_a", "env_b"]);
    assert.deepEqual([...workspace.claimedProjectIds].sort(), ["p1", "p2"]);
    assert.equal(workspace.conflict, true);
    assert.equal(workspace.projectId, "p1");
  });

  it("keeps the same key when ownership flips", () => {
    const environments = { env_a: environment("env_a", "/work/tree") };
    const projects = { p1: project("p1"), p2: project("p2") };
    const asP1 = testWorkspaceIndex({
      environments,
      projects,
      ownership: { env_a: ownership("env_a", "p1", "p1") },
    });
    const asP2 = testWorkspaceIndex({
      environments,
      projects,
      ownership: { env_a: ownership("env_a", "p1", "p2") },
    });
    const key = physicalWorkspaceKey(HOST, "/work/tree");
    assert.ok(asP1.byKey.has(key));
    assert.ok(asP2.byKey.has(key));
    assert.equal(asP1.byKey.get(key)?.projectId, "p1");
    assert.equal(asP2.byKey.get(key)?.projectId, "p2");
  });

  it("falls back to the environment id when the record has no path", () => {
    const index = testWorkspaceIndex({
      environments: { env_a: environment("env_a", null) },
      projects: { p1: project("p1") },
    });
    assert.equal(index.byEnvironmentId.get("env_a"), "environment:env_a");
    assert.ok(index.byKey.has("environment:env_a"));
  });

  it("draws a repository worktree that has no bb record", () => {
    const index = testWorkspaceIndex({
      projects: { p1: project("p1") },
      unseenWorkspaces: {
        p1: [
          {
            projectId: "p1",
            repoKey: "repo:local:/work/repo",
            hostId: HOST,
            path: "/work/unseen",
            branch: "feat/unseen",
            detached: false,
          },
        ],
      },
    });
    const workspace = index.byKey.get(physicalWorkspaceKey(HOST, "/work/unseen"));
    assert.ok(workspace);
    assert.equal(workspace.unseen, true);
    assert.equal(workspace.launchable, false);
    assert.equal(workspace.environmentId, null);
    assert.equal(workspace.branch, "feat/unseen");
    assert.equal(index.byProject.get("p1")?.length, 1);
  });

  it("labels a feature root with the feature name and parents its members", () => {
    const index = testWorkspaceIndex({
      environments: {
        env_root: environment("env_root", "/f/ai"),
        env_member: environment("env_member", "/f/ai/acme-web"),
      },
      projects: { p1: project("p1") },
      features: [feature("ai", "/f/ai")],
    });
    const root = index.byKey.get(physicalWorkspaceKey(HOST, "/f/ai"));
    const member = index.byKey.get(physicalWorkspaceKey(HOST, "/f/ai/acme-web"));
    assert.ok(root && member);
    assert.equal(root.label, "Feature ai");
    assert.equal(root.featureId, "ai");
    assert.equal(member.parentKey, root.key);
    assert.deepEqual(root.childKeys, [member.key]);
    assert.deepEqual(index.childrenOf(root.key).map((row) => row.key), [member.key]);
    assert.equal(index.byFeature.get("ai")?.length, 2);
  });

  it("maps an environment key forward without project-scoped shims", () => {
    const index = testWorkspaceIndex({
      environments: { env_a: environment("env_a", "/work/tree") },
      projects: { p1: project("p1") },
    });
    const key = physicalWorkspaceKey(HOST, "/work/tree");
    assert.equal(index.migrateKey("workspace:host_1:p1:/work/tree"), "workspace:host_1:p1:/work/tree");
    assert.equal(index.migrateKey("environment:env_a"), key);
    assert.equal(index.migrateKey("ws:host_1:/already/new"), "ws:host_1:/already/new");
  });

  it("finds the workspace a thread runs in", () => {
    const index = testWorkspaceIndex({
      environments: { env_a: environment("env_a", "/work/tree") },
      projects: { p1: project("p1") },
    });
    const workspace = index.workspaceOfThread(thread("thr_a", "env_a"));
    assert.equal(workspace?.key, physicalWorkspaceKey(HOST, "/work/tree"));
    assert.equal(index.workspaceOfThread(thread("thr_b", null)), null);
    assert.equal(index.workspaceOfThread(thread("thr_c", "env_missing")), null);
    assert.equal(index.byEnvironmentId.get("env_a") !== NO_WORKSPACE_KEY, true);
  });

  it("keeps a symlinked workspace on one primary key and aliases the realPath", () => {
    const primary = physicalWorkspaceKey(HOST, "/link/tree");
    const real = physicalWorkspaceKey(HOST, "/real/tree");
    const repos: RepoIdentity[] = [
      {
        key: "repo:local:/real/tree",
        kind: "git-local",
        name: "tree",
        remoteUrl: null,
        rootPath: "/real/tree",
        hostIds: [HOST],
        projectIds: ["p1"],
        workspaces: [
          {
            key: primary,
            hostId: HOST,
            path: "/real/tree",
            rawPaths: ["/link/tree"],
            aliases: [real],
            environmentIds: ["env_a"],
            projectIds: ["p1"],
            repoKey: "repo:local:/real/tree",
            isMainWorktree: true,
            isLinkedWorktree: false,
            isNestedRepository: false,
            repositoryRoot: "/real/tree",
          },
        ],
        unseenWorktrees: [],
        diagnostics: [],
      },
    ];
    const index = testWorkspaceIndex({
      environments: { env_a: environment("env_a", "/link/tree") },
      projects: { p1: project("p1") },
      repos,
    });

    assert.equal(index.list.length, 1, "one directory is one workspace");
    assert.ok(index.byKey.has(primary));
    assert.equal(index.byKey.has(real), false, "the realPath is not a second primary");
    assert.ok(index.byKey.get(primary)?.legacyKeys.includes(real));
    assert.equal(index.migrateKey(real), primary);
  });
});

describe("createWorkspace", () => {
  it("computes the derived fields in one place", () => {
    const key = physicalWorkspaceKey(HOST, "/work/tree");
    const alias = physicalWorkspaceKey(HOST, "/var/tree");
    const workspace = createWorkspace({
      ref: {
        kind: "git-worktree",
        key,
        label: "tree",
        alias: "tree-alias",
        branch: "feat/x",
        environmentId: "env_a",
        environmentIds: ["env_a", "env_b"],
        path: "/work/tree",
        hostId: HOST,
        diagnostic: null,
        managed: false,
        createdAt: null,
        dangling: false,
        lastActiveAt: null,
      },
      key,
      kind: "git-worktree",
      projectId: "p1",
      claims: ["p1", "p2", "p1"],
      repoKey: "repo:local:/work/repo",
      unseen: false,
      records: [
        {
          environmentId: "env_a",
          claimedProjectId: "p1",
          providerId: null,
          name: null,
          branchName: null,
          isWorktree: true,
        },
      ],
      aliases: [alias],
      featureId: null,
    });

    assert.equal(workspace.key, key);
    assert.deepEqual(workspace.claimedProjectIds, ["p1", "p2"]);
    assert.equal(workspace.conflict, true);
    assert.equal(workspace.launchable, true);
    assert.equal(workspace.environmentId, "env_a");
    assert.equal(workspace.parentKey, null);
    assert.deepEqual(workspace.childKeys, []);
    assert.deepEqual(workspace.legacyKeys, [alias]);
  });

  it("does not invent a project-scoped spelling for an unseen worktree", () => {
    const key = physicalWorkspaceKey(HOST, "/work/unseen");
    const workspace = createWorkspace({
      ref: {
        kind: "git-worktree",
        key,
        label: "unseen",
        alias: null,
        branch: "feat/unseen",
        environmentId: null,
        environmentIds: [],
        path: "/work/unseen",
        hostId: HOST,
        diagnostic: null,
        managed: false,
        createdAt: null,
        dangling: false,
        lastActiveAt: null,
      },
      key,
      kind: "git-worktree",
      projectId: "p1",
      claims: ["p1"],
      legacyProjectIds: [],
      repoKey: null,
      unseen: true,
      records: [],
      featureId: null,
    });

    assert.deepEqual(workspace.legacyKeys, []);
    assert.equal(workspace.launchable, false);
    assert.equal(workspace.unseen, true);
  });
});
