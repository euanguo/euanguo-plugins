import { spawn, type ChildProcess } from "node:child_process";

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

export interface GitRunOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

/** How long git has to honour SIGTERM before the policy escalates to SIGKILL. */
export const GIT_KILL_GRACE_MS = 2_000;

/**
 * Stop a git process, then stop it harder if it ignores the first signal.
 *
 * The returned function removes every timer and abort listener; the caller
 * calls it when the process has closed or failed to spawn.
 */
export function scheduleGitTermination(
  child: ChildProcess,
  options: GitRunOptions,
): () => void {
  let termTimer: NodeJS.Timeout | undefined;
  let killTimer: NodeJS.Timeout | undefined;
  let terminated = false;

  const terminate = () => {
    if (
      terminated ||
      child.exitCode !== null ||
      child.signalCode !== null
    ) {
      return;
    }
    terminated = true;
    child.kill("SIGTERM");
    killTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }, GIT_KILL_GRACE_MS);
  };

  const clear = () => {
    clearTimeout(termTimer);
    clearTimeout(killTimer);
    options.signal?.removeEventListener("abort", terminate);
  };

  if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
    termTimer = setTimeout(terminate, options.timeoutMs);
  }
  if (options.signal !== undefined) {
    if (options.signal.aborted) terminate();
    else options.signal.addEventListener("abort", terminate, { once: true });
  }

  return clear;
}

function runGit(
  args: readonly string[],
  cwd: string,
  options: GitRunOptions = {},
): Promise<GitAttempt> {
  return new Promise((resolve) => {
    const child = spawn("git", [...args], {
      cwd,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    let settled = false;
    const stopTermination = scheduleGitTermination(child, options);
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      stopTermination();
      resolve({ exitCode: null, spawnErrorCode: error.code ?? "UNKNOWN", stderr });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      stopTermination();
      resolve({ exitCode: code, spawnErrorCode: null, stderr });
    });
  });
}

/**
 * `git worktree remove` rather than a recursive delete, because git owns a
 * record of the worktree inside the main repository and takes it away with the
 * directory. `--force` is deliberate: the caller has already asked the user what
 * to do about uncommitted work, and git's own refusal would only be a second,
 * dumber copy of that question.
 */
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
      { timeoutMs: args.timeoutMs ?? 120_000, signal: args.signal },
    ),
  );
}
