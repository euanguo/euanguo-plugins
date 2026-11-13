import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk";

import type { Feature } from "../lib/features.ts";
import type {
  WorkspaceEnvironmentDescriptor,
  WorkspaceProjectDescriptor,
} from "../lib/workspace.ts";
import type { WorkspaceOwnership } from "../lib/workspace-ownership.ts";
import {
  NO_WORKSPACE_KEY,
  physicalWorkspaceKey,
} from "../lib/workspace-index.ts";
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
    isWorktree: path !== null && path.includes("/worktrees/"),
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
        env_member: environment("env_member", "/f/ai/tea-app-im"),
      },
      projects: { p1: project("p1") },
      features: [feature("ai", "/f/ai")],
    });
    const root = index.byKey.get(physicalWorkspaceKey(HOST, "/f/ai"));
    const member = index.byKey.get(physicalWorkspaceKey(HOST, "/f/ai/tea-app-im"));
    assert.ok(root && member);
    assert.equal(root.label, "Feature ai");
    assert.equal(root.featureId, "ai");
    assert.equal(member.parentKey, root.key);
    assert.deepEqual(root.childKeys, [member.key]);
    assert.deepEqual(index.childrenOf(root.key).map((row) => row.key), [member.key]);
    assert.equal(index.byFeature.get("ai")?.length, 2);
  });

  it("maps an old workspace or environment key forward", () => {
    const index = testWorkspaceIndex({
      environments: { env_a: environment("env_a", "/work/tree") },
      projects: { p1: project("p1") },
    });
    const key = physicalWorkspaceKey(HOST, "/work/tree");
    assert.equal(index.migrateKey("workspace:host_1:p1:/work/tree"), key);
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
});
