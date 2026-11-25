import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { classifyGitAttempt, removeGitWorktree } from "../host/git-worktree.ts";

/**
 * The strings are the ones git 2.x actually printed when this was written;
 * `git worktree remove` reports every refusal as a `fatal:` line with a zero
 * exit code, so the text is the only thing that distinguishes "git will not do
 * this, delete it plainly" from "this failed".
 */
describe("classifying a git worktree removal", () => {
  it("takes a clean exit as done", () => {
    assert.deepEqual(
      classifyGitAttempt({ exitCode: 0, spawnErrorCode: null, stderr: "" }),
      { status: "removed" },
    );
  });

  it("falls back when the directory was never a worktree of that repository", () => {
    const result = classifyGitAttempt({
      exitCode: 128,
      spawnErrorCode: null,
      stderr: "fatal: '/tmp/definitely-not-a-worktree' is not a working tree\n",
    });
    assert.deepEqual(result, {
      status: "fallback",
      reason: "fatal: '/tmp/definitely-not-a-worktree' is not a working tree",
    });
  });

  it("falls back when the repository cannot be read", () => {
    assert.deepEqual(
      classifyGitAttempt({
        exitCode: 128,
        spawnErrorCode: null,
        stderr:
          "fatal: not a git repository (or any of the parent directories): .git\n",
      }),
      {
        status: "fallback",
        reason:
          "fatal: not a git repository (or any of the parent directories): .git",
      },
    );
  });

  it("refuses the main working tree without allowing a plain delete", () => {
    const result = classifyGitAttempt({
      exitCode: 128,
      spawnErrorCode: null,
      stderr: "fatal: '/Users/example/Documents/Code/example-repo' is a main working tree\n",
    });
    assert.deepEqual(result, {
      status: "refused",
      reason:
        "fatal: '/Users/example/Documents/Code/example-repo' is a main working tree",
    });
  });

  it("falls back when git is not installed", () => {
    assert.deepEqual(
      classifyGitAttempt({ exitCode: null, spawnErrorCode: "ENOENT", stderr: "" }),
      { status: "fallback", reason: "git is not installed on this machine" },
    );
  });

  it("fails, rather than deleting plainly, on an error it cannot explain", () => {
    const result = classifyGitAttempt({
      exitCode: 128,
      spawnErrorCode: null,
      stderr: "fatal: unable to create '.git/index.lock': Permission denied\n",
    });
    assert.equal(result.status, "failed");
    assert.match(
      result.status === "failed" ? result.message : "",
      /Permission denied/,
    );
  });

  it("fails, rather than deleting plainly, when git could not be run at all", () => {
    assert.deepEqual(
      classifyGitAttempt({ exitCode: null, spawnErrorCode: "EACCES", stderr: "" }),
      { status: "failed", message: "could not run git (EACCES)" },
    );
  });

  it("still says something when git exits without a word", () => {
    assert.deepEqual(
      classifyGitAttempt({ exitCode: 3, spawnErrorCode: null, stderr: "   " }),
      { status: "failed", message: "git exited 3" },
    );
  });

  it("terminates a git command that ignores its deadline", async () => {
    const bin = await mkdtemp(join(tmpdir(), "harbor-fake-git-"));
    const script = "#!/usr/bin/env node\nsetInterval(() => {}, 1_000);\n";
    await writeFile(join(bin, "git"), script, { mode: 0o755 });
    const oldPath = process.env.PATH;
    process.env.PATH = `${bin}:${oldPath ?? ""}`;

    try {
      const started = Date.now();
      const result = await removeGitWorktree({
        path: "/tmp/example-worktree",
        mainRepoPath: bin,
        timeoutMs: 50,
      });
      assert.equal(result.status, "failed");
      assert.ok(Date.now() - started < 1_000, "the timed-out command resolved promptly");
    } finally {
      process.env.PATH = oldPath;
      await rm(bin, { recursive: true, force: true });
    }
  });
});
