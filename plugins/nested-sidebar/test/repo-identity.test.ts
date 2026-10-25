import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  inferRepos,
  normalizeRemoteUrl,
  normalizeRepoPath,
  physicalWorkspaceKey,
  repoKeyOf,
  repoName,
  type WorkspaceFacts,
} from "../lib/repo-identity.ts";
import type {
  WorkspaceEnvironmentDescriptor,
  WorkspaceProjectDescriptor,
} from "../lib/workspace.ts";

const HOST = "host_1";

function environment(
  overrides: Partial<WorkspaceEnvironmentDescriptor> & { id: string; projectId: string; path: string },
): WorkspaceEnvironmentDescriptor {
  return {
    hostId: HOST,
    isGitRepo: true,
    isWorktree: false,
    branchName: null,
    name: null,
    providerId: null,
    workspaceDisplayKind: null,
    ...overrides,
  };
}

function project(projectId: string, sourcePath: string): WorkspaceProjectDescriptor {
  return { projectId, sourcePath, sourceHostId: HOST };
}

function facts(
  overrides: Partial<WorkspaceFacts> & { path: string; realPath: string },
): WorkspaceFacts {
  return {
    hostId: HOST,
    isDirectory: true,
    isMainWorktree: true,
    isLinkedWorktree: false,
    isNestedRepository: false,
    repositoryRoot: overrides.realPath,
    commonDir: `${overrides.realPath}/.git`,
    remoteUrl: null,
    worktrees: [],
    ...overrides,
  };
}

describe("normalizing a remote URL to the repository it names", () => {
  it("reduces every spelling of one repository to one key", () => {
    const expected = "github.com/euanguo/traffic-ledger";
    for (const spelling of [
      "https://github.com/euanguo/traffic-ledger.git",
      "https://github.com/euanguo/traffic-ledger",
      "http://github.com/euanguo/traffic-ledger.git/",
      "git@github.com:euanguo/traffic-ledger.git",
      "ssh://git@github.com/euanguo/traffic-ledger.git",
      "https://github.com/euanguo/traffic-ledger.git#readme",
    ]) {
      assert.equal(normalizeRemoteUrl(spelling), expected, spelling);
    }
  });

  it("keeps two forks of one repository apart", () => {
    assert.notEqual(
      normalizeRemoteUrl("https://github.com/verger-guo/chaoshangtong.git"),
      normalizeRemoteUrl("https://github.com/euanguo/chaoshangtong.git"),
    );
  });

  it("ignores credentials and ports without merging anything", () => {
    assert.equal(
      normalizeRemoteUrl("https://user:token@github.com/euanguo/traffic-ledger.git"),
      "github.com/euanguo/traffic-ledger",
    );
    assert.equal(
      normalizeRemoteUrl("https://github.com:8443/euanguo/traffic-ledger.git"),
      "github.com/euanguo/traffic-ledger",
    );
  });

  it("answers null for anything that names no repository", () => {
    for (const value of [null, undefined, "", "   ", "file:///Users/verger/repo", "not a url"]) {
      assert.equal(normalizeRemoteUrl(value), null, String(value));
    }
  });
});

describe("normalizing a workspace path", () => {
  it("collapses the spellings of one directory", () => {
    assert.equal(normalizeRepoPath("/a/b/"), "/a/b");
    assert.equal(normalizeRepoPath("/a//b///c"), "/a/b/c");
    assert.equal(normalizeRepoPath("C:\\a\\b"), "C:/a/b");
    assert.equal(normalizeRepoPath("/"), "/");
  });

  it("answers null for nothing at all", () => {
    assert.equal(normalizeRepoPath(null), null);
    assert.equal(normalizeRepoPath("   "), null);
  });

  it("keys a workspace by host and directory, not by the record", () => {
    assert.equal(
      physicalWorkspaceKey(HOST, "/a/b/"),
      physicalWorkspaceKey(HOST, "/a/b"),
    );
    assert.notEqual(
      physicalWorkspaceKey(HOST, "/a/b"),
      physicalWorkspaceKey("host_2", "/a/b"),
    );
  });
});

describe("keying a repository", () => {
  it("prefers the remote, which is the only identity two machines share", () => {
    assert.equal(
      repoKeyOf(facts({
        path: "/a",
        realPath: "/a",
        commonDir: "/a/.git",
        remoteUrl: "https://github.com/euanguo/traffic-ledger.git",
      })),
      "repo:remote:github.com/euanguo/traffic-ledger",
    );
  });

  it("falls back to the shared git dir when there is no remote", () => {
    assert.equal(
      repoKeyOf(facts({ path: "/a", realPath: "/a", commonDir: "/a/.git" })),
      `repo:dir:${HOST}:/a/.git`,
    );
  });

  it("keys a plain directory by itself", () => {
    assert.equal(
      repoKeyOf(facts({
        path: "/plain",
        realPath: "/plain",
        isMainWorktree: false,
        commonDir: null,
      })),
      `repo:dir:${HOST}:/plain`,
    );
  });

  it("names a repository after its remote, then its directory", () => {
    assert.equal(
      repoName("https://github.com/euanguo/traffic-ledger.git", "/a"),
      "traffic-ledger",
    );
    assert.equal(repoName(null, "/Users/verger/code_source/warren"), "warren");
  });

  it("never names a repository after the .git it shares", () => {
    // The bug this guards: a repository with no remote fell back to the shared
    // git dir, whose last segment is `.git`, so the row was titled `.git`.
    const result = inferRepos({
      environments: [environment({ id: "env_a", projectId: "proj", path: "/repos/warren" })],
      projects: new Map([["proj", project("proj", "/repos/warren")]]),
      facts: [facts({ path: "/repos/warren", realPath: "/repos/warren" })],
    });

    assert.equal(result.repos[0].name, "warren");
    assert.equal(result.repos[0].kind, "git-local");
  });
});

