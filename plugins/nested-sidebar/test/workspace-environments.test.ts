import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk";
import { buildTree, projectWorkspaceRefs } from "../lib/tree.ts";
import type { ProjectThreadGroup, ThreadFamily } from "../lib/inbox.ts";
import type { WorktreeSortMode } from "../lib/sort-modes.ts";
import {
  workspaceRefOf,
  workspaceRefOfEnvironment,
  type WorkspaceEnvironmentDescriptor,
  type WorkspaceProjectDescriptor,
} from "../lib/workspace.ts";

const NOW = 1_700_000_000_000;

type ThreadEnvironment = NonNullable<PluginSidebarThread["environment"]>;

function environmentRef(
  id: string,
  name: string | null,
  branchName: string | null,
): ThreadEnvironment {
  return {
    id,
    name,
    branchName,
    path: null,
    isWorktree: null,
    providerId: "project-checkout",
    workspaceDisplayKind: null,
  };
}

function thread(
  id: string,
  projectId: string,
  environment: ThreadEnvironment | null,
  updatedAt: number = NOW - 1_000,
): PluginSidebarThread {
  return {
    id,
    projectId,
    title: id,
    titleFallback: null,
    displayTitle: id,
    parentThreadId: null,
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
    href: `/projects/${projectId}/threads/${id}`,
    isHidden: false,
    environment,
    host: null,
    createdAt: NOW - 1_000,
    updatedAt,
    lastReadAt: null,
    latestAttentionAt: NOW - 1_000,
  };
}

function family(
  id: string,
  projectId: string,
  environment: ThreadEnvironment | null,
  updatedAt?: number,
): ThreadFamily {
  return { root: thread(id, projectId, environment, updatedAt), children: [] };
}

function group(
  id: string,
  families: ThreadFamily[],
): ProjectThreadGroup {
  return {
    project: {
      id,
      name: id,
      isPersonal: false,
      href: `/projects/${id}`,
      settingsHref: `/projects/${id}/settings`,
    },
    families,
  };
}

function descriptor(
  id: string,
  projectId: string,
  path: string,
  extra: Partial<WorkspaceEnvironmentDescriptor> = {},
): WorkspaceEnvironmentDescriptor {
  return {
    id,
    projectId,
    hostId: "host_1",
    path,
    isGitRepo: true,
    isWorktree: true,
    branchName: null,
    name: null,
    providerId: "project-checkout",
    workspaceDisplayKind: "unmanaged-worktree",
    ...extra,
  };
}

function descriptorMap(
  ...descriptors: WorkspaceEnvironmentDescriptor[]
): ReadonlyMap<string, WorkspaceEnvironmentDescriptor> {
  return new Map(descriptors.map((item) => [item.id, item]));
}

function projectMap(
  ...entries: WorkspaceProjectDescriptor[]
): ReadonlyMap<string, WorkspaceProjectDescriptor> {
  return new Map(entries.map((item) => [item.projectId, item]));
}

function tree(
  projectGroups: ProjectThreadGroup[],
  environments: ReadonlyMap<string, WorkspaceEnvironmentDescriptor> = new Map(),
  projects: ReadonlyMap<string, WorkspaceProjectDescriptor> = new Map(),
  worktreeSort: WorktreeSortMode = "manual",
  workspaceOwnership = {},
) {
  return buildTree({
    projectGroups,
    now: NOW,
    assignment: {},
    groupOrder: [],
    workspaceOrder: {},
    worktreeSort,
    ungroupedIcon: "FolderTreeIcon",
    environments,
    projects,
    workspaceOwnership,
  });
}

