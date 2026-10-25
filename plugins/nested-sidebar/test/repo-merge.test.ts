import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk";
import { buildTree } from "../lib/tree.ts";
import type { ProjectThreadGroup, ThreadFamily } from "../lib/inbox.ts";
import type {
  WorkspaceEnvironmentDescriptor,
  WorkspaceProjectDescriptor,
} from "../lib/workspace.ts";

const NOW = 1_700_000_000_000;
const HOST = "host_1";

function thread(
  id: string,
  projectId: string,
  environmentId: string | null,
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
    environment:
      environmentId === null
        ? null
        : {
            id: environmentId,
            name: null,
            branchName: "main",
            path: null,
            isWorktree: false,
            providerId: "project-checkout",
            workspaceDisplayKind: null,
          },
    host: null,
    createdAt: NOW - 1_000,
    updatedAt: NOW - 1_000,
    lastReadAt: null,
    latestAttentionAt: NOW - 1_000,
  };
}

function family(id: string, projectId: string, environmentId: string | null): ThreadFamily {
  return { root: thread(id, projectId, environmentId), children: [] };
}

function group(id: string, families: ThreadFamily[]): ProjectThreadGroup {
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

function environment(
  id: string,
  projectId: string,
  path: string,
): WorkspaceEnvironmentDescriptor {
  return {
    id,
    projectId,
    hostId: HOST,
    path,
    isGitRepo: true,
    isWorktree: false,
    branchName: "main",
    name: null,
    providerId: "project-checkout",
    workspaceDisplayKind: "other",
  };
}

function source(projectId: string, path: string): WorkspaceProjectDescriptor {
  return { projectId, sourcePath: path, sourceHostId: HOST };
}

/**
 * One repository filed as two projects: the shape an agent makes when it creates
 * a project for a worktree instead of an environment in the existing one.
 */
function twoProjectsOneRepo() {
  return {
    projectGroups: [
      group("proj_main", [family("thr_main", "proj_main", "env_main")]),
      group("proj_wt", [family("thr_wt", "proj_wt", "env_wt")]),
    ],
    environments: new Map([
      ["env_main", environment("env_main", "proj_main", "/repos/app")],
      ["env_wt", environment("env_wt", "proj_wt", "/repos/app-wt")],
      // An environment with no thread in it: the second project's `+` row.
      ["env_idle", environment("env_idle", "proj_wt", "/repos/app-idle")],
    ]),
    projects: new Map([
      ["proj_main", source("proj_main", "/repos/app")],
      ["proj_wt", source("proj_wt", "/repos/app-wt")],
    ]),
    repoKeyByProject: {
      proj_main: "repo:remote:github.com/euanguo/app",
      proj_wt: "repo:remote:github.com/euanguo/app",
    },
  };
}

function tree(input: ReturnType<typeof twoProjectsOneRepo>, mergeRepos: boolean) {
  return buildTree({
    projectGroups: input.projectGroups,
    now: NOW,
    assignment: {},
    groupOrder: [],
    workspaceOrder: {},
    ungroupedIcon: "LayerIcon",
    environments: input.environments,
    projects: input.projects,
    repoKeyByProject: input.repoKeyByProject,
    mergeRepos,
  });
}

describe("drawing one repository as one row", () => {
  it("leaves bb's own answer alone when the merge is off", () => {
    const nodes = tree(twoProjectsOneRepo(), false);
    assert.equal(nodes.length, 1);
    assert.deepEqual(
      nodes[0].projects.map((project) => project.project.id),
      ["proj_main", "proj_wt"],
    );
    // Each row still knows which repository it is in, which is what a badge
    // needs even when nothing was merged.
    assert.deepEqual(
      nodes[0].projects.map((project) => project.repoKey),
      ["repo:remote:github.com/euanguo/app", "repo:remote:github.com/euanguo/app"],
    );
    assert.deepEqual(
      nodes[0].projects.map((project) => project.mergedProjectIds),
      [["proj_main"], ["proj_wt"]],
    );
  });

  it("merges them into the row the first project already occupied", () => {
    const nodes = tree(twoProjectsOneRepo(), true);
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].projects.length, 1);

    const row = nodes[0].projects[0];
    assert.equal(row.project.id, "proj_main");
    assert.equal(row.project.name, "proj_main");
    assert.deepEqual(row.mergedProjectIds, ["proj_main", "proj_wt"]);
    assert.deepEqual(
      row.families.map((item) => item.root.id),
      ["thr_main", "thr_wt"],
    );
  });

  it("keeps the workspaces of every project the row stands for", () => {
    const row = tree(twoProjectsOneRepo(), true)[0].projects[0];
    // Three, not two: the idle environment belongs to the second project, and
    // dropping it would take that worktree's `+` off the sidebar.
    assert.deepEqual(
      row.workspaces.map((workspace) => workspace.ref.path).sort(),
      ["/repos/app", "/repos/app-idle", "/repos/app-wt"],
    );
  });

  it("never merges a project whose repository was not resolved", () => {
    const input = twoProjectsOneRepo();
    const nodes = buildTree({
      ...input,
      now: NOW,
      assignment: {},
      groupOrder: [],
      workspaceOrder: {},
      ungroupedIcon: "LayerIcon",
      mergeRepos: true,
      // The second project was never observed: an unread directory is not
      // evidence that it is the same repository as the first.
      repoKeyByProject: { proj_main: "repo:remote:github.com/euanguo/app" },
    });

    assert.deepEqual(
      nodes[0].projects.map((project) => project.project.id),
      ["proj_main", "proj_wt"],
    );
    assert.equal(nodes[0].projects[1].repoKey, null);
  });

  it("keeps two different repositories apart", () => {
    const input = twoProjectsOneRepo();
    const nodes = buildTree({
      ...input,
      now: NOW,
      assignment: {},
      groupOrder: [],
      workspaceOrder: {},
      ungroupedIcon: "LayerIcon",
      mergeRepos: true,
      repoKeyByProject: {
        proj_main: "repo:remote:github.com/euanguo/app",
        proj_wt: "repo:remote:github.com/euanguo/other",
      },
    });

    assert.equal(nodes[0].projects.length, 2);
  });

  it("merges nothing when nobody asked", () => {
    const input = twoProjectsOneRepo();
    const nodes = buildTree({
      projectGroups: input.projectGroups,
      now: NOW,
      assignment: {},
      groupOrder: [],
      workspaceOrder: {},
      ungroupedIcon: "LayerIcon",
      environments: input.environments,
      projects: input.projects,
    });

    assert.equal(nodes[0].projects.length, 2);
    assert.deepEqual(
      nodes[0].projects.map((project) => project.repoKey),
      [null, null],
    );
  });
});
