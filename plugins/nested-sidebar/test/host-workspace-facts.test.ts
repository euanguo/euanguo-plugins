import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parseCommonDir,
  parseGitDirFile,
  parseHead,
  parseRemoteUrl,
  resolveWorkspaceFacts,
} from "../host/workspace-facts.ts";

const created: string[] = [];

async function fixture(): Promise<string> {
  // Resolved, because `os.tmpdir()` is itself a symlink on macOS: `/var` is
  // `/private/var`, and every expectation below is about what the filesystem
  // says a path is.
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "nest-facts-")));
  created.push(root);
  return root;
}

after(async () => {
  await Promise.all(created.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function write(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
}

describe("reading git's own bookkeeping", () => {
  it("takes the gitdir line out of a linked worktree's .git file", () => {
    assert.equal(
      parseGitDirFile("gitdir: /repos/app/.git/worktrees/wt1\n"),
      "/repos/app/.git/worktrees/wt1",
    );
    assert.equal(
      parseGitDirFile("gitdir: ../app/.git/worktrees/wt1"),
      "../app/.git/worktrees/wt1",
    );
  });

  it("answers null for a .git file that is not one", () => {
    assert.equal(parseGitDirFile(""), null);
    assert.equal(parseGitDirFile("something else\n"), null);
  });

  it("resolves commondir against the gitdir, not the worktree", () => {
    assert.equal(
      parseCommonDir("../..\n", "/repos/app/.git/worktrees/wt1"),
      "/repos/app/.git",
    );
    assert.equal(
      parseCommonDir("/absolute/.git\n", "/repos/app/.git/worktrees/wt1"),
      "/absolute/.git",
    );
    // An empty file is a gitdir that predates commondir; the layout is fixed.
    assert.equal(
      parseCommonDir("", "/repos/app/.git/worktrees/wt1"),
      "/repos/app/.git",
    );
  });

  it("reads a branch out of HEAD, and refuses to call a sha one", () => {
    assert.deepEqual(parseHead("ref: refs/heads/bb/thr_zhuy7b6wzp\n"), {
      branch: "bb/thr_zhuy7b6wzp",
      head: null,
    });
    assert.deepEqual(parseHead("ref: refs/heads/main"), {
      branch: "main",
      head: null,
    });
    assert.deepEqual(parseHead("cef4fc6a1b2c3d4e5f60718293a4b5c6d7e8f901\n"), {
      branch: null,
      head: "cef4fc6a1b2c3d4e5f60718293a4b5c6d7e8f901",
    });
    assert.deepEqual(parseHead(""), { branch: null, head: null });
  });

  it("prefers origin, and takes any remote when there is no origin", () => {
    const config = `[core]
\trepositoryformatversion = 0
[remote "upstream"]
\turl = https://github.com/euanguo/fork.git
[remote "origin"]
\turl = git@github.com:verger-guo/chaoshangtong.git
\tfetch = +refs/heads/*:refs/remotes/origin/*
`;
    assert.equal(parseRemoteUrl(config), "git@github.com:verger-guo/chaoshangtong.git");
    assert.equal(
      parseRemoteUrl('[remote "upstream"]\n\turl = https://github.com/euanguo/fork.git\n'),
      "https://github.com/euanguo/fork.git",
    );
    assert.equal(parseRemoteUrl("[core]\n\tbare = false\n"), null);
    // A `url` outside a remote section is not a remote's.
    assert.equal(parseRemoteUrl("[submodule \"x\"]\n\turl = /elsewhere\n"), null);
  });
});

describe("observing a directory on disk", () => {
  it("reads a main working tree, its remote and its linked worktrees", async () => {
    const root = await fixture();
    const main = path.join(root, "app");
    const linked = path.join(root, "app-wt");

    await write(path.join(main, ".git", "HEAD"), "ref: refs/heads/main\n");
    await write(
      path.join(main, ".git", "config"),
      '[remote "origin"]\n\turl = git@github.com:verger-guo/chaoshangtong.git\n',
    );
    // A linked worktree: `.git` is a file, and the repository records it under
    // its own `worktrees/` directory.
    await write(path.join(linked, ".git"), `gitdir: ${path.join(main, ".git", "worktrees", "wt1")}\n`);
    await write(path.join(main, ".git", "worktrees", "wt1", "gitdir"), `${path.join(linked, ".git")}\n`);
    await write(path.join(main, ".git", "worktrees", "wt1", "commondir"), "../..\n");
    await write(path.join(main, ".git", "worktrees", "wt1", "HEAD"), "ref: refs/heads/bb/thr_1\n");
    // One the repository records and the directory is gone from.
    await write(path.join(main, ".git", "worktrees", "gone", "gitdir"), `${path.join(root, "deleted", ".git")}\n`);
    await write(path.join(main, ".git", "worktrees", "gone", "commondir"), "../..\n");
    await write(path.join(main, ".git", "worktrees", "gone", "HEAD"), "abc1234\n");

    const [mainFact, linkedFact] = await resolveWorkspaceFacts([main, linked]);

    assert.equal(mainFact.isMainWorktree, true);
    assert.equal(mainFact.isLinkedWorktree, false);
    assert.equal(mainFact.commonDir, path.join(main, ".git"));
    assert.equal(mainFact.remoteUrl, "git@github.com:verger-guo/chaoshangtong.git");
    assert.deepEqual(
      mainFact.worktrees.map((worktree) => [path.basename(worktree.path), worktree.branch, worktree.prunable]),
      [
        ["app", "main", false],
        ["app-wt", "bb/thr_1", false],
        ["deleted", null, true],
      ],
    );

    assert.equal(linkedFact.isMainWorktree, false);
    assert.equal(linkedFact.isLinkedWorktree, true);
    assert.equal(linkedFact.commonDir, path.join(main, ".git"));
    assert.equal(linkedFact.remoteUrl, "git@github.com:verger-guo/chaoshangtong.git");
    // Both answer the same worktree list, because both are looking at one repo.
    assert.deepEqual(linkedFact.worktrees, mainFact.worktrees);
  });

  it("calls a plain directory a plain directory", async () => {
    const root = await fixture();
    const plain = path.join(root, "plain");
    await mkdir(plain, { recursive: true });

    const [fact] = await resolveWorkspaceFacts([plain]);
    assert.equal(fact.isDirectory, true);
    assert.equal(fact.isMainWorktree, false);
    assert.equal(fact.isLinkedWorktree, false);
    assert.equal(fact.commonDir, null);
    assert.equal(fact.remoteUrl, null);
    assert.deepEqual(fact.worktrees, []);
  });

  it("observes a submodule as its own repository, not a linked worktree", async () => {
    const root = await fixture();
    const parent = path.join(root, "parent");
    const submodule = path.join(parent, "src", "child");
    const gitdir = path.join(parent, ".git", "modules", "src", "child");

    await write(path.join(parent, ".git", "HEAD"), "ref: refs/heads/main\n");
    await write(
      path.join(parent, ".git", "config"),
      '[remote "origin"]\n\turl = git@example.com:parent.git\n',
    );
    await write(path.join(submodule, ".git"), `gitdir: ${gitdir}\n`);
    await write(path.join(gitdir, "HEAD"), "ref: refs/heads/child-main\n");
    await write(
      path.join(gitdir, "config"),
      '[remote "origin"]\n\turl = git@example.com:child.git\n',
    );

    const [fact] = await resolveWorkspaceFacts([submodule]);

    assert.equal(fact.isMainWorktree, false);
    assert.equal(fact.isLinkedWorktree, false);
    assert.equal(fact.isNestedRepository, true);
    assert.equal(fact.repositoryRoot, submodule);
    assert.equal(fact.commonDir, gitdir);
    assert.equal(fact.remoteUrl, "git@example.com:child.git");
    assert.deepEqual(
      fact.worktrees.map((worktree) => [worktree.path, worktree.branch]),
      [[submodule, "child-main"]],
    );
  });

  it("finds the checkout containing an ordinary subdirectory", async () => {
    const root = await fixture();
    const checkout = path.join(root, "app");
    const packageDir = path.join(checkout, "packages", "web");

    await write(path.join(checkout, ".git", "HEAD"), "ref: refs/heads/main\n");
    await write(
      path.join(checkout, ".git", "config"),
      '[remote "origin"]\n\turl = git@example.com:app.git\n',
    );
    await mkdir(packageDir, { recursive: true });

    const [fact] = await resolveWorkspaceFacts([packageDir]);

    assert.equal(fact.path, packageDir);
    assert.equal(fact.realPath, packageDir);
    assert.equal(fact.repositoryRoot, checkout);
    assert.equal(fact.commonDir, path.join(checkout, ".git"));
    assert.equal(fact.remoteUrl, "git@example.com:app.git");
    assert.equal(fact.isMainWorktree, false);
    assert.equal(fact.isLinkedWorktree, false);
  });

  it("answers a missing path as unobserved rather than as a directory", async () => {
    const root = await fixture();
    const [fact] = await resolveWorkspaceFacts([path.join(root, "nope")]);
    assert.equal(fact.realPath, null);
    assert.equal(fact.isDirectory, false);
    assert.equal(fact.commonDir, null);
  });

  it("resolves a symlinked path to the directory it names", async () => {
    const root = await fixture();
    const real = path.join(root, "real");
    const link = path.join(root, "link");
    await mkdir(real, { recursive: true });
    const { symlink } = await import("node:fs/promises");
    await symlink(real, link);

    const [fact] = await resolveWorkspaceFacts([link]);
    // The point of the whole layer: two spellings of one directory are one
    // workspace, and only the filesystem can say so.
    assert.equal(fact.realPath, real);
  });

  it("answers every path it was asked about, in order", async () => {
    const root = await fixture();
    const a = path.join(root, "a");
    const b = path.join(root, "b");
    await mkdir(a, { recursive: true });
    await mkdir(b, { recursive: true });

    const facts = await resolveWorkspaceFacts([a, b, a]);
    assert.deepEqual(facts.map((fact) => fact.path), [a, b]);
  });

  it("never rejects, even for a path that cannot be read", async () => {
    const facts = await resolveWorkspaceFacts(["/\0invalid", ""]);
    assert.equal(facts.length, 1);
    assert.equal(facts[0].isDirectory, false);
  });
});