describe("a workspace outlives the conversations in it", () => {
  /**
   * The case the row exists for. Settling archives the last thread in a
   * worktree, which takes its family out of the tree — and the worktree has to
   * stay, because the row's `+` is the only way back into it.
   */
  it("keeps a worktree row whose threads have all been settled", () => {
    const settledOut = descriptor("env_settled", "p1", "/work/trees/only-one", {
      branchName: "feat/only-one",
      name: "只剩归档对话的分支",
    });
    const occupied = descriptor("env_live", "p1", "/work/trees/still-busy", {
      branchName: "feat/still-busy",
      name: "还有对话的分支",
    });

    // No families: every thread in this project is parked on a shelf.
    const nodes = tree(
      [group("p1", [])],
      descriptorMap(settledOut, occupied),
      projectMap(
        { projectId: "p1", sourcePath: "/work/repo", sourceHostId: "host_1" },
      ),
    );

    const workspaces = nodes.flatMap((node) =>
      node.projects.flatMap((project) => project.workspaces),
    );
    const labels = workspaces.map((workspace) => workspace.ref.label).sort();
    assert.deepEqual(labels, ["只剩归档对话的分支", "还有对话的分支"]);
    for (const workspace of workspaces) {
      assert.deepEqual(workspace.families, []);
      assert.notEqual(workspace.ref.environmentId, null);
    }
  });

  /**
   * The identity the tree groups by is `key`. An environment-only row that
   * computed a different one would draw a second row beside the worktree its
   * own threads already occupy.
   */
  it("merges an empty environment into the row its threads built", () => {
    const live = descriptor("env_live", "p1", "/work/trees/busy", {
      branchName: "feat/busy",
      name: "有对话的分支",
    });
    const empty = descriptor("env_empty", "p1", "/work/trees/empty", {
      branchName: "feat/empty",
      name: "没有对话的分支",
    });
    const projects = projectMap({
      projectId: "p1",
      sourcePath: "/work/repo",
      sourceHostId: "host_1",
    });

    const nodes = tree(
      [
        group("p1", [
          family("t1", "p1", environmentRef("env_live", "有对话的分支", "feat/busy")),
        ]),
      ],
      descriptorMap(live, empty),
      projects,
    );
    const workspaces = nodes.flatMap((node) =>
      node.projects.flatMap((project) => project.workspaces),
    );

    assert.equal(workspaces.length, 2);
    const busy = workspaces.find(
      (workspace) => workspace.ref.environmentId === "env_live",
    );
    assert.equal(busy?.families.length, 1, "the thread's own row must survive");

    // The invariant the merge depends on: one descriptor, one key, whichever
    // side of the tree asked for it.
    for (const workspace of workspaces) {
      const item = descriptorMap(live, empty).get(
        workspace.ref.environmentId ?? "",
      );
      assert.equal(
        workspaceRefOfEnvironment(item!, projects)?.key,
        workspace.ref.key,
      );
    }
  });

  it("keeps environments of other projects out of this one", () => {
    const mine = descriptor("env_mine", "p1", "/work/trees/mine");
    const theirs = descriptor("env_theirs", "p2", "/work/trees/theirs");

    const nodes = tree(
      [group("p1", [])],
      descriptorMap(mine, theirs),
      projectMap(
        { projectId: "p1", sourcePath: "/work/repo", sourceHostId: "host_1" },
        { projectId: "p2", sourcePath: "/work/other", sourceHostId: "host_1" },
      ),
    );

    const ids = nodes.flatMap((node) =>
      node.projects.flatMap((project) =>
        project.workspaces.map((workspace) => workspace.ref.environmentId),
      ),
    );
    assert.deepEqual(ids, ["env_mine"]);
  });

  it("draws a workspace under its derived owner even when bb claimed another project", () => {
    const wrong = descriptor("env_wrong", "p1", "/work/warren", {
      isWorktree: false,
      branchName: "main",
    });
    const ownership = {
      env_wrong: {
        environmentId: "env_wrong",
        claimedProjectId: "p1",
        ownerProjectId: "p2",
        workspaceKey: "ws:host_1:/work/warren",
        repoKey: "repo:remote:example/warren",
        kind: "project-checkout" as const,
        confidence: "exact-source" as const,
        conflict: true,
      },
    };

    const nodes = tree(
      [group("p1", []), group("p2", [])],
      descriptorMap(wrong),
      projectMap(
        { projectId: "p1", sourcePath: "/work/repo", sourceHostId: "host_1" },
        { projectId: "p2", sourcePath: "/work/warren", sourceHostId: "host_1" },
      ),
      "manual",
      ownership,
    );

    assert.deepEqual(
      nodes[0]?.projects.map((project) => [
        project.project.id,
        project.workspaces.map((workspace) => workspace.ref.environmentId),
        project.foreignClaimProjectIds,
      ]),
      [
        ["p1", [], []],
        ["p2", ["env_wrong"], ["p1"]],
      ],
    );
  });

  /**
   * A personal workspace is not a place on disk, so it is not a row: it is what
   * `workspaceRefOf` reports as the no-workspace bucket.
   */
  it("invents no row for a personal environment", () => {
    const personal = descriptor("env_personal", "p1", "/work/personal", {
      providerId: "personal-workspace",
      isWorktree: false,
      workspaceDisplayKind: null,
    });

    const nodes = tree(
      [group("p1", [])],
      descriptorMap(personal),
      projectMap({
        projectId: "p1",
        sourcePath: "/work/repo",
        sourceHostId: "host_1",
      }),
    );

    const workspaces = nodes.flatMap((node) =>
      node.projects.flatMap((project) => project.workspaces),
    );
    assert.equal(
      workspaces.filter((workspace) => workspace.ref.kind !== "personal").length,
      0,
    );
  });
});

