import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  copyFile,
  lstat,
  realpath,
  mkdir,
  readFile,
  readdir,
  rmdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import {
  AGENTS_FILE,
  CLAUDE_CONTENT,
  CLAUDE_FILE,
  FEATURE_OWN_FILES,
  LEGACY_CONTEXT_FILE,
  MANIFEST_FILE,
  mergeAgentsFile,
  renderManagedBlock,
  renderManifest,
  type ContextMember,
} from "../lib/feature-context.ts";

/**
 * The worktree operations a feature needs on the machine that owns the files.
 *
 * Every answer is a status rather than a throw. A branch that is already
 * checked out, a folder left behind by an interrupted run, and a source that is
 * not a repository are all ordinary outcomes a person can act on.
 */

/** The home directory of the machine a feature directory lives on. */
export function readHomeDirectory(): string {
  return homedir();
}

interface GitRun {
  readonly exitCode: number | null;
  readonly spawnErrorCode: string | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runGit(args: readonly string[], cwd: string, timeoutMs = 60_000): Promise<GitRun> {
  return new Promise((done) => {
    const child = spawn("git", [...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      // A fetch that would prompt for credentials must fail rather than hang
      // the host call until its timeout.
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      done({ exitCode: null, spawnErrorCode: error.code ?? "UNKNOWN", stdout, stderr });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ exitCode: code, spawnErrorCode: null, stdout, stderr });
    });
  });
}

/**
 * Create a feature's directory and refuse one that would sit inside a repository.
 *
 * A feature directory inside a repository is the failure this whole layout is
 * built to avoid: the enclosing repository would see every member worktree as
 * an embedded repository. So the check runs after the directory exists, against
 * the directory itself.
 */
export async function ensureFeatureDirectory(input: {
  readonly path: string;
}): Promise<{ status: "ok" } | { status: "failed"; message: string }> {
  if (!isAbsolute(input.path)) {
    return { status: "failed", message: `Not an absolute path: ${input.path}` };
  }
  try {
    await mkdir(input.path, { recursive: true });
  } catch (error) {
    return { status: "failed", message: messageOf(error) };
  }
  const inside = await runGit(["rev-parse", "--is-inside-work-tree"], input.path, 10_000);
  if (inside.exitCode === 0 && inside.stdout.trim() === "true") {
    return {
      status: "failed",
      message: `${input.path} is inside a git repository. A feature folder must not be.`,
    };
  }
  return { status: "ok" };
}

export interface ScannedMember {
  readonly directory: string;
  readonly path: string;
  readonly repository: string;
  readonly repositoryPath: string;
  readonly branch: string | null;
}

/**
 * Every worktree inside each feature directory, read from the files alone.
 *
 * No git process per child: a linked worktree's `.git` file names its gitdir,
 * whose `HEAD` names the branch and whose `commondir` leads back to the main
 * repository. That is three small reads, cheap enough to do on every sidebar
 * refresh, and it sees a worktree an agent created by hand the moment it exists.
 */
export async function scanFeatureDirectories(input: {
  readonly roots: readonly string[];
}): Promise<
  readonly { readonly root: string; readonly exists: boolean; readonly members: readonly ScannedMember[] }[]
> {
  return Promise.all(
    input.roots.map(async (root) => {
      let entries: string[];
      try {
        entries = await readdir(root);
      } catch {
        return { root, exists: false, members: [] };
      }
      const members: ScannedMember[] = [];
      for (const entry of entries.sort()) {
        if (entry.startsWith(".")) continue;
        const member = await readLinkedWorktree(join(root, entry));
        if (member !== null) members.push({ ...member, directory: entry });
      }
      return { root, exists: true, members };
    }),
  );
}

