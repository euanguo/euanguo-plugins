import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

import { buildInboxView } from "../lib/inbox-view.ts";
import type { ThreadFamily } from "../lib/inbox.ts";
import { rollupThreads } from "../lib/rollup.ts";
import type { ProjectNode, WorkspaceNode } from "../lib/tree.ts";
import type { WorkspaceEnvironmentDescriptor } from "../lib/workspace.ts";
import { NO_WORKSPACE_REF } from "../lib/workspace.ts";
import {
  NO_WORKSPACE_KEY,
  type Workspace,
} from "../lib/workspace-index.ts";
import {
  projectWorkspaceRows,
  workspaceGlyphKind,
  workspaceOpenTarget,
  workspaceTypeIcon,
} from "../lib/workspace-view.ts";
import { testWorkspaceIndex } from "./_workspace-index.ts";

function thread(
  id: string,
  createdAt: number,
  overrides: Partial<PluginSidebarThread> = {},
): PluginSidebarThread {
  return {
    id,
    title: id,
    titleFallback: null,
    createdAt,
    updatedAt: createdAt,
    indicator: "none",
    activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0 },
    isUnread: false,
    hasPendingInteraction: false,
    latestAttentionAt: createdAt,
    isPinned: false,
    parentThreadId: null,
    children: [],
    environment: null,
    host: null,
    ...overrides,
  } as unknown as PluginSidebarThread;
}

const family = (root: PluginSidebarThread): ThreadFamily => ({ root, children: [] });

/** A conversation running in one environment, which is what gives it a workspace. */
const inEnvironment = (environmentId: string) =>
  ({ id: environmentId, name: null, branchName: null, providerId: null, workspaceDisplayKind: null }) as PluginSidebarThread["environment"];

function environment(id: string, path: string, projectId = "proj_a"): WorkspaceEnvironmentDescriptor {
  return {
    id,
    projectId,
    hostId: "host_a",
    path,
    isGitRepo: true,
    isWorktree: true,
    branchName: null,
    name: null,
    providerId: null,
    workspaceDisplayKind: "unmanaged-worktree",
  };
}

const index = testWorkspaceIndex({
  environments: {
    env_a: environment("env_a", "/code/a"),
    env_b: environment("env_b", "/code/a-features/b"),
  },
});
const workspaceA = index.byKey.get("ws:host_a:/code/a") as Workspace;
const workspaceB = index.byKey.get("ws:host_a:/code/a-features/b") as Workspace;

const workspaceNode = (
  workspace: Workspace,
  families: ThreadFamily[],
  now = 1_000,
): WorkspaceNode => ({
  ref: workspace,
  families,
  rollup: rollupThreads(families.flatMap((item) => [item.root, ...item.children]), now),
});

describe("where a click on a workspace row goes", () => {
  const families = [
    family(thread("old", 10)),
    family(thread("new", 30)),
    family(thread("middle", 20)),
  ];

  it("opens the conversation that failed, whatever was last open", () => {
    const failed = family(thread("broken", 5, { indicator: "unread-error" }));
    const target = workspaceOpenTarget({
      rollup: rollupThreads([failed.root, ...families.map((item) => item.root)], 1_000),
      families: [failed, ...families],
      lastActiveThreadId: "new",
    });
    assert.deepEqual(target, { kind: "thread", threadId: "broken" });
  });

  it("opens the conversation waiting for the user, ahead of the last one", () => {
    const waiting = family(
      thread("asking", 1, { indicator: "waiting-for-input" }),
    );
    const target = workspaceOpenTarget({
      rollup: rollupThreads([waiting.root], 1_000),
      families: [waiting, ...families],
      lastActiveThreadId: "new",
    });
    assert.equal(target.kind === "thread" && target.threadId, "asking");
  });

  it("opens the conversation last looked at, while it is still here", () => {
    const target = workspaceOpenTarget({
      rollup: rollupThreads(families.map((item) => item.root), 1_000),
      families,
      lastActiveThreadId: "middle",
    });
    assert.deepEqual(target, { kind: "thread", threadId: "middle" });
  });

  it("opens the oldest conversation when nothing was remembered", () => {
    const target = workspaceOpenTarget({
      rollup: rollupThreads(families.map((item) => item.root), 1_000),
      families,
      lastActiveThreadId: null,
    });
    assert.deepEqual(target, { kind: "thread", threadId: "old" });
  });

  it("ignores a remembered conversation that has left the workspace", () => {
    const target = workspaceOpenTarget({
      rollup: rollupThreads(families.map((item) => item.root), 1_000),
      families,
      lastActiveThreadId: "gone",
    });
    assert.deepEqual(target, { kind: "thread", threadId: "old" });
  });

  it("asks for a new conversation in a workspace with nothing in it", () => {
    assert.deepEqual(
      workspaceOpenTarget({
        rollup: rollupThreads([], 1_000),
        families: [],
        lastActiveThreadId: null,
      }),
      { kind: "new-chat" },
    );
  });
});

