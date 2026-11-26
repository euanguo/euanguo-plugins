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
  countCommitsNotOnRemotes,
  inspectPorcelainWorktreeStatus,
} from "./feature-git.ts";
import { runGit } from "./git.ts";
import { parseCommonDir, parseGitDirFile, parseHead } from "./workspace-facts.ts";

import {
  AGENTS_FILE,
  CLAUDE_CONTENT,
  CLAUDE_FILE,
  MANIFEST_FILE,
  isHarborManagedFile,
  mergeAgentsFile,
  renderManagedBlock,
  renderManifest,
  type ContextMember,
} from "../lib/domain/feature-context.ts";
import { renderCodeWorkspace } from "../lib/domain/feature-presets.ts";

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
  readonly signal?: AbortSignal;
}): Promise<{ status: "ok" } | { status: "failed"; message: string }> {
  if (!isAbsolute(input.path)) {
    return { status: "failed", message: `Not an absolute path: ${input.path}` };
  }
  try {
    await mkdir(input.path, { recursive: true });
  } catch (error) {
    return { status: "failed", message: messageOf(error) };
  }
  const inside = await runGit(
    ["rev-parse", "--is-inside-work-tree"],
    input.path,
    { timeoutMs: 10_000, signal: input.signal },
  );
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
  readonly role?: "worktree" | "ref";
}

