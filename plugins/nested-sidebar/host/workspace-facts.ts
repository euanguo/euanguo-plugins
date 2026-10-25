/**
 * What the disk says about a set of directories.
 *
 * This runs on the machine that owns the paths, because that is the only place
 * the answer exists. It deliberately does not run `git`: every fact the sidebar
 * needs is already written down in `.git`, and reading it directly means a
 * machine without git still gets an answer, and one call covers a whole
 * sidebar's worth of paths instead of one process per repository.
 *
 * Three files carry the whole model, and git's own layout is the only thing
 * that has to be understood:
 *
 * - `<checkout>/.git` — a **directory** in the main working tree, a **file**
 *   in a linked one. The file holds one line: `gitdir: <path>`.
 * - `<gitdir>/commondir` — how a linked worktree gets back to the `.git` all
 *   worktrees share. Relative to the gitdir, almost always `../..`.
 * - `<commonDir>/config` — `[remote "origin"] url = …`, the only identity two
 *   clones of one repository agree on.
 *
 * Nothing here throws. A directory that cannot be read is reported as one that
 * was not observed, because a probe that fails is not a probe that found a
 * plain directory — and the caller draws a different row for each.
 */

import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

/** One repository, as its own bookkeeping records it. */
export interface HostWorktreeFact {
  readonly path: string;
  readonly branch: string | null;
  readonly head: string | null;
  readonly detached: boolean;
  readonly prunable: boolean;
}

/** What was observed about one directory. Mirrors `WorkspaceFacts` on the server. */
export interface HostWorkspaceFact {
  readonly path: string;
  readonly realPath: string | null;
  readonly isDirectory: boolean;
  readonly isMainWorktree: boolean;
  readonly isLinkedWorktree: boolean;
  /** A `.git` file whose gitdir is its own repository, such as a submodule. */
  readonly isNestedRepository: boolean;
  /** The working-tree root that supplied this repository's metadata. */
  readonly repositoryRoot: string | null;
  readonly commonDir: string | null;
  readonly remoteUrl: string | null;
  readonly worktrees: readonly HostWorktreeFact[];
}

/**
 * How many worktrees one repository may report.
 *
 * A sidebar row does not need the four hundredth worktree, and the list is a
 * directory read on a machine the user is waiting on. The cap is a limit on
 * work, not on truth: what is reported is a prefix of what exists.
 */
const MAX_WORKTREES = 200;

/** The one line a linked worktree's `.git` file holds. */
const GITDIR_LINE = /^\s*gitdir:\s*(.+?)\s*$/;

/** `ref: refs/heads/<name>`, which is what a checkout on a branch holds. */
const HEAD_REF = /^ref:\s*refs\/heads\/(.+?)\s*$/;

/**
 * The path a linked worktree's `.git` file points at.
 *
 * Exported for its own test: this is the single line that decides whether a
 * directory is a worktree of another repository or a repository of its own, and
 * getting it wrong merges two projects.
 */
export function parseGitDirFile(content: string): string | null {
  for (const line of content.split("\n")) {
    const match = GITDIR_LINE.exec(line);
    if (match !== null) return match[1];
  }
  return null;
}

/**
 * The shared `.git` a linked worktree's own gitdir resolves to.
 *
 * `commondir` is relative to the gitdir, not to the worktree, which is the one
 * detail that makes this file worth its own function.
 */
export function parseCommonDir(content: string, gitDir: string): string {
  const raw = content.split("\n").map((line) => line.trim()).find((line) => line.length > 0);
  if (raw === undefined) return path.resolve(gitDir, "..", "..");
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(gitDir, raw);
}

/**
 * A branch name from a `HEAD` file, or null when the checkout is detached.
 *
 * The sha a detached HEAD holds is not a branch and is not returned as one:
 * a row labelled with 40 hex characters says less than no label at all.
 */
export function parseHead(content: string): { branch: string | null; head: string | null } {
  const line = content.split("\n").map((value) => value.trim()).find((value) => value.length > 0);
  if (line === undefined) return { branch: null, head: null };
  const ref = HEAD_REF.exec(line);
  if (ref !== null) return { branch: ref[1], head: null };
  return { branch: null, head: /^[0-9a-f]{7,64}$/i.test(line) ? line : null };
}

/**
 * The URL of the repository's remote, preferring `origin`.
 *
 * Read from the config text rather than asked of git, and `origin` first
 * because that is the name every tool agrees on. A repository with only other
 * remotes still gets one, since any remote names the same repository origin
 * would.
 */
