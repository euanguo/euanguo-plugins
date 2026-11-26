/**
 * Host-side git and filesystem operations for Harbor's Multi-Repo Cockpit:
 * - Multi-repo status inspection (staged/unstaged/untracked/+N-M/ahead/behind/submodules)
 * - Read-only per-file unified diff preview (with lstat and size caps)
 * - Per-repo branch push
 * - Read-only reference symlinks (`linkFeatureReference` / safe symlink-only `unlinkFeatureReference`)
 * - Importing existing `.code-workspace` files
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  readlink,
  stat,
  symlink,
  unlink,
} from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import type {
  CockpitRepoRole,
  DiffFileEntry,
  DiffFileStatus,
  FeatureRepoGitStatus,
  RepoSubmoduleStatus,
} from "../lib/domain/feature-git.ts";
import {
  MAX_PATCH_BYTES,
  clampPatch,
  parseNumstat,
  parsePorcelainStatus,
  statusFromPorcelainXY,
  unquoteGitPath,
} from "./feature-git-parse.ts";
import { scheduleGitTermination } from "./git-worktree.ts";

const MAX_CODE_WORKSPACE_BYTES = 256 * 1024;
const MAX_DIFF_FILES = 100;
const STATUS_CONCURRENCY = 4;

interface GitExecResult {
  readonly exitCode: number | null;
  readonly spawnErrorCode: string | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runGit(
  args: readonly string[],
  cwd: string,
  timeoutMs = 30_000,
  signal?: AbortSignal,
): Promise<GitExecResult> {
  return new Promise((done) => {
    const child = spawn("git", [...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const stopTermination = scheduleGitTermination(child, {
      timeoutMs,
      signal,
    });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
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

async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const run = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const idx = nextIndex;
      nextIndex += 1;
      const item = items[idx];
      if (item === undefined) continue;
      results[idx] = await worker(item);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => run()),
  );
  return results;
}

async function resolveCompareBase(
  repoPath: string,
  requestedBase: string | null | undefined,
  signal?: AbortSignal,
): Promise<string | null> {
  if (typeof requestedBase === "string" && requestedBase.trim().length > 0) {
    const trimmedBase = requestedBase.trim();
    const verified = await runGit(
      ["rev-parse", "--verify", "--quiet", trimmedBase],
      repoPath,
      10_000,
      signal,
    );
    if (verified.exitCode === 0) return trimmedBase;
  }
  const upstream = await runGit(
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    repoPath,
    10_000,
    signal,
  );
  if (upstream.exitCode === 0 && upstream.stdout.trim().length > 0) {
    return upstream.stdout.trim();
  }
  const candidates: string[] = [];
  const originHead = await runGit(
    ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
    repoPath,
    10_000,
    signal,
  );
  if (originHead.exitCode === 0 && originHead.stdout.trim().length > 0) {
    candidates.push(originHead.stdout.trim());
  }
  candidates.push("origin/main", "origin/master", "main", "master");
  for (const ref of candidates) {
    const verify = await runGit(
      ["rev-parse", "--verify", "--quiet", ref],
      repoPath,
      10_000,
      signal,
    );
    if (verify.exitCode === 0) return ref;
  }
  return null;
}

async function countUntrackedLines(
  repoPath: string,
  paths: readonly string[],
): Promise<number> {
  let total = 0;
  for (const relPath of paths.slice(0, 60)) {
    const abs = join(repoPath, relPath);
    try {
      const info = await lstat(abs);
      if (!info.isFile() || info.size > MAX_PATCH_BYTES) continue;
      const buf = await readFile(abs);
      if (buf.includes(0)) continue;
      const text = buf.toString("utf8");
      if (text.length === 0) continue;
      total += text.split(/\r?\n/u).length - (text.endsWith("\n") ? 1 : 0);
    } catch {
      // Skip unreadable paths.
    }
  }
  return total;
}

async function readSubmodules(
  repoPath: string,
  signal?: AbortSignal,
): Promise<readonly RepoSubmoduleStatus[]> {
  if (!existsSync(join(repoPath, ".gitmodules"))) return [];
  const res = await runGit(["submodule", "status"], repoPath, 15_000, signal);
  if (res.exitCode !== 0) return [];
  const items: RepoSubmoduleStatus[] = [];
  for (const line of res.stdout.split(/\r?\n/u)) {
    if (line.length < 2) continue;
    const marker = line[0] ?? " ";
    const match = line.slice(1).trim().match(/^([0-9a-f]+)\s+([^\s]+)(?:\s+\((.+)\))?$/iu);
    if (match === null) continue;
    const commit = match[1] ?? null;
    const subPath = match[2] ?? "";
    if (subPath.length === 0) continue;
    const name = subPath.split("/").pop() ?? subPath;
    items.push({
      path: subPath,
      name,
      dirty: marker === "+" || marker === "U",
      commit: commit ? commit.slice(0, 8) : null,
    });
  }
  return items;
}

async function inspectOneRepo(input: {
  readonly directory: string;
  readonly repository: string;
  readonly role: CockpitRepoRole;
  readonly path: string;
  readonly baseBranch?: string | null;
  readonly signal?: AbortSignal;
}): Promise<FeatureRepoGitStatus> {
  if (!existsSync(input.path)) {
    return {
      directory: input.directory,
      repository: input.repository,
      role: input.role,
      path: input.path,
      branch: null,
      upstream: null,
      exists: false,
      stagedFiles: 0,
      unstagedFiles: 0,
      untrackedFiles: 0,
      changedFiles: 0,
      additions: 0,
      deletions: 0,
      aheadCommits: null,
      behindCommits: null,
      clean: true,
      lastCommitSubject: null,
      submodules: [],
    };
  }

  const statusRes = await runGit(
    ["status", "--porcelain=v1", "--untracked-files=all", "-b"],
    input.path,
    20_000,
    input.signal,
  );
  if (statusRes.exitCode !== 0) {
    return {
      directory: input.directory,
      repository: input.repository,
      role: input.role,
      path: input.path,
      branch: null,
      upstream: null,
      exists: true,
      stagedFiles: 0,
      unstagedFiles: 0,
      untrackedFiles: 0,
      changedFiles: 0,
      additions: 0,
      deletions: 0,
      aheadCommits: null,
      behindCommits: null,
      clean: false,
      statusError: statusRes.stderr.trim() || "git status failed.",
      lastCommitSubject: null,
      submodules: [],
    };
  }

  const parsedStatus = parsePorcelainStatus(statusRes.stdout);
  const headCheck = await runGit(
    ["rev-parse", "--verify", "--quiet", "HEAD"],
    input.path,
    10_000,
    input.signal,
  );
  const hasHead = headCheck.exitCode === 0;

  const [numstatRes, lastSubjectRes, baseRef, submodules, untrackedLines] =
    await Promise.all([
      hasHead
        ? runGit(["diff", "--numstat", "HEAD"], input.path, 20_000, input.signal)
        : runGit(["diff", "--numstat", "--cached"], input.path, 20_000, input.signal),
      hasHead
        ? runGit(["log", "-1", "--format=%s"], input.path, 10_000, input.signal)
        : Promise.resolve({
            exitCode: 1,
            spawnErrorCode: null,
            stdout: "",
            stderr: "",
          }),
      hasHead
        ? resolveCompareBase(input.path, input.baseBranch, input.signal)
        : Promise.resolve(null),
      readSubmodules(input.path, input.signal),
      countUntrackedLines(input.path, parsedStatus.untrackedPaths),
    ]);

  const parsedDiff =
    numstatRes.exitCode === 0
      ? parseNumstat(numstatRes.stdout)
      : { additions: 0, deletions: 0, byPath: new Map() };

  let aheadCommits: number | null = null;
  let behindCommits: number | null = null;
  if (hasHead && baseRef !== null) {
    const counts = await runGit(
      ["rev-list", "--left-right", "--count", `${baseRef}...HEAD`],
      input.path,
      15_000,
      input.signal,
    );
    if (counts.exitCode === 0) {
      const parts = counts.stdout.trim().split(/\s+/u);
      behindCommits = Number.parseInt(parts[0] ?? "", 10);
      aheadCommits = Number.parseInt(parts[1] ?? "", 10);
      if (Number.isNaN(behindCommits)) behindCommits = null;
      if (Number.isNaN(aheadCommits)) aheadCommits = null;
    }
  } else if (hasHead) {
    const aheadRes = await runGit(
      ["rev-list", "--count", "HEAD", "--not", "--remotes"],
      input.path,
      15_000,
      input.signal,
    );
    if (aheadRes.exitCode === 0) {
      const parsedAhead = Number.parseInt(aheadRes.stdout.trim(), 10);
      aheadCommits = Number.isNaN(parsedAhead) ? null : parsedAhead;
    }
  }

  return {
    directory: input.directory,
    repository: input.repository,
    role: input.role,
    path: input.path,
    branch: parsedStatus.branch,
    upstream: parsedStatus.upstream,
    exists: true,
    stagedFiles: parsedStatus.stagedFiles,
    unstagedFiles: parsedStatus.unstagedFiles,
    untrackedFiles: parsedStatus.untrackedFiles,
    changedFiles: parsedStatus.changedFiles,
    additions: parsedDiff.additions + untrackedLines,
    deletions: parsedDiff.deletions,
    aheadCommits,
    behindCommits,
    clean: parsedStatus.changedFiles === 0 && parsedStatus.untrackedFiles === 0,
    lastCommitSubject:
      lastSubjectRes.exitCode === 0
        ? lastSubjectRes.stdout.trim() || null
        : null,
    submodules,
  };
}

export async function inspectFeatureGitStatus(input: {
  readonly repos: readonly {
    readonly directory: string;
    readonly repository: string;
    readonly role: CockpitRepoRole;
    readonly path: string;
  }[];
  readonly baseBranch?: string | null;
  readonly signal?: AbortSignal;
}): Promise<readonly FeatureRepoGitStatus[]> {
  return mapPool(input.repos, STATUS_CONCURRENCY, (repo) =>
    inspectOneRepo({
      ...repo,
      baseBranch: input.baseBranch,
      signal: input.signal,
    }),
  );
}

async function readUntrackedDiffEntry(
  repoPath: string,
  relPath: string,
  signal?: AbortSignal,
): Promise<{ patch: string; additions: number; truncated: boolean }> {
  try {
    const abs = join(repoPath, relPath);
    const info = await lstat(abs);
    if (!info.isFile()) return { patch: "", additions: 0, truncated: false };
    if (info.size > MAX_PATCH_BYTES) {
      return { patch: "", additions: 0, truncated: true };
    }
    const diffRes = await runGit(
      ["diff", "--no-index", "--no-ext-diff", "--", "/dev/null", relPath],
      repoPath,
      20_000,
      signal,
    );
    if (diffRes.exitCode !== 0 && diffRes.exitCode !== 1) {
      return { patch: "", additions: 0, truncated: false };
    }
    const additions = await countUntrackedLines(repoPath, [relPath]);
    const clamped = clampPatch(diffRes.stdout);
    return {
      patch: clamped.patch,
      additions,
      truncated: clamped.truncated,
    };
  } catch {
    return { patch: "", additions: 0, truncated: false };
  }
}

export async function readRepoDiff(input: {
  readonly path: string;
  readonly filePath?: string | null;
  readonly includeUntracked?: boolean;
  readonly signal?: AbortSignal;
}): Promise<{
  readonly status: "ok" | "failed";
  readonly message: string | null;
  readonly branch: string | null;
  readonly files: readonly DiffFileEntry[];
}> {
  if (!existsSync(input.path)) {
    return {
      status: "failed",
      message: `Directory does not exist: ${input.path}`,
      branch: null,
      files: [],
    };
  }
  const statusRes = await runGit(
    ["status", "--porcelain=v1", "-uall", "-b"],
    input.path,
    20_000,
    input.signal,
  );
  if (statusRes.exitCode !== 0) {
    return {
      status: "failed",
      message: statusRes.stderr.trim() || "Could not read git status.",
      branch: null,
      files: [],
    };
  }

  const parsedStatus = parsePorcelainStatus(statusRes.stdout);
  const headCheck = await runGit(
    ["rev-parse", "--verify", "--quiet", "HEAD"],
    input.path,
    10_000,
    input.signal,
  );
  const hasHead = headCheck.exitCode === 0;
  const numstatRes = hasHead
    ? await runGit(["diff", "--numstat", "HEAD"], input.path, 20_000, input.signal)
    : await runGit(["diff", "--numstat", "--cached"], input.path, 20_000, input.signal);
  const numstat =
    numstatRes.exitCode === 0 ? parseNumstat(numstatRes.stdout).byPath : new Map();

  const includeUntracked = input.includeUntracked !== false;
  const entries: {
    filePath: string;
    status: DiffFileStatus;
    staged: boolean;
  }[] = [];
  for (const line of statusRes.stdout.split(/\r?\n/u)) {
    if (line.length < 3 || line.startsWith("## ")) continue;
    const x = line[0] ?? " ";
    const y = line[1] ?? " ";
    const rel = unquoteGitPath(line.slice(3));
    if (rel.length === 0) continue;
    const status = statusFromPorcelainXY(x, y);
    if (status === "untracked" && !includeUntracked) continue;
    if (typeof input.filePath === "string" && input.filePath.length > 0 && rel !== input.filePath) {
      continue;
    }
    entries.push({
      filePath: rel,
      status,
      staged: x !== " " && x !== "?",
    });
    if (entries.length >= MAX_DIFF_FILES) break;
  }

  const files: DiffFileEntry[] = await mapPool(
    entries,
    STATUS_CONCURRENCY,
    async (entry): Promise<DiffFileEntry> => {
      if (entry.status === "untracked") {
        const untracked = await readUntrackedDiffEntry(
          input.path,
          entry.filePath,
          input.signal,
        );
        return {
          filePath: entry.filePath,
          status: entry.status,
          staged: false,
          additions: untracked.additions,
          deletions: 0,
          patch: untracked.patch,
          truncated: untracked.truncated,
        };
      }
      const counts = numstat.get(entry.filePath) ?? { additions: 0, deletions: 0 };
      const diffArgs = hasHead
        ? ["diff", "HEAD", "--", entry.filePath]
        : ["diff", "--cached", "--", entry.filePath];
      const patchRes = await runGit(diffArgs, input.path, 20_000, input.signal);
      const clamped =
        patchRes.exitCode === 0
          ? clampPatch(patchRes.stdout)
          : { patch: "", truncated: false };
      return {
        filePath: entry.filePath,
        status: entry.status,
        staged: entry.staged,
        additions: counts.additions,
        deletions: counts.deletions,
        patch: clamped.patch,
        truncated: clamped.truncated,
      };
    },
  );

  return {
    status: "ok",
    message: null,
    branch: parsedStatus.branch,
    files,
  };
}

export async function pushRepoBranch(input: {
  readonly path: string;
  readonly signal?: AbortSignal;
}): Promise<
  | { readonly status: "pushed"; readonly branch: string | null }
  | { readonly status: "failed"; readonly message: string }
> {
  if (!existsSync(input.path)) {
    return { status: "failed", message: `Directory does not exist: ${input.path}` };
  }
  const branchRes = await runGit(
    ["rev-parse", "--abbrev-ref", "HEAD"],
    input.path,
    10_000,
    input.signal,
  );
  const branch =
    branchRes.exitCode === 0 && branchRes.stdout.trim() !== "HEAD"
      ? branchRes.stdout.trim()
      : null;
  const pushRes = await runGit(
    ["push", "-u", "origin", "HEAD"],
    input.path,
    60_000,
    input.signal,
  );
  if (pushRes.exitCode !== 0) {
    return {
      status: "failed",
      message: pushRes.stderr.trim() || "git push failed.",
    };
  }
  return { status: "pushed", branch };
}

function safeChildDirectory(directory: string): boolean {
  return (
    directory.length > 0 &&
    directory !== "." &&
    directory !== ".." &&
    !directory.includes("/") &&
    !directory.includes("\\")
  );
}

export async function linkFeatureReference(input: {
  readonly featureDirectory: string;
  readonly directory: string;
  readonly sourcePath: string;
}): Promise<{ status: "ok"; readonly path: string } | { status: "failed"; readonly message: string }> {
  if (!isAbsolute(input.featureDirectory) || !isAbsolute(input.sourcePath)) {
    return { status: "failed", message: "Feature and reference paths must be absolute." };
  }
  if (!safeChildDirectory(input.directory)) {
    return { status: "failed", message: `Invalid folder name: ${input.directory}` };
  }
  try {
    const targetInfo = await stat(input.sourcePath);
    if (!targetInfo.isDirectory()) {
      return { status: "failed", message: `${input.sourcePath} is not a directory.` };
    }
    await mkdir(input.featureDirectory, { recursive: true });
    const linkPath = join(input.featureDirectory, input.directory);
    if (existsSync(linkPath)) {
      const linkStats = await lstat(linkPath);
      if (linkStats.isSymbolicLink()) {
        const currentTarget = resolve(
          input.featureDirectory,
          await readlink(linkPath),
        );
        if (resolve(input.sourcePath) === currentTarget) {
          return { status: "ok", path: linkPath };
        }
      }
      return {
        status: "failed",
        message: `${linkPath} already exists in this feature folder.`,
      };
    }
    await symlink(input.sourcePath, linkPath, "dir");
    return { status: "ok", path: linkPath };
  } catch (error) {
    return {
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function unlinkFeatureReference(input: {
  readonly featureDirectory: string;
  readonly directory: string;
}): Promise<{ status: "removed" | "missing" | "failed"; readonly message?: string }> {
  if (!isAbsolute(input.featureDirectory) || !safeChildDirectory(input.directory)) {
    return { status: "failed", message: "Invalid reference path." };
  }
  const linkPath = join(input.featureDirectory, input.directory);
  try {
    const info = await lstat(linkPath);
    if (!info.isSymbolicLink()) {
      return {
        status: "failed",
        message: `${linkPath} is a real directory, not a reference symlink.`,
      };
    }
    await unlink(linkPath);
    return { status: "removed" };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") return { status: "missing" };
    return {
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function readCodeWorkspaceFile(input: {
  readonly path: string;
}): Promise<
  | { readonly status: "ok"; readonly content: string }
  | { readonly status: "failed"; readonly message: string }
> {
  if (!isAbsolute(input.path)) {
    return { status: "failed", message: "Path must be absolute." };
  }
  if (!input.path.toLowerCase().endsWith(".code-workspace")) {
    return {
      status: "failed",
      message: "Only .code-workspace files can be imported.",
    };
  }
  try {
    const info = await lstat(input.path);
    if (!info.isFile()) {
      return {
        status: "failed",
        message: "Not a regular .code-workspace file.",
      };
    }
    if (info.size > MAX_CODE_WORKSPACE_BYTES) {
      return {
        status: "failed",
        message: `.code-workspace file exceeds the ${MAX_CODE_WORKSPACE_BYTES}-byte limit.`,
      };
    }
    return { status: "ok", content: await readFile(input.path, "utf8") };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    return {
      status: "failed",
      message:
        code === "ENOENT"
          ? "Workspace file does not exist."
          : "Could not read workspace file.",
    };
  }
}
