/**
 * Shared host git runner with consistent C locale, unquoted UTF-8 path output,
 * non-interactive credential failure, and SIGTERM -> SIGKILL termination.
 */
import { spawn, type ChildProcess } from "node:child_process";

export const GIT_KILL_GRACE_MS = 2_000;

export interface GitRunOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly captureStdout?: boolean;
}

export interface GitExecResult {
  readonly exitCode: number | null;
  readonly spawnErrorCode: string | null;
  readonly stdout: string;
  readonly stderr: string;
}

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

export function runGit(
  args: readonly string[],
  cwd: string,
  options: GitRunOptions = {},
): Promise<GitExecResult> {
  const captureStdout = options.captureStdout !== false;
  return new Promise((done) => {
    const child = spawn("git", ["-c", "core.quotePath=false", ...args], {
      cwd,
      stdio: ["ignore", captureStdout ? "pipe" : "ignore", "pipe"],
      env: {
        ...process.env,
        LC_ALL: "C",
        GIT_TERMINAL_PROMPT: "0",
      },
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const stopTermination = scheduleGitTermination(child, options);
    if (captureStdout && child.stdout !== null) {
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
    }
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      stopTermination();
      done({
        exitCode: null,
        spawnErrorCode: error.code ?? "UNKNOWN",
        stdout,
        stderr,
      });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      stopTermination();
      done({ exitCode: code, spawnErrorCode: null, stdout, stderr });
    });
  });
}