async function readLinkedWorktree(
  path: string,
): Promise<Omit<ScannedMember, "directory"> | null> {
  try {
    const info = await lstat(path);
    if (!info.isDirectory()) return null;
    const dotGit = join(path, ".git");
    const dotGitInfo = await lstat(dotGit);
    if (!dotGitInfo.isFile()) return null;
    const pointer = (await readFile(dotGit, "utf8")).trim();
    if (!pointer.startsWith("gitdir:")) return null;
    const gitDir = resolve(path, pointer.slice("gitdir:".length).trim());
    const head = (await readFile(join(gitDir, "HEAD"), "utf8")).trim();
    const branch = head.startsWith("ref: refs/heads/")
      ? head.slice("ref: refs/heads/".length)
      : null;
    const commonDirRaw = existsSync(join(gitDir, "commondir"))
      ? (await readFile(join(gitDir, "commondir"), "utf8")).trim()
      : "../..";
    const commonDir = resolve(gitDir, commonDirRaw);
    const repositoryPath = basename(commonDir) === ".git" ? dirname(commonDir) : commonDir;
    return { path, repository: basename(repositoryPath), repositoryPath, branch };
  } catch {
    return null;
  }
}

export type WorktreeProbeResult =
  | {
      readonly status: "ok";
      readonly repository: boolean;
      readonly mainWorktree: boolean;
      readonly mainRepoPath: string | null;
      readonly worktrees: readonly { readonly path: string; readonly branch: string | null }[];
      readonly branchExists: boolean;
      readonly targetExists: boolean;
      /** Where a new branch would start, before any fetch. */
      readonly defaultBase: string;
    }
  | { readonly status: "failed"; readonly message: string };

/**
 * What the repository records, and what is at the target, before creating.
 *
 * `git worktree list --porcelain` is the single source of truth for which
 * branch is checked out where. The target is checked on disk as well, because
 * a plain folder left over from an interrupted run is not a worktree git lists,
 * and a plan that missed it would promise a create that then fails.
 */
export async function probeWorktree(input: {
  readonly sourcePath: string;
  readonly branch: string;
  readonly targetPath: string;
}): Promise<WorktreeProbeResult> {
  const { sourcePath, branch, targetPath } = input;
  const inside = await runGit(["rev-parse", "--is-inside-work-tree"], sourcePath);
  if (inside.spawnErrorCode === "ENOENT") {
    return { status: "failed", message: "git is not installed on this machine." };
  }
  if (inside.exitCode !== 0 || inside.stdout.trim() !== "true") {
    return {
      status: "ok",
      repository: false,
      mainWorktree: false,
      mainRepoPath: null,
      worktrees: [],
      branchExists: false,
      targetExists: existsSync(targetPath),
      defaultBase: "HEAD",
    };
  }
  const [topLevel, commonDir, list, branchRef, base] = await Promise.all([
    runGit(["rev-parse", "--show-toplevel"], sourcePath),
    runGit(["rev-parse", "--path-format=absolute", "--git-common-dir"], sourcePath),
    runGit(["worktree", "list", "--porcelain"], sourcePath),
    runGit(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], sourcePath),
    defaultBaseOf(sourcePath),
  ]);
  if (list.exitCode !== 0) {
    return {
      status: "failed",
      message: list.stderr.trim() || "Could not read the repository's worktrees.",
    };
  }
  // git answers with resolved paths, and the caller's paths may run through a
  // symlink (`/var` is `/private/var` on macOS). The target is translated into
  // git's form for the comparison and back for the answer, so the plan, which
  // compares strings, sees one spelling of each place.
  const realTarget = await resolvedTarget(targetPath);
  const worktrees = parseWorktreeList(list.stdout).map((worktree) =>
    realTarget !== null && samePath(worktree.path, realTarget)
      ? { ...worktree, path: targetPath }
      : worktree,
  );
  const common = commonDir.exitCode === 0 ? commonDir.stdout.trim() : "";
  const mainRepoPath =
    common.length === 0 ? null : basename(common) === ".git" ? dirname(common) : common;
  return {
    status: "ok",
    repository: true,
    // The first entry `git worktree list` prints is the main working tree;
    // `--show-toplevel` is the same path, resolved the same way.
    mainWorktree:
      topLevel.exitCode === 0 &&
      samePath(topLevel.stdout.trim(), parseWorktreeList(list.stdout)[0]?.path ?? ""),
    mainRepoPath,
    worktrees,
    branchExists: branchRef.exitCode === 0,
    targetExists: existsSync(targetPath),
    defaultBase: base,
  };
}