describe("grouping workspaces into repositories", () => {
  it("keys a project by its source, not by the first environment that claims it", () => {
    const root = "/repos/app";
    const result = inferRepos({
      environments: [
        environment({ id: "env_a", projectId: "proj", path: "/repos/wrong" }),
      ],
      projects: new Map([["proj", project("proj", root)]]),
      facts: [
        facts({
          path: root,
          realPath: root,
          commonDir: `${root}/.git`,
          remoteUrl: "https://github.com/example/app.git",
        }),
        facts({
          path: "/repos/wrong",
          realPath: "/repos/wrong",
          commonDir: "/repos/wrong/.git",
          remoteUrl: "https://github.com/example/wrong.git",
        }),
      ],
    });

    assert.equal(
      result.repoKeyByProject.get("proj"),
      "repo:remote:github.com/example/app",
    );
    assert.equal(
      result.sourceRepoKeyByProject.get("proj"),
      "repo:remote:github.com/example/app",
    );
    assert.equal(
      result.sourceByProject.get("proj")?.repositoryRoot,
      root,
    );
  });

  it("draws one repository under one node when bb filed it as two projects", () => {
    const root = "/repos/app";
    const worktree = "/repos/app-wt";
    const result = inferRepos({
      environments: [
        environment({ id: "env_a", projectId: "proj_one", path: root }),
        environment({ id: "env_b", projectId: "proj_two", path: worktree, isWorktree: true }),
      ],
      projects: new Map([
        ["proj_one", project("proj_one", root)],
        ["proj_two", project("proj_two", worktree)],
      ]),
      facts: [
        facts({
          path: root,
          realPath: root,
          commonDir: "/repos/app/.git",
          remoteUrl: "git@github.com:euanguo/traffic-ledger.git",
          worktrees: [
            { path: root, branch: "main", head: null, detached: false, prunable: false },
            { path: worktree, branch: "bb/x", head: null, detached: false, prunable: false },
          ],
        }),
        facts({
          path: worktree,
          realPath: worktree,
          isMainWorktree: false,
          isLinkedWorktree: true,
          commonDir: "/repos/app/.git",
          remoteUrl: "git@github.com:euanguo/traffic-ledger.git",
        }),
      ],
    });

    assert.equal(result.repos.length, 1);
    assert.equal(result.repos[0].key, "repo:remote:github.com/euanguo/traffic-ledger");
    assert.deepEqual(result.repos[0].projectIds, ["proj_one", "proj_two"]);
    assert.equal(result.repos[0].workspaces.length, 2);
    assert.ok(result.diagnostics.some((item) => item.code === "split-repo"));
    assert.equal(result.repoKeyByProject.get("proj_one"), result.repoKeyByProject.get("proj_two"));
  });

  it("reports worktrees the repository records and bb has no environment for", () => {
    const root = "/repos/app";
    const result = inferRepos({
      environments: [environment({ id: "env_a", projectId: "proj", path: root })],
      projects: new Map([["proj", project("proj", root)]]),
      facts: [
        facts({
          path: root,
          realPath: root,
          commonDir: "/repos/app/.git",
          worktrees: [
            { path: root, branch: "main", head: null, detached: false, prunable: false },
            { path: "/elsewhere/despina", branch: "verger-guo/test", head: null, detached: false, prunable: false },
            { path: "/elsewhere/gone", branch: null, head: "abc1234", detached: true, prunable: true },
          ],
        }),
      ],
    });

    assert.deepEqual(
      result.repos[0].unseenWorktrees.map((worktree) => worktree.path),
      ["/elsewhere/despina", "/elsewhere/gone"],
    );
    const diagnostic = result.diagnostics.find((item) => item.code === "unseen-worktree");
    assert.ok(diagnostic);
    assert.equal(diagnostic.subjects.length, 2);
  });

  it("folds two records for one directory into one workspace and says so", () => {
    const root = "/repos/app";
    const result = inferRepos({
      environments: [
        environment({ id: "env_a", projectId: "proj", path: root }),
        environment({ id: "env_b", projectId: "proj", path: `${root}/` }),
      ],
      projects: new Map([["proj", project("proj", root)]]),
      facts: [facts({ path: root, realPath: root })],
    });

    assert.equal(result.repos[0].workspaces.length, 1);
    assert.deepEqual(result.repos[0].workspaces[0].environmentIds, ["env_a", "env_b"]);
    assert.ok(result.diagnostics.some((item) => item.code === "duplicate-path"));
  });

  it("groups by the resolved path when bb's spelling differs", () => {
    const raw = "/var/repos/app";
    const real = "/private/var/repos/app";
    const result = inferRepos({
      environments: [environment({ id: "env_a", projectId: "proj", path: raw })],
      projects: new Map([["proj", project("proj", raw)]]),
      facts: [facts({ path: raw, realPath: real })],
    });

    assert.equal(result.repos[0].workspaces[0].path, real);
    assert.deepEqual(result.repos[0].workspaces[0].rawPaths, [raw]);
    assert.ok(result.diagnostics.some((item) => item.code === "path-not-canonical"));
  });

  it("keeps a workspace whose facts never arrived, and marks it unverified", () => {
    const result = inferRepos({
      environments: [environment({ id: "env_a", projectId: "proj", path: "/unreadable" })],
      projects: new Map([["proj", project("proj", "/unreadable")]]),
      facts: [],
    });

    assert.equal(result.repos.length, 1);
    assert.equal(result.repos[0].kind, "directory");
    assert.equal(result.repos[0].workspaces.length, 1);
    assert.ok(result.diagnostics.some((item) => item.code === "dangling-path"));
  });

  it("leaves personal workspaces out of the repository axis", () => {
    const result = inferRepos({
      environments: [
        environment({
          id: "env_personal",
          projectId: "proj_personal",
          path: "/Users/verger/.bb/plugins/environment-personal-workspace/host-data/workspaces/thr_1",
          providerId: "personal-workspace",
          isGitRepo: false,
        }),
      ],
      projects: new Map(),
      facts: [],
    });

    assert.deepEqual(result.repos, []);
    assert.deepEqual(result.diagnostics, []);
  });

  it("draws each repository under its own node when one project reaches into two", () => {
    const container = "/container";
    const nested = "/container/inner";
    const result = inferRepos({
      environments: [
        environment({ id: "env_a", projectId: "proj", path: container, isGitRepo: false }),
        environment({ id: "env_b", projectId: "proj", path: nested }),
      ],
      projects: new Map([["proj", project("proj", container)]]),
      facts: [
        facts({ path: container, realPath: container, isMainWorktree: false, commonDir: null }),
        facts({
          path: nested,
          realPath: nested,
          commonDir: `${nested}/.git`,
          remoteUrl: "https://github.com/euanguo/inner.git",
        }),
      ],
    });

    assert.equal(result.repos.length, 2);
    const multi = result.diagnostics.find((item) => item.code === "multi-repo-project");
    assert.ok(multi);
    assert.equal(multi.subjects.length, 3);
  });

  it("reports a workspace in a different repository from the project's source", () => {
    const result = inferRepos({
      environments: [environment({ id: "env_a", projectId: "proj", path: "/elsewhere/app" })],
      projects: new Map([["proj", project("proj", "/repos/app")]]),
      facts: [
        facts({ path: "/elsewhere/app", realPath: "/elsewhere/app", commonDir: "/elsewhere/app/.git" }),
        facts({
          path: "/repos/app",
          realPath: "/repos/app",
          commonDir: "/repos/app/.git",
          remoteUrl: "https://github.com/euanguo/traffic-ledger.git",
        }),
      ],
    });

    assert.ok(result.diagnostics.some((item) => item.code === "orphan-workspace"));
  });

  it("does not call a worktree of the project's own repository an orphan", () => {
    // The case that made the rule necessary: bb's managed worktrees live in
    // bb's plugin data directory, nowhere near the checkout.
    const root = "/repos/app";
    const managed = "/Users/verger/.bb/plugins/environment-git-worktree/host-data/worktrees/thr_1/app";
    const remote = "https://github.com/euanguo/traffic-ledger.git";
    const result = inferRepos({
      environments: [
        environment({ id: "env_a", projectId: "proj", path: root }),
        environment({ id: "env_b", projectId: "proj", path: managed, isWorktree: true }),
      ],
      projects: new Map([["proj", project("proj", root)]]),
      facts: [
        facts({ path: root, realPath: root, commonDir: `${root}/.git`, remoteUrl: remote }),
        facts({
          path: managed,
          realPath: managed,
          isMainWorktree: false,
          isLinkedWorktree: true,
          commonDir: `${root}/.git`,
          remoteUrl: remote,
        }),
      ],
    });

    assert.equal(result.repos.length, 1);
    assert.ok(!result.diagnostics.some((item) => item.code === "orphan-workspace"));
  });

  it("keeps an environment with no path out of the tree entirely", () => {
    const result = inferRepos({
      environments: [
        environment({ id: "env_null", projectId: "proj", path: null as unknown as string }),
      ],
      projects: new Map(),
      facts: [],
    });

    assert.deepEqual(result.repos, []);
  });
});