/**
 * Every worktree (and read-only ref symlink) inside each feature directory,
 * read from the filesystem directly.
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
        const fullPath = join(root, entry);
        const refMember = await readReferenceLink(fullPath);
        if (refMember !== null) {
          members.push({ ...refMember, directory: entry, role: "ref" });
          continue;
        }
        const member = await readLinkedWorktree(fullPath);
        if (member !== null) {
          members.push({ ...member, directory: entry, role: "worktree" });
        }
      }
      return { root, exists: true, members };
    }),
  );
}

async function readReferenceLink(
  path: string,
): Promise<Omit<ScannedMember, "directory" | "role"> | null> {
  try {
    const info = await lstat(path);
    if (!info.isSymbolicLink()) return null;
    const targetInfo = await stat(path);
    if (!targetInfo.isDirectory()) return null;
    const repositoryPath = await realpath(path);
    let branch: string | null = null;
    const branchRes = await runGit(
      ["rev-parse", "--abbrev-ref", "HEAD"],
      repositoryPath,
      { timeoutMs: 5_000 },
    );
    if (branchRes.exitCode === 0) {
      const value = branchRes.stdout.trim();
      if (value.length > 0 && value !== "HEAD") branch = value;
    }
    return {
      path,
      repository: basename(repositoryPath),
      repositoryPath,
      branch,
    };
  } catch {
    return null;
  }
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
    const gitDirRel = parseGitDirFile(await readFile(dotGit, "utf8"));
    if (gitDirRel === null) return null;
    const gitDir = resolve(path, gitDirRel);
    const { branch } = parseHead(await readFile(join(gitDir, "HEAD"), "utf8"));
    const commonDirFile = join(gitDir, "commondir");
    const commonDir = existsSync(commonDirFile)
      ? parseCommonDir(await readFile(commonDirFile, "utf8"), gitDir)
      : resolve(gitDir, "..", "..");
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
  readonly signal?: AbortSignal;
}): Promise<WorktreeProbeResult> {
  const { sourcePath, branch, targetPath } = input;
  const inside = await runGit(
    ["rev-parse", "--is-inside-work-tree"],
    sourcePath,
    { timeoutMs: 60_000, signal: input.signal },
  );
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
    runGit(["rev-parse", "--show-toplevel"], sourcePath, {
      timeoutMs: 60_000,
      signal: input.signal,
    }),
    runGit(
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      sourcePath,
      { timeoutMs: 60_000, signal: input.signal },
    ),
    runGit(["worktree", "list", "--porcelain"], sourcePath, {
      timeoutMs: 60_000,
      signal: input.signal,
    }),
    runGit(
      ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`],
      sourcePath,
      { timeoutMs: 60_000, signal: input.signal },
    ),
    defaultBaseOf(sourcePath, input.signal),
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
async function defaultBaseOf(repo: string, signal?: AbortSignal): Promise<string> {
  const symbolic = await runGit(
    ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
    repo,
    { timeoutMs: 60_000, signal },
  );
  if (symbolic.exitCode === 0 && symbolic.stdout.trim().length > 0) {
    return symbolic.stdout.trim();
  }
  for (const candidate of ["origin/main", "origin/master"]) {
    const found = await runGit(
      ["rev-parse", "--verify", "--quiet", candidate],
      repo,
      { timeoutMs: 60_000, signal },
    );
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
  readonly signal?: AbortSignal;
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
    await runGit(["fetch", "--quiet", "origin"], mainRepoPath, {
      timeoutMs: 45_000,
      signal: input.signal,
    });
    base = input.baseRef ?? (await defaultBaseOf(mainRepoPath, input.signal));
    args = ["worktree", "add", "--no-track", "-b", branch, "--", path, base];
  } else {
    args = ["worktree", "add", "--", path, branch];
  }
  const created = await runGit(args, mainRepoPath, {
    timeoutMs: 120_000,
    signal: input.signal,
  });
  if (created.exitCode !== 0) {
    return {
      status: "failed",
      message: created.stderr.trim() || `git exited with ${created.exitCode ?? "no code"}.`,
    };
  }
  const setup = await prepareWorktree(mainRepoPath, path, input.signal);
  return { status: "created", path, branch, base, setup };
}

async function prepareWorktree(
  mainRepoPath: string,
  path: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const done: string[] = [];
  try {
    const copied: string[] = [];
    for (const entry of await readdir(mainRepoPath)) {
      if (!entry.startsWith(".env")) continue;
      try {
        const source = join(mainRepoPath, entry);
        if (!(await lstat(source)).isFile()) continue;
        if (existsSync(join(path, entry))) continue;
        // Only what git does not carry: a tracked `.env.example` is already there.
        const tracked = await runGit(
          ["ls-files", "--error-unmatch", "--", entry],
          mainRepoPath,
          { timeoutMs: 60_000, signal },
        );
        if (tracked.exitCode === 0) continue;
        await copyFile(source, join(path, entry));
        copied.push(entry);
      } catch {
        // A file that cannot be copied leaves the worktree usable, just less ready.
      }
    }
    if (copied.length > 0) done.push(`Copied ${copied.join(", ")} from the main checkout.`);
  } catch {
    // Unreadable main checkout leaves the worktree usable, just less ready.
  }
  if (existsSync(join(path, ".gitmodules"))) {
    const submodules = await runGit(
      ["submodule", "update", "--init", "--recursive"],
      path,
      { timeoutMs: 120_000, signal },
    );
    done.push(
      submodules.exitCode === 0
        ? "Initialised submodules."
        : "Submodules could not be initialised; run `git submodule update --init` there.",
    );
  }
  return done;
}

/** How a checkout installs its dependencies, read from its lockfile. */
function installCommandFor(path: string): string | null {
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
  /** Set when `git status` failed on an existing directory. */
  readonly error?: string | null;
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
  readonly signal?: AbortSignal;
}): Promise<readonly WorktreeState[]> {
  return Promise.all(
    input.paths.map(async (path): Promise<WorktreeState> => {
      if (!existsSync(path)) {
        return { path, changedFiles: 0, untrackedFiles: 0, aheadCommits: null, missing: true };
      }
      const status = await inspectPorcelainWorktreeStatus(path, 60_000, input.signal);
      if (!status.ok) {
        return {
          path,
          changedFiles: 0,
          untrackedFiles: 0,
          aheadCommits: null,
          missing: false,
          error: status.error,
        };
      }
      const aheadCommits = await countCommitsNotOnRemotes(path, 60_000, input.signal);
      return {
        path,
        changedFiles: status.parsed.changedFiles,
        untrackedFiles: status.parsed.untrackedFiles,
        aheadCommits,
        missing: false,
      };
    }),
  );
}