/** The target with its parent's symlinks resolved, or null when the parent does not exist yet. */
async function resolvedTarget(targetPath: string): Promise<string | null> {
  try {
    return join(await realpath(dirname(targetPath)), basename(targetPath));
  } catch {
    return null;
  }
}

/**
 * The remote's default branch, or the local checkout's HEAD when there is none.
 *
 * Starting from the main checkout's HEAD would start the feature from whatever
 * branch that checkout happens to be on today.
 */
async function defaultBaseOf(repo: string): Promise<string> {
  const symbolic = await runGit(
    ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
    repo,
  );
  if (symbolic.exitCode === 0 && symbolic.stdout.trim().length > 0) {
    return symbolic.stdout.trim();
  }
  for (const candidate of ["origin/main", "origin/master"]) {
    const found = await runGit(["rev-parse", "--verify", "--quiet", candidate], repo);
    if (found.exitCode === 0) return candidate;
  }
  return "HEAD";
}

export type WorktreeCreateResult =
  | {
      readonly status: "created";
      readonly path: string;
      readonly branch: string;
      readonly base: string | null;
      /** What was done to make the checkout usable, in plain words. */
      readonly setup: readonly string[];
    }
  | { readonly status: "failed"; readonly message: string };

/**
 * Create the worktree, then make it usable.
 *
 * A new branch starts from a freshly fetched default branch, without tracking
 * it: a topic branch that tracked `origin/main` would count main's commits as
 * its own, and a bare `git push` would aim at the wrong place.
 *
 * Setup is the part every worktree tool learns to do: copy the untracked
 * `.env*` files the main checkout has, and initialise submodules. Installing
 * dependencies is left to the agent, which the context file tells how — it can
 * take minutes, and a host call that blocks for minutes is a sidebar that looks
 * hung.
 */
export async function createWorktree(input: {
  readonly mainRepoPath: string;
  readonly path: string;
  readonly branch: string;
  readonly newBranch: boolean;
  readonly baseRef: string | null;
}): Promise<WorktreeCreateResult> {
  const { mainRepoPath, path, branch, newBranch } = input;
  if (existsSync(path)) return { status: "failed", message: `${path} already exists.` };
  try {
    await mkdir(dirname(path), { recursive: true });
  } catch (error) {
    return { status: "failed", message: messageOf(error) };
  }
  let base: string | null = null;
  let args: string[];
  if (newBranch) {
    // Best effort: an offline machine still gets a worktree, from what it has.
    await runGit(["fetch", "--quiet", "origin"], mainRepoPath, 45_000);
    base = input.baseRef ?? (await defaultBaseOf(mainRepoPath));
    args = ["worktree", "add", "--no-track", "-b", branch, "--", path, base];
  } else {
    args = ["worktree", "add", "--", path, branch];
  }
  const created = await runGit(args, mainRepoPath, 120_000);
  if (created.exitCode !== 0) {
    return {
      status: "failed",
      message: created.stderr.trim() || `git exited with ${created.exitCode ?? "no code"}.`,
    };
  }
  const setup = await prepareWorktree(mainRepoPath, path);
  return { status: "created", path, branch, base, setup };
}

