import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  inferRepos,
  type RepoWorktree,
  type WorkspaceFacts,
} from "../lib/repo-identity.ts";
import { inferWorkspaceOwnership } from "../lib/workspace-ownership.ts";
import type {
  WorkspaceEnvironmentDescriptor,
  WorkspaceProjectDescriptor,
} from "../lib/workspace.ts";

const HOST = "host_1";
const REMOTE_APP = "git@github.com:example/app.git";
const REMOTE_WARREN = "git@github.com:example/warren.git";

function environment(
  id: string,
  projectId: string,
  path: string,
  overrides: Partial<WorkspaceEnvironmentDescriptor> = {},
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
    ...overrides,
  };
}

function project(
  projectId: string,
  sourcePath: string,
): WorkspaceProjectDescriptor {
  return { projectId, sourcePath, sourceHostId: HOST };
}

function facts(input: {
  path: string;
  remoteUrl?: string | null;
  commonDir?: string | null;
  main?: boolean;
  linked?: boolean;
  nested?: boolean;
  root?: string | null;
  worktrees?: readonly RepoWorktree[];
}): WorkspaceFacts {
  return {
    hostId: HOST,
    path: input.path,
    realPath: input.path,
    isDirectory: true,
    isMainWorktree: input.main ?? false,
    isLinkedWorktree: input.linked ?? false,
    isNestedRepository: input.nested ?? false,
    repositoryRoot: input.root ?? input.path,
    commonDir: input.commonDir ?? `${input.path}/.git`,
    remoteUrl: input.remoteUrl ?? null,
    worktrees: input.worktrees ?? [],
  };
}

function infer(input: {
  environments: readonly WorkspaceEnvironmentDescriptor[];
  projects: readonly WorkspaceProjectDescriptor[];
  facts: readonly WorkspaceFacts[];
}) {
  const repos = inferRepos({
    environments: input.environments,
    projects: new Map(input.projects.map((item) => [item.projectId, item])),
    facts: input.facts,
  });
  const ownership = inferWorkspaceOwnership({
    environments: input.environments,
    repos: repos.repos,
    sourceByProject: repos.sourceByProject,
    sourceRepoKeyByProject: repos.sourceRepoKeyByProject,
  });
  return { repos, ownership };
}

