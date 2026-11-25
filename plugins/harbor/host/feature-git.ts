/**
 * Host-side git and filesystem operations for Harbor's Multi-Repo Cockpit:
 * - Multi-repo status inspection (staged/unstaged/untracked/+N-M/ahead/behind/submodules)
 * - Per-file unified diff inspection (including untracked file patch synthesis)
 * - Per-repo selective staging, committing, and pushing
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
import { scheduleGitTermination } from "./git-worktree.ts";

const MAX_PATCH_BYTES = 128 * 1024;
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
  const candidates: string[] = [];
  if (typeof requestedBase === "string" && requestedBase.trim().length > 0) {
    candidates.push(requestedBase.trim());
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

function parseBranchHeader(line: string): {
  branch: string | null;
  upstream: string | null;
} {
  if (!line.startsWith("## ")) return { branch: null, upstream: null };
  const body = line.slice(3).trim();
  if (body.startsWith("No commits yet on ")) {
    return {
      branch: body.slice("No commits yet on ".length).trim() || null,
      upstream: null,
    };
  }
  if (body.startsWith("HEAD (no branch)")) {
    return { branch: null, upstream: null };
  }
  const dotsIndex = body.indexOf("...");
  if (dotsIndex === -1) {
    return { branch: body.split(" ")[0] ?? null, upstream: null };
  }
  const branch = body.slice(0, dotsIndex).trim() || null;
  const tail = body.slice(dotsIndex + 3);
  const spaceIdx = tail.indexOf(" ");
  const upstream = (spaceIdx === -1 ? tail : tail.slice(0, spaceIdx)).trim() || null;
  return { branch, upstream };
}

function parsePorcelainStatus(stdout: string): {
  branch: string | null;
  upstream: string | null;
  stagedFiles: number;
  unstagedFiles: number;
  untrackedFiles: number;
  changedFiles: number;
  untrackedPaths: string[];
} {
  const lines = stdout.split(/\r?\n/u).filter((line) => line.length > 0);
  let branch: string | null = null;
  let upstream: string | null = null;
  let stagedFiles = 0;
  let unstagedFiles = 0;
  let untrackedFiles = 0;
  let changedFiles = 0;
  const untrackedPaths: string[] = [];

  for (const line of lines) {
    if (line.startsWith("## ")) {
      const parsed = parseBranchHeader(line);
      branch = parsed.branch;
      upstream = parsed.upstream;
      continue;
    }
    if (line.startsWith("?? ")) {
      untrackedFiles += 1;
      untrackedPaths.push(line.slice(3));
      continue;
    }
    if (line.length < 3) continue;
    changedFiles += 1;
    const x = line[0] ?? " ";
    const y = line[1] ?? " ";
    if (x !== " " && x !== "?") stagedFiles += 1;
    if (y !== " " && y !== "?") unstagedFiles += 1;
  }

  return {
    branch,
    upstream,
    stagedFiles,
    unstagedFiles,
    untrackedFiles,
    changedFiles,
    untrackedPaths,
  };
}

function parseNumstat(stdout: string): {
  additions: number;
  deletions: number;
  byPath: Map<string, { additions: number; deletions: number }>;
} {
  let additions = 0;
  let deletions = 0;
  const byPath = new Map<string, { additions: number; deletions: number }>();
  for (const line of stdout.split(/\r?\n/u)) {
    if (line.trim().length === 0) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const rawAdd = parts[0];
    const rawDel = parts[1];
    const filePath = parts.slice(2).join("\t");
    const add = rawAdd === "-" ? 0 : Number.parseInt(rawAdd ?? "0", 10) || 0;
    const del = rawDel === "-" ? 0 : Number.parseInt(rawDel ?? "0", 10) || 0;
    additions += add;
    deletions += del;
    byPath.set(filePath, { additions: add, deletions: del });
  }
  return { additions, deletions, byPath };
}

async function countUntrackedLines(
  repoPath: string,
  paths: readonly string[],
): Promise<number> {
  let total = 0;
  for (const relPath of paths.slice(0, 60)) {
    const abs = join(repoPath, relPath);
    try {
      const info = await stat(abs);
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
      clean: true,
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

function statusFromPorcelainXY(x: string, y: string): DiffFileStatus {
  if (x === "?" && y === "?") return "untracked";
  if (x === "A" || y === "A") return "added";
  if (x === "D" || y === "D") return "deleted";
  if (x === "R" || y === "R") return "renamed";
  return "modified";
}

function unquoteGitPath(raw: string): string {
  const arrowIndex = raw.indexOf(" -> ");
  const target = arrowIndex === -1 ? raw : raw.slice(arrowIndex + 4);
  if (target.startsWith('"') && target.endsWith('"')) {
    return target.slice(1, -1).replace(/\\(["\\])/gu, "$1");
  }
  return target;
}

function clampPatch(raw: string): { patch: string; truncated: boolean } {
  if (Buffer.byteLength(raw, "utf8") <= MAX_PATCH_BYTES) {
    return { patch: raw, truncated: false };
  }
  const sliced = Buffer.from(raw, "utf8")
    .subarray(0, MAX_PATCH_BYTES)
    .toString("utf8");
  const lastNewline = sliced.lastIndexOf("\n");
  return {
    patch: lastNewline > 0 ? sliced.slice(0, lastNewline) : sliced,
    truncated: true,
  };
}

async function synthesizeUntrackedPatch(
  repoPath: string,
  relPath: string,
): Promise<{ patch: string; additions: number; truncated: boolean }> {
  try {
    const abs = join(repoPath, relPath);
    const info = await stat(abs);
    if (!info.isFile()) return { patch: "", additions: 0, truncated: false };
    const buf = await readFile(abs);
    if (buf.includes(0)) {
      return {
        patch: `diff --git a/${relPath} b/${relPath}\nnew file mode 100644\nBinary files /dev/null and b/${relPath} differ\n`,
        additions: 0,
        truncated: false,
      };
    }
    const raw = buf.toString("utf8");
    const lines = raw.length === 0 ? [] : raw.replace(/\r\n/gu, "\n").split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    if (lines.length === 0) {
      return { patch: "", additions: 0, truncated: false };
    }
    const header = [
      `diff --git a/${relPath} b/${relPath}`,
      "new file mode 100644",
      "--- /dev/null",
      `+++ b/${relPath}`,
      `@@ -0,0 +1,${lines.length} @@`,
    ];
    const body = lines.map((line) => `+${line}`);
    const full = `${[...header, ...body].join("\n")}\n`;
    const clamped = clampPatch(full);
    return {
      patch: clamped.patch,
      additions: lines.length,
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
        const untracked = await synthesizeUntrackedPatch(input.path, entry.filePath);
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

export async function stageAndCommitRepo(input: {
  readonly path: string;
  readonly message: string;
  readonly files?: readonly string[] | null;
  readonly push?: boolean;
  readonly signal?: AbortSignal;
}): Promise<
  | {
      readonly status: "committed";
      readonly sha: string | null;
      readonly branch: string | null;
      readonly pushed: boolean;
      readonly pushError: string | null;
    }
  | { readonly status: "failed"; readonly message: string }
> {
  const trimmed = input.message.trim();
  if (trimmed.length === 0) {
    return { status: "failed", message: "Commit message cannot be empty." };
  }
  if (!existsSync(input.path)) {
    return { status: "failed", message: `Directory does not exist: ${input.path}` };
  }
  const addArgs =
    input.files !== undefined && input.files !== null && input.files.length > 0
      ? ["add", "--", ...input.files]
      : ["add", "-A"];
  const added = await runGit(addArgs, input.path, 30_000, input.signal);
  if (added.exitCode !== 0) {
    return {
      status: "failed",
      message: added.stderr.trim() || "git add failed.",
    };
  }
  const committed = await runGit(
    ["commit", "-m", trimmed],
    input.path,
    30_000,
    input.signal,
  );
  if (committed.exitCode !== 0) {
    return {
      status: "failed",
      message:
        committed.stderr.trim() ||
        committed.stdout.trim() ||
        "git commit failed.",
    };
  }
  const [shaRes, branchRes] = await Promise.all([
    runGit(["rev-parse", "--short", "HEAD"], input.path, 10_000, input.signal),
    runGit(["rev-parse", "--abbrev-ref", "HEAD"], input.path, 10_000, input.signal),
  ]);
  const sha = shaRes.exitCode === 0 ? shaRes.stdout.trim() || null : null;
  const branch =
    branchRes.exitCode === 0 && branchRes.stdout.trim() !== "HEAD"
      ? branchRes.stdout.trim()
      : null;

  let pushed = false;
  let pushError: string | null = null;
  if (input.push === true) {
    const pushRes = await pushRepoBranch({ path: input.path, signal: input.signal });
    if (pushRes.status === "pushed") pushed = true;
    else pushError = pushRes.message;
  }

  return { status: "committed", sha, branch, pushed, pushError };
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
  try {
    const info = await stat(input.path);
    if (!info.isFile()) {
      return { status: "failed", message: `${input.path} is not a file.` };
    }
    if (info.size > MAX_CODE_WORKSPACE_BYTES) {
      return {
        status: "failed",
        message: `.code-workspace file exceeds the ${MAX_CODE_WORKSPACE_BYTES}-byte limit.`,
      };
    }
    return { status: "ok", content: await readFile(input.path, "utf8") };
  } catch (error) {
    return {
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