export function parseRemoteUrl(configText: string): string | null {
  let section: string | null = null;
  const byName = new Map<string, string>();
  for (const raw of configText.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("#") || line.startsWith(";")) continue;
    const header = /^\[remote\s+"(.*)"\]$/.exec(line);
    if (header !== null) {
      section = header[1];
      continue;
    }
    if (line.startsWith("[")) {
      section = null;
      continue;
    }
    if (section === null) continue;
    const assignment = /^url\s*=\s*(.+)$/.exec(line);
    if (assignment === null) continue;
    if (!byName.has(section)) byName.set(section, assignment[1].trim());
  }
  return byName.get("origin") ?? [...byName.values()][0] ?? null;
}

async function readTextIfPresent(filePath: string, maxBytes = 1024 * 1024): Promise<string | null> {
  try {
    const info = await stat(filePath);
    if (!info.isFile() || info.size > maxBytes) return null;
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function realPathOrNull(target: string): Promise<string | null> {
  try {
    return await realpath(target);
  } catch {
    return null;
  }
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    const info = await stat(target);
    return info.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Every worktree the repository records, the main one first.
 *
 * The main working tree is not in `worktrees/` — git keeps it out of its own
 * bookkeeping because it is the directory `.git` lives in. Reconstructing it
 * from `commonDir` is what makes the list complete, and it is also what lets
 * the caller recognise a checkout it already knows.
 */
async function listWorktrees(
  commonDir: string,
  repositoryRoot: string,
): Promise<HostWorktreeFact[]> {
  const worktrees: HostWorktreeFact[] = [];

  const mainPath =
    path.basename(commonDir) === ".git"
      ? path.dirname(commonDir)
      : repositoryRoot;
  if (mainPath !== null) {
    const head = await readTextIfPresent(path.join(commonDir, "HEAD"));
    const parsed = head === null ? { branch: null, head: null } : parseHead(head);
    worktrees.push({
      path: mainPath,
      branch: parsed.branch,
      head: parsed.head,
      detached: parsed.branch === null,
      prunable: !(await isDirectory(mainPath)),
    });
  }

  const linked: HostWorktreeFact[] = [];
  const entries = await readdir(path.join(commonDir, "worktrees"), { withFileTypes: true })
    .catch(() => []);
  const named = entries.filter((entry) => entry.isDirectory());
  for (const entry of named) {
    if (linked.length >= MAX_WORKTREES) break;
    const entryDir = path.join(commonDir, "worktrees", entry.name);
    const gitdirText = await readTextIfPresent(path.join(entryDir, "gitdir"));
    if (gitdirText === null) continue;
    // The file names the worktree's own `.git`, so the worktree is its parent.
    const gitFile = gitdirText.split("\n").map((line) => line.trim()).find((line) => line.length > 0);
    if (gitFile === undefined) continue;
    const worktreePath = path.dirname(path.resolve(gitFile));
    const head = await readTextIfPresent(path.join(entryDir, "HEAD"));
    const parsed = head === null ? { branch: null, head: null } : parseHead(head);
    linked.push({
      path: worktreePath,
      branch: parsed.branch,
      head: parsed.head,
      detached: parsed.branch === null,
      prunable: !(await isDirectory(worktreePath)),
    });
  }

  // Sorted by the path the user will read, because these become sidebar rows:
  // the bookkeeping directory names are git's business and two loads of one
  // repository must draw the same list.
  linked.sort((left, right) => left.path.localeCompare(right.path));
  return [...worktrees, ...linked];
}

function unobservedFact(path_: string): HostWorkspaceFact {
  return {
    path: path_,
    realPath: null,
    isDirectory: false,
    isMainWorktree: false,
    isLinkedWorktree: false,
    isNestedRepository: false,
    repositoryRoot: null,
    commonDir: null,
    remoteUrl: null,
    worktrees: [],
  };
}

interface RepositoryLayout {
  readonly repositoryRoot: string;
  readonly commonDir: string;
  readonly isMainWorktree: boolean;
  readonly isLinkedWorktree: boolean;
  readonly isNestedRepository: boolean;
}

/**
 * Read one working tree's Git layout.
 *
 * A `.git` directory is the main working tree. A `.git` file with a
 * `commondir` is a linked worktree. A `.git` file without one is an embedded
 * repository, which is what a submodule normally looks like from inside the
 * submodule; its gitdir owns the config and is not the parent repository.
 */
async function repositoryLayout(root: string): Promise<RepositoryLayout | null> {
  const dotGit = path.join(root, ".git");
  if (await isDirectory(dotGit)) {
    return {
      repositoryRoot: root,
      commonDir: (await realPathOrNull(dotGit)) ?? dotGit,
      isMainWorktree: true,
      isLinkedWorktree: false,
      isNestedRepository: false,
    };
  }

  const gitFileText = await readTextIfPresent(dotGit);
  const gitDir = gitFileText === null ? null : parseGitDirFile(gitFileText);
  if (gitDir === null) return null;

  const resolvedGitDir = path.resolve(root, gitDir);
  const commonText = await readTextIfPresent(path.join(resolvedGitDir, "commondir"));
  if (commonText === null) {
    return {
      repositoryRoot: root,
      commonDir: (await realPathOrNull(resolvedGitDir)) ?? resolvedGitDir,
      isMainWorktree: false,
      isLinkedWorktree: false,
      isNestedRepository: true,
    };
  }

  const resolvedCommon = parseCommonDir(commonText, resolvedGitDir);
  return {
    repositoryRoot: root,
    commonDir: (await realPathOrNull(resolvedCommon)) ?? resolvedCommon,
    isMainWorktree: false,
    isLinkedWorktree: true,
    isNestedRepository: false,
  };
}

/**
 * Find the nearest checkout containing a directory.
 *
 * An environment path can name a package directory rather than the checkout
 * root. Walking ancestors in the host, rather than on the server, keeps the
 * answer truthful for remote machines and symlinked paths.
 */
async function containingRepository(start: string): Promise<RepositoryLayout | null> {
  let current = path.dirname(start);
  for (let depth = 0; depth < 64; depth += 1) {
    const layout = await repositoryLayout(current);
    if (layout !== null) return layout;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

/**
 * Observe one directory, and never reject.
 *
 * The caller is a batch on a machine the user is waiting on, so one unreadable
 * directory has to cost one row its detail, not the whole answer. A rejection
 * here would take every path in the batch with it.
 */
export async function resolveOneWorkspaceFact(path_: string): Promise<HostWorkspaceFact> {
  try {
    return await observeOneWorkspaceFact(path_);
  } catch {
    return unobservedFact(path_);
  }
}

/**
 * Observe one directory.
 *
 * The order matters: a `.git` that is a directory is a main working tree and
 * stops the walk, because a repository inside a repository is a different
 * directory's problem, not this one's.
 */
async function observeOneWorkspaceFact(path_: string): Promise<HostWorkspaceFact> {
  const unobserved = unobservedFact(path_);

  const real = await realPathOrNull(path_);
  if (real === null || !(await isDirectory(real))) return unobserved;

  const exactLayout = await repositoryLayout(real);
  const layout = exactLayout ?? (await containingRepository(real));
  if (layout === null) {
    return { ...unobserved, realPath: real, isDirectory: true };
  }

  const config = await readTextIfPresent(path.join(layout.commonDir, "config"));
  return {
    path: path_,
    realPath: real,
    isDirectory: true,
    isMainWorktree: exactLayout?.isMainWorktree ?? false,
    isLinkedWorktree: exactLayout?.isLinkedWorktree ?? false,
    isNestedRepository: exactLayout?.isNestedRepository ?? false,
    repositoryRoot: layout.repositoryRoot,
    commonDir: layout.commonDir,
    remoteUrl: config === null ? null : parseRemoteUrl(config),
    worktrees: await listWorktrees(layout.commonDir, layout.repositoryRoot),
  };
}

/**
 * Observe a batch, deduplicated.
 *
 * Two environments can name one directory in two spellings; both are answered,
 * because the caller is matching answers back by the path it asked about. The
 * work is deduplicated on the resolved path, which is what keeps a sidebar with
 * twenty environments from realpath-ing the same checkout twenty times.
 */
export async function resolveWorkspaceFacts(paths: readonly string[]): Promise<HostWorkspaceFact[]> {
  const unique = [...new Set(paths.map((value) => value.trim()).filter((value) => value.length > 0))];
  const resolved = await Promise.all(
    unique.map(async (candidate) =>
      [candidate, await resolveOneWorkspaceFact(candidate)] as const,
    ),
  );
  return resolved.map(([, fact]) => fact);
}