describe("physical ownership of a project", () => {
  it("moves a checkout claimed by the wrong project to its source owner", () => {
    const app = project("proj_app", "/repos/app");
    const warren = project("proj_warren", "/repos/warren");
    const appEnv = environment("env_app", "proj_app", "/repos/app");
    const warrenEnv = environment("env_warren", "proj_app", "/repos/warren", {
      branchName: "main",
    });
    const result = infer({
      environments: [appEnv, warrenEnv],
      projects: [app, warren],
      facts: [
        facts({
          path: "/repos/app",
          remoteUrl: REMOTE_APP,
          main: true,
          root: "/repos/app",
        }),
        facts({
          path: "/repos/warren",
          remoteUrl: REMOTE_WARREN,
          main: true,
          root: "/repos/warren",
        }),
      ],
    });

    assert.equal(
      result.ownership.byEnvironmentId.env_warren?.ownerProjectId,
      "proj_warren",
    );
    assert.equal(
      result.ownership.byEnvironmentId.env_warren?.kind,
      "project-checkout",
    );
    assert.equal(result.ownership.byEnvironmentId.env_warren?.conflict, true);
    assert.ok(
      result.ownership.diagnostics.some(
        (diagnostic) => diagnostic.code === "ownership-conflict",
      ),
    );
  });

  it("keeps a linked worktree under the repository's source project", () => {
    const app = project("proj_app", "/repos/app");
    const wt = environment("env_wt", "proj_app", "/worktrees/app-wt", {
      isWorktree: true,
      branchName: "feat/worktree",
    });
    const result = infer({
      environments: [wt],
      projects: [app],
      facts: [
        facts({
          path: "/repos/app",
          remoteUrl: REMOTE_APP,
          main: true,
          root: "/repos/app",
          worktrees: [
            {
              path: "/repos/app",
              branch: "main",
              head: null,
              detached: false,
              prunable: false,
            },
            {
              path: "/worktrees/app-wt",
              branch: "feat/worktree",
              head: null,
              detached: false,
              prunable: false,
            },
          ],
        }),
        facts({
          path: "/worktrees/app-wt",
          remoteUrl: REMOTE_APP,
          linked: true,
          root: "/worktrees/app-wt",
          worktrees: [
            {
              path: "/repos/app",
              branch: "main",
              head: null,
              detached: false,
              prunable: false,
            },
            {
              path: "/worktrees/app-wt",
              branch: "feat/worktree",
              head: null,
              detached: false,
              prunable: false,
            },
          ],
        }),
      ],
    });

    assert.equal(
      result.ownership.byEnvironmentId.env_wt?.ownerProjectId,
      "proj_app",
    );
    assert.equal(result.ownership.byEnvironmentId.env_wt?.kind, "git-worktree");
    assert.equal(result.ownership.byEnvironmentId.env_wt?.conflict, false);
  });

  it("gives duplicate records one owner and one workspace identity", () => {
    const app = project("proj_app", "/repos/app");
    const warren = project("proj_warren", "/repos/warren");
    const first = environment("env_a", "proj_app", "/repos/warren");
    const second = environment("env_b", "proj_warren", "/repos/warren");
    const result = infer({
      environments: [first, second],
      projects: [app, warren],
      facts: [
        facts({
          path: "/repos/app",
          remoteUrl: REMOTE_APP,
          main: true,
        }),
        facts({
          path: "/repos/warren",
          remoteUrl: REMOTE_WARREN,
          main: true,
        }),
      ],
    });

    assert.equal(
      result.ownership.byEnvironmentId.env_a?.ownerProjectId,
      "proj_warren",
    );
    assert.equal(
      result.ownership.byEnvironmentId.env_a?.workspaceKey,
      result.ownership.byEnvironmentId.env_b?.workspaceKey,
    );
  });

  it("assigns unseen repository worktrees to a source-only owner", () => {
    const app = project("proj_app", "/repos/app");
    const root = environment("env_app", "proj_app", "/repos/app");
    const result = infer({
      environments: [root],
      projects: [app],
      facts: [
        facts({
          path: "/repos/app",
          remoteUrl: REMOTE_APP,
          main: true,
          worktrees: [
            {
              path: "/repos/app",
              branch: "main",
              head: null,
              detached: false,
              prunable: false,
            },
            {
              path: "/worktrees/app-unseen",
              branch: "feat/unseen",
              head: null,
              detached: false,
              prunable: false,
            },
          ],
        }),
      ],
    });

    assert.deepEqual(
      result.ownership.unseenByProject.proj_app?.map((row) => row.path),
      ["/worktrees/app-unseen"],
    );
  });

  it("falls back to the claimed project when the path was not observed", () => {
    const app = project("proj_app", "/repos/app");
    const unknown = environment("env_unknown", "proj_app", "/missing");
    const result = infer({
      environments: [unknown],
      projects: [app],
      facts: [],
    });

    assert.equal(
      result.ownership.byEnvironmentId.env_unknown?.ownerProjectId,
      "proj_app",
    );
    assert.equal(
      result.ownership.byEnvironmentId.env_unknown?.confidence,
      "claimed",
    );
  });

  it("does not invent a winner when several projects share one remote", () => {
    const one = project("proj_one", "/repos/one");
    const two = project("proj_two", "/repos/two");
    const workspace = environment("env_workspace", "proj_two", "/repos/three");
    const result = infer({
      environments: [workspace],
      projects: [one, two],
      facts: [
        facts({ path: "/repos/one", remoteUrl: REMOTE_APP, main: true }),
        facts({ path: "/repos/two", remoteUrl: REMOTE_APP, main: true }),
        facts({ path: "/repos/three", remoteUrl: REMOTE_APP, main: true }),
      ],
    });

    assert.equal(
      result.ownership.byEnvironmentId.env_workspace?.ownerProjectId,
      "proj_two",
    );
    assert.ok(
      result.ownership.diagnostics.some(
        (diagnostic) => diagnostic.code === "ambiguous-owner",
      ),
    );
  });
});
