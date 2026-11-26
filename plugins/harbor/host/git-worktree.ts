import { runGit } from "./git.ts";

export type RemoveWorktreeResult =
  | { status: "removed" }
  | { status: "refused"; reason: string }
  | { status: "fallback"; reason: string }
  | { status: "failed"; message: string };

/** One git invocation, flattened to what the decision below needs. */
export interface GitAttempt {
  readonly exitCode: number | null;
  /** The spawn failure's `code`, when git never ran at all. */
  readonly spawnErrorCode: string | null;
  readonly stderr: string;
}

/**
 * The messages that mean "git will not do this" rather than "this failed".
 *
 * A directory that was never registered as a worktree of that repository, and a
 * repository git cannot read, both leave a plain delete as the only option. A
 * main working tree is a separate refusal: the plugin already refuses to offer
 * the project's own checkout, and this is the second lock on the same door. The
 * server must not treat it as a plain-delete fallback.
 *
 * These are matched by text because git has no exit code for them — verified
 * against git 2.x, which prints "fatal: '<path>' is not a working tree",
 * "fatal: not a git repository (or any of the parent directories): .git", and
 * "fatal: '<path>' is a main working tree".
 */
const NOT_A_WORKTREE = [
  "is not a working tree",
  "is a main working tree",
  "not a git repository",
  "not a git work tree",
];

export function classifyGitAttempt(attempt: GitAttempt): RemoveWorktreeResult {
  if (attempt.spawnErrorCode !== null) {
    return attempt.spawnErrorCode === "ENOENT"
      ? { status: "fallback", reason: "git is not installed on this machine" }
      : { status: "failed", message: `could not run git (${attempt.spawnErrorCode})` };
  }
  if (attempt.exitCode === 0) return { status: "removed" };

  const stderr = attempt.stderr.trim();
  const message =
    stderr.length > 0 ? stderr : `git exited ${attempt.exitCode ?? "without a status"}`;
  if (message.includes("is a main working tree")) {
    return { status: "refused", reason: message };
  }
  return NOT_A_WORKTREE.some((needle) => message.includes(needle))
    ? { status: "fallback", reason: message }
    : { status: "failed", message };
}

export async function removeGitWorktree(args: {
  path: string;
  mainRepoPath: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<RemoveWorktreeResult> {
  return classifyGitAttempt(
    await runGit(
      ["worktree", "remove", "--force", "--", args.path],
      args.mainRepoPath,
      {
        captureStdout: false,
        timeoutMs: args.timeoutMs ?? 120_000,
        signal: args.signal,
      },
    ),
  );
}
