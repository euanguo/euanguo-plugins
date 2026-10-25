import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyGitAttempt } from "../host/git-worktree.ts";

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

  it("falls back on the main working tree, the second lock on that door", () => {
    const result = classifyGitAttempt({
      exitCode: 128,
      spawnErrorCode: null,
      stderr: "fatal: '/Users/example/Documents/Code/example-repo' is a main working tree\n",
    });
    assert.equal(result.status, "fallback");
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
});