describe("a workspace row's leading glyph", () => {
  it("puts the threads' state first, then the pull request, then the type", () => {
    assert.equal(workspaceGlyphKind({ rollupKind: "failed", hasPullRequest: true }), "status");
    assert.equal(workspaceGlyphKind({ rollupKind: "needs-you", hasPullRequest: false }), "status");
    assert.equal(workspaceGlyphKind({ rollupKind: "working", hasPullRequest: false }), "status");
    assert.equal(workspaceGlyphKind({ rollupKind: "unread", hasPullRequest: false }), "status");
    assert.equal(workspaceGlyphKind({ rollupKind: "inactive", hasPullRequest: true }), "pull-request");
    assert.equal(workspaceGlyphKind({ rollupKind: "stale", hasPullRequest: false }), "type");
  });

  it("tells a checkout, a worktree, a feature folder and a person apart", () => {
    assert.equal(workspaceTypeIcon({ kind: "project-checkout", featureId: null, parentKey: null }), "Folder");
    assert.equal(workspaceTypeIcon({ kind: "git-worktree", featureId: null, parentKey: null }), "GitBranch");
    assert.equal(
      workspaceTypeIcon({ kind: "git-worktree", featureId: "f1", parentKey: null }),
      "FolderGit",
    );
    assert.equal(workspaceTypeIcon({ kind: "personal", featureId: null, parentKey: null }), "MessageSquare");
  });
});

function projectNode(workspaces: WorkspaceNode[]): ProjectNode {
  return {
    project: {
      id: "proj_a",
      name: "a",
      isPersonal: false,
      href: "/projects/proj_a",
      settingsHref: "/projects/proj_a/settings",
    },
    families: workspaces.flatMap((workspace) => workspace.families),
    workspaces,
    showWorkspaces: true,
    rollup: rollupThreads([], 1_000),
    repoKey: null,
    mergedProjectIds: ["proj_a"],
    foreignClaimProjectIds: [],
    inFeatures: null,
  };
}

describe("what a project draws under its workspaces view", () => {
  it("keeps every workspace, empty ones included, and the conversations with none", () => {
    const rows = projectWorkspaceRows(
      projectNode([
        workspaceNode(workspaceA, [family(thread("a1", 10))]),
        workspaceNode(workspaceB, []),
        {
          ref: NO_WORKSPACE_REF,
          families: [family(thread("loose-old", 5)), family(thread("loose-new", 50))],
          rollup: rollupThreads([], 1_000),
        },
      ]),
      1_000,
    );
    assert.deepEqual(rows.workspaces.map((workspace) => workspace.ref.key), [workspaceA.key, workspaceB.key]);
    assert.deepEqual(
      rows.loose.map((item) => item.root.id),
      ["loose-new", "loose-old"],
      "the personal bucket reads newest activity first",
    );
  });

  it("draws no conversation row for a workspace that holds one", () => {
    const rows = projectWorkspaceRows(
      projectNode([workspaceNode(workspaceA, [family(thread("a1", 10))])]),
      1_000,
    );
    assert.equal(rows.loose.length, 0);
    assert.equal(rows.workspaces.length, 1);
  });
});

/** The personal bucket's key is shared with the tree; a rename there is a silent split. */
describe("the personal bucket", () => {
  it("is the key `projectWorkspaceRows` looks for", () => {
    assert.equal(NO_WORKSPACE_REF.key, NO_WORKSPACE_KEY);
  });
});

/**
 * A pin is a conversation, not a workspace. The workspaces mode draws no
 * conversation rows, so it draws no Pinned section either: the workspace the
 * pin runs in stays under its project, where it can always be found.
 */
describe("pinned workspaces in the whole view", () => {
  const projectOf = (id: string) => ({
    id,
    name: id,
    isPersonal: false,
    href: `/projects/${id}`,
    settingsHref: `/projects/${id}/settings`,
  });
  const pinnedThread = (id: string, environmentId: string) =>
    thread(id, 1, {
      projectId: "proj_a",
      environment: inEnvironment(environmentId),
      isPinned: true,
      pinnedAt: 1,
      pinSortKey: "a",
    });
  const view = (sidebarMode: "threads" | "workspaces") =>
    buildInboxView({
      threads: [
        pinnedThread("pinned", "env_a"),
        thread("other", 2, { projectId: "proj_a", environment: inEnvironment("env_a") }),
      ],
      projects: [projectOf("proj_a")],
      parkedThreadIds: new Set(),
      shelfFor: () => "active",
      wakeAtFor: () => null,
      now: 1_000,
      filterPreset: "all",
      searchQuery: "",
      selectedRootIds: new Set(),
      selectionMode: false,
      sidebarMode,
      groupScope: { kind: "all" },
      organization: {
        assignment: {},
        sections: [],
      },
      organizationIds: new Set(),
      groups: [],
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
          env_a: { ...environment("env_a", "/code/a"), isWorktree: false, workspaceDisplayKind: null },
        },
        projects: {},
      },
      repoFacts: { repoKeyByProject: {} },
      workspaceOwnership: undefined,
      unseenWorkspaces: undefined,
      mergeRepos: false,
      features: [],
      featureAdoptions: {},
    });

  it("keeps the workspace in its project, pinned conversation and all", () => {
    const result = view("workspaces");
    assert.deepEqual(result.pinnedFamilies, []);
    assert.deepEqual(
      result.treeNodes.flatMap((node) =>
        node.projects.flatMap((project) => project.workspaces.map((workspace) => workspace.families.length)),
      ),
      [2],
      "both conversations stay in the one workspace row",
    );
  });

  it("lifts the pinned conversation into Pinned in the thread mode", () => {
    const result = view("threads");
    assert.deepEqual(
      result.pinnedFamilies.map((entry) => entry.family.root.id),
      ["pinned"],
    );
    assert.deepEqual(
      result.treeNodes.flatMap((node) =>
        node.projects.flatMap((project) => project.workspaces.map((workspace) => workspace.families.length)),
      ),
      [1],
      "the tree keeps the conversation that is not pinned",
    );
  });
});