describe("projectWorkspaceRefs", () => {
  /**
   * The arrangement of a project's worktrees is written from this set, so a
   * workspace missing here is one the user can see but not move. A worktree
   * that has never held a thread is the case that exposed it.
   */
  it("names every workspace the project owns, threads or not", () => {
    const busy = descriptor("env_busy", "p1", "/work/trees/busy", {
      branchName: "feat/busy",
    });
    const neverUsed = descriptor("env_never", "p1", "/work/trees/never", {
      branchName: "feat/never",
    });
    const other = descriptor("env_other", "p2", "/work/trees/elsewhere", {
      branchName: "feat/elsewhere",
    });

    const refs = projectWorkspaceRefs(
      "p1",
      [family("t1", "p1", environmentRef("env_busy", null, "feat/busy"))],
      descriptorMap(busy, neverUsed, other),
      projectMap(),
    );

    assert.deepEqual(
      [...refs.values()].map((ref) => ref.branch).sort(),
      ["feat/busy", "feat/never"],
    );
  });

  it("is empty for a project with nothing on disk and no threads", () => {
    assert.equal(
      projectWorkspaceRefs("p1", [], new Map(), projectMap()).size,
      0,
    );
  });

  it("includes a repository worktree that has no bb environment yet", () => {
    const refs = projectWorkspaceRefs(
      "p1",
      [],
      new Map(),
      projectMap({
        projectId: "p1",
        sourcePath: "/work/repo",
        sourceHostId: "host_1",
      }),
      {},
      [
        {
          projectId: "p1",
          repoKey: "repo:remote:example/app",
          hostId: "host_1",
          path: "/work/unseen",
          branch: "feat/unseen",
          detached: false,
        },
      ],
    );

    const ref = [...refs.values()][0];
    assert.equal(ref?.environmentId, null);
    assert.equal(ref?.kind, "git-worktree");
    assert.equal(ref?.branch, "feat/unseen");
    assert.equal(ref?.path, "/work/unseen");
  });
});

describe("workspaceRefOfEnvironment", () => {
  it("is the ref the same environment's threads produce", () => {
    const item = descriptor("env_1", "p1", "/work/trees/one", {
      branchName: "feat/one",
      name: "分支一",
    });
    const projects = projectMap({
      projectId: "p1",
      sourcePath: "/work/repo",
      sourceHostId: "host_1",
    });

    const fromThread = workspaceRefOf(
      thread("t1", "p1", environmentRef("env_1", "分支一", "feat/one")),
      descriptorMap(item),
      projects,
    );
    const fromEnvironment = workspaceRefOfEnvironment(item, projects);

    assert.deepEqual(fromEnvironment, fromThread);
  });

  it("is null for a personal environment", () => {
    const item = descriptor("env_personal", "p1", "/work/personal", {
      providerId: "personal-workspace",
    });
    assert.equal(workspaceRefOfEnvironment(item, new Map()), null);
  });
});

/**
 * The worktree lens, through the tree rather than through the comparator: this
 * is what proves the numbers a row is ranked by really are read off the row.
 *
 * Three worktrees chosen so that no two modes agree — by name the order is A, M,
 * Z; by size it is the reverse; by activity it is M, A, Z. The checkout carries
 * no threads at all, so it is last on both of the fact-driven modes and only the
 * exemption keeps it where it belongs.
 */
describe("the worktree lens", () => {
  const checkout = descriptor("env_checkout", "p1", "/work/repo", {
    isWorktree: false,
    branchName: "master",
    name: "主干",
  });
  const quiet = descriptor("env_quiet", "p1", "/work/trees/quiet", {
    branchName: "quiet",
    name: "A 分支",
  });
  const mid = descriptor("env_mid", "p1", "/work/trees/mid", {
    branchName: "mid",
    name: "M 分支",
  });
  const busy = descriptor("env_busy", "p1", "/work/trees/busy", {
    branchName: "busy",
    name: "Z 分支",
  });
  const environments = descriptorMap(checkout, quiet, mid, busy);
  const projects = projectMap({
    projectId: "p1",
    sourcePath: "/work/repo",
    sourceHostId: "host_1",
  });
  const groups = [
    group("p1", [
      family("t1", "p1", environmentRef("env_busy", "Z 分支", "busy"), NOW - 900),
      family("t2", "p1", environmentRef("env_busy", "Z 分支", "busy"), NOW - 950),
      family("t3", "p1", environmentRef("env_busy", "Z 分支", "busy"), NOW - 990),
      family("t4", "p1", environmentRef("env_mid", "M 分支", "mid"), NOW - 100),
      family("t5", "p1", environmentRef("env_mid", "M 分支", "mid"), NOW - 800),
      family("t6", "p1", environmentRef("env_quiet", "A 分支", "quiet"), NOW - 500),
    ]),
  ];

  const labels = (mode: WorktreeSortMode) => {
    const nodes = tree(groups, environments, projects, mode);
    return nodes.flatMap((node) =>
      node.projects.flatMap((project) =>
        project.workspaces.map((workspace) => workspace.ref.label),
      ),
    );
  };

  it("leads with the checkout under every mode", () => {
    for (const mode of [
      "manual",
      "name-asc",
      "updated-desc",
      "threads-desc",
      "status",
    ] as const) {
      assert.equal(labels(mode)[0], "主干", mode);
    }
  });

  it("ranks the worktrees by the mode it was given", () => {
    assert.deepEqual(labels("name-asc"), ["主干", "A 分支", "M 分支", "Z 分支"]);
    assert.deepEqual(labels("threads-desc"), ["主干", "Z 分支", "M 分支", "A 分支"]);
    assert.deepEqual(labels("updated-desc"), ["主干", "M 分支", "A 分支", "Z 分支"]);
  });
});
