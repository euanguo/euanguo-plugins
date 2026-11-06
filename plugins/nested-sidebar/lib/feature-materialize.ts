/**
 * Turning a feature from a name into a directory of worktrees.
 *
 * Everything here is a decision about one worktree, taken from facts the host
 * read: whether the branch is free, whether the target already exists, and
 * whether the source is a repository at all. Doing it here rather than in the
 * host command means the same rules answer the pre-flight read and the write,
 * so a plan the user approved cannot be refused by a different rule a second
 * later.
 *
 * Three rules come from git and cannot be talked around:
 *
 * A branch is checked out in one worktree at a time. A second attempt is
 * refused by git, so the plan refuses it first and names where the branch is.
 *
 * A worktree directory is created empty. A leftover directory from an
 * interrupted run is not reusable: git refuses it, and deleting it silently
 * would be deleting someone's files.
 *
 * The feature directory is not a repository. If it became one, every child
 * worktree would be recorded by the parent's index as an embedded repository,
 * and a later `git add -A` would commit pointers with no contents.
 */

/** What the host found when it looked at a repository before creating. */
export interface WorktreeProbe {
  /** Every path the repository records, so the branch can be located. */
  readonly worktrees: readonly {
    readonly path: string;
    readonly branch: string | null;
  }[];
  /** True when the source path is inside a git repository. */
  readonly repository: boolean;
  /** True when the source is the main working tree, not a linked worktree. */
  readonly mainWorktree: boolean;
}

export type MaterializeDecision =
  | { readonly status: "create"; readonly path: string; readonly branch: string }
  | { readonly status: "reuse"; readonly path: string; readonly branch: string }
  | { readonly status: "blocked"; readonly reason: string };

/**
 * The child directory a repository gets inside a feature directory.
 *
 * Derived from the repository name rather than from the branch, because the
 * point of the directory is to say which repository a folder is. Sanitised to
 * one path segment, so a repository name with a slash cannot escape the feature
 * directory.
 */
export function childDirectoryFor(repositoryName: string): string {
  const cleaned = repositoryName
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return cleaned.length > 0 ? cleaned : "repo";
}

/**
 * Whether a feature can take one repository right now.
 *
 * `targetExists` is reported by the host, because the decision to overwrite a
 * directory is not one this module can make from a path string.
 */
export function planMaterialize(input: {
  readonly featureDirectory: string;
  readonly repositoryName: string;
  readonly branch: string;
  readonly probe: WorktreeProbe;
  readonly targetExists: boolean;
}): MaterializeDecision {
  const { featureDirectory, repositoryName, branch, probe, targetExists } = input;
  if (!probe.repository) {
    return { status: "blocked", reason: "源目录不是 git 仓库。" };
  }
  if (!probe.mainWorktree) {
    return {
      status: "blocked",
      reason: "源目录本身是一个 worktree，不能从它再开一个。",
    };
  }
  const path = joinPath(featureDirectory, childDirectoryFor(repositoryName));
  const holder = probe.worktrees.find(
    (worktree) => worktree.branch === branch,
  );
  if (holder !== undefined) {
    /**
     * The same branch in the same place is the idempotent case: the member was
     * created by an earlier call and the label is the only thing missing.
     * Anywhere else is a real conflict and the answer says where.
     */
    if (samePath(holder.path, path)) {
      return { status: "reuse", path, branch };
    }
    return {
      status: "blocked",
      reason: `分支 ${branch} 已被 ${holder.path} 占用。`,
    };
  }
  if (targetExists) {
    return {
      status: "blocked",
      reason: `目录已存在：${path}。若是上次中断留下的，请先删除它。`,
    };
  }
  return { status: "create", path, branch };
}

/**
 * The branch a new member starts on.
 *
 * One identifier names the work, so the branch is derived from the feature
 * rather than typed per repository. That is the invariant that makes
 * "this feature" answerable from any one repository.
 */
export function branchForFeature(featureId: string): string {
  return `feat/${featureId}`;
}

function joinPath(parent: string, child: string): string {
  return `${parent.replace(/[\\/]+$/u, "")}/${child}`;
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) =>
    value.replaceAll("\\", "/").replace(/\/+$/u, "");
  return normalize(left) === normalize(right);
}