async function prepareWorktree(mainRepoPath: string, path: string): Promise<string[]> {
  const done: string[] = [];
  try {
    const copied: string[] = [];
    for (const entry of await readdir(mainRepoPath)) {
      if (!entry.startsWith(".env")) continue;
      const source = join(mainRepoPath, entry);
      if (!(await stat(source)).isFile()) continue;
      if (existsSync(join(path, entry))) continue;
      // Only what git does not carry: a tracked `.env.example` is already there.
      const tracked = await runGit(["ls-files", "--error-unmatch", "--", entry], mainRepoPath);
      if (tracked.exitCode === 0) continue;
      await copyFile(source, join(path, entry));
      copied.push(entry);
    }
    if (copied.length > 0) done.push(`Copied ${copied.join(", ")} from the main checkout.`);
  } catch {
    // A file that cannot be copied leaves the worktree usable, just less ready.
  }
  if (existsSync(join(path, ".gitmodules"))) {
    const submodules = await runGit(["submodule", "update", "--init", "--recursive"], path, 120_000);
    done.push(
      submodules.exitCode === 0
        ? "Initialised submodules."
        : "Submodules could not be initialised; run `git submodule update --init` there.",
    );
  }
  return done;
}

/** How a checkout installs its dependencies, read from its lockfile. */
export function installCommandFor(path: string): string | null {
  if (existsSync(join(path, "pnpm-lock.yaml"))) return "pnpm install";
  if (existsSync(join(path, "yarn.lock"))) return "yarn install";
  if (existsSync(join(path, "bun.lockb")) || existsSync(join(path, "bun.lock"))) return "bun install";
  if (existsSync(join(path, "package-lock.json"))) return "npm ci";
  if (existsSync(join(path, "package.json"))) return "npm install";
  return null;
}

/** What one worktree holds that removing it would discard. */
export interface WorktreeState {
  readonly path: string;
  readonly changedFiles: number;
  readonly untrackedFiles: number;
  /** Commits not on any remote branch, or null when that cannot be told. */
  readonly aheadCommits: number | null;
  /** True when the directory is gone, so there is nothing to lose. */
  readonly missing: boolean;
}

/**
 * What each worktree still holds, before it is taken back.
 *
 * "Unpushed" is counted against every remote branch rather than an upstream:
 * a topic branch created with `--no-track` has no upstream, and asking
 * `@{u}..HEAD` of it would answer nothing at all.
 */
export async function inspectWorktrees(input: {
  readonly paths: readonly string[];
}): Promise<readonly WorktreeState[]> {
  return Promise.all(
    input.paths.map(async (path): Promise<WorktreeState> => {
      if (!existsSync(path)) {
        return { path, changedFiles: 0, untrackedFiles: 0, aheadCommits: null, missing: true };
      }
      const status = await runGit(["status", "--porcelain", "--untracked-files=all"], path);
      if (status.exitCode !== 0) {
        return { path, changedFiles: 0, untrackedFiles: 0, aheadCommits: null, missing: false };
      }
      const lines = status.stdout.split("\n").filter((line) => line.length > 0);
      const untracked = lines.filter((line) => line.startsWith("??")).length;
      const ahead = await runGit(["rev-list", "--count", "HEAD", "--not", "--remotes"], path);
      return {
        path,
        changedFiles: lines.length - untracked,
        untrackedFiles: untracked,
        aheadCommits:
          ahead.exitCode === 0 ? Number.parseInt(ahead.stdout.trim(), 10) || 0 : null,
        missing: false,
      };
    }),
  );
}

/**
 * Write the files an agent reads in a feature directory.
 *
 * `AGENTS.md` keeps everything outside Nest's block. `CLAUDE.md` is written
 * only when it is missing, or gains the import line when a person's own file
 * lacks it. The legacy `NEST.md` is removed, because two context files that
 * disagree are worse than one.
 */