/**
 * Write the files an agent reads in a feature directory.
 *
 * `AGENTS.md` keeps everything outside Harbor's block. `CLAUDE.md` is written
 * only when it is missing, or gains the import line when a person's own file
 * lacks it.
 */
export async function writeFeatureContext(input: {
  readonly featureDirectory: string;
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  /** The branch suggested for a repository that has not been given one. */
  readonly suggestedBranch: string;
  /** The requirement, references and decisions, already rendered as Markdown. */
  readonly summary?: string;
  readonly codeWorkspaceContent?: string;
  readonly members: readonly {
    readonly directory: string;
    readonly repository: string;
    readonly branch: string | null;
    readonly path: string;
    readonly role?: "worktree" | "ref" | "submodule";
  }[];
}): Promise<{ status: "ok" } | { status: "failed"; message: string }> {
  const { featureDirectory } = input;
  const members: ContextMember[] = input.members.map((member) => ({
    directory: member.directory,
    repository: member.repository,
    branch: member.branch,
    ...(member.role === undefined ? {} : { role: member.role }),
    install:
      member.role === "ref" ? null : installCommandFor(member.path),
  }));
  const context = {
    id: input.id,
    name: input.name,
    slug: input.slug,
    suggestedBranch: input.suggestedBranch,
    ...(input.summary === undefined ? {} : { summary: input.summary }),
    members,
  };
  const workspaceContent =
    input.codeWorkspaceContent ??
    renderCodeWorkspace({
      name: input.name,
      members: members.map((member) => ({
        directory: member.directory,
        repository: member.repository,
        role: member.role === "ref" ? "ref" : "worktree",
      })),
    });
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
    await writeFile(
      join(featureDirectory, `${input.slug}.code-workspace`),
      workspaceContent,
      "utf8",
    );
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
  readonly signal?: AbortSignal;
}): Promise<{ status: "renamed" } | { status: "failed"; message: string }> {
  const { repositoryPath, from, to } = input;
  if (from === to) return { status: "renamed" };
  const result = await runGit(
    ["branch", "-m", "--", from, to],
    repositoryPath,
    { timeoutMs: 60_000, signal: input.signal },
  );
  return result.exitCode === 0
    ? { status: "renamed" }
    : { status: "failed", message: result.stderr.trim() || "git refused to rename the branch." };
}

/** Delete a branch a feature created. Only ever asked for by an explicit delete. */
export async function deleteBranch(input: {
  readonly mainRepoPath: string;
  readonly branch: string;
  readonly signal?: AbortSignal;
}): Promise<{ status: "deleted" | "kept"; reason: string | null }> {
  const result = await runGit(
    ["branch", "-D", "--", input.branch],
    input.mainRepoPath,
    { timeoutMs: 60_000, signal: input.signal },
  );
  return result.exitCode === 0
    ? { status: "deleted", reason: null }
    : { status: "kept", reason: result.stderr.trim() || "git refused." };
}

/**
 * Take back a feature directory that holds nothing but Harbor's own files.
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
  const removable: string[] = [];
  const foreign: string[] = [];
  for (const entry of entries) {
    if (isHarborManagedFile(entry) || entry === ".DS_Store") {
      removable.push(entry);
      continue;
    }
    try {
      const info = await lstat(join(featureDirectory, entry));
      if (info.isSymbolicLink()) {
        // Safe to unlink reference symlinks without touching the target directory.
        removable.push(entry);
        continue;
      }
    } catch {
      // Ignore stat error and treat as foreign.
    }
    foreign.push(entry);
  }
  if (foreign.length > 0) {
    return {
      status: "kept",
      reason: `The folder still holds ${foreign.length} ${foreign.length === 1 ? "item" : "items"} Harbor did not write.`,
    };
  }
  try {
    for (const entry of removable) await unlink(join(featureDirectory, entry));
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
