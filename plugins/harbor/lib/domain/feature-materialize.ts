/**
 * Adding one repository's worktree to a feature directory.
 *
 * Everything here is a decision about one worktree, taken from facts the host
 * read: whether the branch is free, whether the target already exists, whether
 * the source is a repository at all. The same function answers the pre-flight
 * read and the write, from the same probe, so a plan the user approved cannot
 * be refused a second later by a rule the plan never asked.
 *
 * Three rules come from git and cannot be talked around:
 *
 * A branch is checked out in one worktree at a time. A second attempt is
 * refused by git, so the plan refuses it first and names where the branch is.
 *
 * A worktree directory is created empty. Anything already at the target —
 * a worktree, a plain folder left by an interrupted run, a file — is reported,
 * never deleted: removing it silently would be removing someone's files.
 *
 * The feature directory is not a repository. If it became one, every child
 * worktree would be recorded by the parent's index as an embedded repository,
 * and a later `git add -A` would commit pointers with no contents.
 */

/** What the host found when it looked at a repository before creating. */
export interface WorktreeProbe {
  /** True when the source path is inside a git repository. */
  readonly repository: boolean;
  /** True when the source is the main working tree, not a linked worktree. */
  readonly mainWorktree: boolean;
  /** Every worktree the repository records, so the branch can be located. */
  readonly worktrees: readonly {
    readonly path: string;
    readonly branch: string | null;
  }[];
  /** Whether `refs/heads/<branch>` already exists. */
  readonly branchExists: boolean;
  /** Whether anything at all is at the target path. */
  readonly targetExists: boolean;
}

export type MaterializeDecision =
  | {
      readonly status: "create";
      readonly path: string;
      readonly branch: string;
      /** False when the branch exists and is checked out as it is. */
      readonly newBranch: boolean;
    }
  | { readonly status: "reuse"; readonly path: string; readonly branch: string }
  | { readonly status: "blocked"; readonly path: string; readonly reason: string };

/**
 * The child directory a repository gets inside a feature directory.
 *
 * Derived from the repository name, because the point of the folder is to say
 * which repository it is. Sanitised to one path segment, so a repository name
 * with a slash cannot escape the feature directory.
 */
export function childDirectoryFor(repositoryName: string): string {
  const cleaned = repositoryName
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return cleaned.length > 0 ? cleaned : "repo";
}

/** Whether a feature can take one repository right now, and how. */
export function planMaterialize(input: {
  readonly featureDirectory: string;
  readonly repositoryName: string;
  readonly branch: string;
  readonly probe: WorktreeProbe;
}): MaterializeDecision {
  const { featureDirectory, repositoryName, branch, probe } = input;
  const path = joinPath(featureDirectory, childDirectoryFor(repositoryName));
  if (!probe.repository) {
    return { status: "blocked", path, reason: "The project's folder is not a git repository." };
  }
  if (!probe.mainWorktree) {
    return {
      status: "blocked",
      path,
      reason: "The project's folder is itself a linked worktree. Add from the main checkout.",
    };
  }
  const holder = probe.worktrees.find((worktree) => worktree.branch === branch);
  if (holder !== undefined) {
    // The same branch already in the same place is the idempotent case: an
    // earlier call created it. Anywhere else is a real conflict, and the answer
    // says where so the person can go and look.
    if (samePath(holder.path, path)) return { status: "reuse", path, branch };
    return {
      status: "blocked",
      path,
      reason: `Branch ${branch} is checked out at ${holder.path}.`,
    };
  }
  const occupant = probe.worktrees.find((worktree) => samePath(worktree.path, path));
  if (occupant !== undefined) {
    return {
      status: "blocked",
      path,
      reason: `${path} is already a worktree on ${occupant.branch ?? "a detached HEAD"}.`,
    };
  }
  if (probe.targetExists) {
    return {
      status: "blocked",
      path,
      reason: `${path} already exists. Move or delete it, then try again.`,
    };
  }
  return { status: "create", path, branch, newBranch: !probe.branchExists };
}

/**
 * A branch name git will take, for a branch the user typed.
 *
 * The checks are git's own `check-ref-format` rules that a person is likely to
 * trip over; anything subtler is left for git to refuse with its own words.
 */
export function validBranchName(value: string): boolean {
  if (value.length === 0 || value.length > 200) return false;
  if (value.startsWith("-") || value.startsWith("/") || value.endsWith("/")) return false;
  if (value.endsWith(".") || value.endsWith(".lock")) return false;
  if (value.includes("..") || value.includes("//") || value.includes("@{")) return false;
  return !/[\s~^:?*[\\\u0000-\u001F\u007F]/u.test(value);
}

function joinPath(parent: string, child: string): string {
  return `${parent.replace(/[\\/]+$/u, "")}/${child}`;
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) =>
    value.replaceAll("\\", "/").replace(/\/+$/u, "");
  return normalize(left) === normalize(right);
}