export async function writeFeatureContext(input: {
  readonly featureDirectory: string;
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  /** The branch suggested for a repository that has not been given one. */
  readonly suggestedBranch: string;
  readonly members: readonly {
    readonly directory: string;
    readonly repository: string;
    readonly branch: string | null;
    readonly path: string;
  }[];
}): Promise<{ status: "ok" } | { status: "failed"; message: string }> {
  const { featureDirectory } = input;
  const members: ContextMember[] = input.members.map((member) => ({
    directory: member.directory,
    repository: member.repository,
    branch: member.branch,
    install: installCommandFor(member.path),
  }));
  const context = {
    id: input.id,
    name: input.name,
    slug: input.slug,
    suggestedBranch: input.suggestedBranch,
    members,
  };
  try {
    await mkdir(featureDirectory, { recursive: true });
    const agentsPath = join(featureDirectory, AGENTS_FILE);
    const existing = existsSync(agentsPath) ? await readFile(agentsPath, "utf8") : null;
    await writeFile(agentsPath, mergeAgentsFile(existing, renderManagedBlock(context)), "utf8");
    const claudePath = join(featureDirectory, CLAUDE_FILE);
    if (!existsSync(claudePath)) {
      await writeFile(claudePath, CLAUDE_CONTENT, "utf8");
    } else {
      const claude = await readFile(claudePath, "utf8");
      if (!claude.includes("@AGENTS.md")) {
        await writeFile(claudePath, `${CLAUDE_CONTENT}\n${claude}`, "utf8");
      }
    }
    await writeFile(join(featureDirectory, MANIFEST_FILE), renderManifest(context), "utf8");
    const legacy = join(featureDirectory, LEGACY_CONTEXT_FILE);
    if (existsSync(legacy)) await unlink(legacy);
    return { status: "ok" };
  } catch (error) {
    return { status: "failed", message: messageOf(error) };
  }
}

/** Rename a checked-out branch in place, keeping its commits and its worktree. */
export async function renameBranch(input: {
  readonly repositoryPath: string;
  readonly from: string;
  readonly to: string;
}): Promise<{ status: "renamed" } | { status: "failed"; message: string }> {
  const { repositoryPath, from, to } = input;
  if (from === to) return { status: "renamed" };
  const result = await runGit(["branch", "-m", from, to], repositoryPath);
  return result.exitCode === 0
    ? { status: "renamed" }
    : { status: "failed", message: result.stderr.trim() || "git refused to rename the branch." };
}

/** Delete a branch a feature created. Only ever asked for by an explicit delete. */
export async function deleteBranch(input: {
  readonly mainRepoPath: string;
  readonly branch: string;
}): Promise<{ status: "deleted" | "kept"; reason: string | null }> {
  const result = await runGit(["branch", "-D", "--", input.branch], input.mainRepoPath);
  return result.exitCode === 0
    ? { status: "deleted", reason: null }
    : { status: "kept", reason: result.stderr.trim() || "git refused." };
}

/**
 * Take back a feature directory that holds nothing but Nest's own files.
 *
 * Refused when anything else is inside: a file a person put there is theirs,
 * and the plugin only removes what it wrote itself.
 */
export async function removeFeatureDirectory(
  featureDirectory: string,
): Promise<{ status: "removed" | "kept"; reason: string | null }> {
  let entries: string[];
  try {
    entries = await readdir(featureDirectory);
  } catch {
    return { status: "kept", reason: "The folder does not exist." };
  }
  const own = new Set(FEATURE_OWN_FILES);
  const foreign = entries.filter((entry) => !own.has(entry) && entry !== ".DS_Store");
  if (foreign.length > 0) {
    return {
      status: "kept",
      reason: `The folder still holds ${foreign.length} ${foreign.length === 1 ? "item" : "items"} Nest did not write.`,
    };
  }
  try {
    for (const entry of entries) await unlink(join(featureDirectory, entry));
    await rmdir(featureDirectory);
    return { status: "removed", reason: null };
  } catch (error) {
    return { status: "kept", reason: messageOf(error) };
  }
}

function parseWorktreeList(stdout: string): { path: string; branch: string | null }[] {
  const worktrees: { path: string; branch: string | null }[] = [];
  for (const block of stdout.split(/\n\n+/u)) {
    let path: string | null = null;
    let branch: string | null = null;
    for (const line of block.split("\n")) {
      if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
      else if (line.startsWith("branch refs/heads/")) branch = line.slice("branch refs/heads/".length);
    }
    if (path !== null) worktrees.push({ path, branch });
  }
  return worktrees;
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => value.replaceAll("\\", "/").replace(/\/+$/u, "");
  return normalize(left) === normalize(right);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
