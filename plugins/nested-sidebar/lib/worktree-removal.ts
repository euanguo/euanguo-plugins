/**
 * What removing a worktree row actually removes.
 *
 * One row stands for three things, and they are not equally reversible:
 *
 * - the threads, which archive and can be unarchived;
 * - bb's environment for the directory, which is released and can be rebuilt;
 * - the directory on disk, which is gone.
 *
 * So the row offers one operation whose third step sits behind an explicit ask.
 * What that ask has to say is decided here, away from the dialog's markup: the
 * counts the user has to look at, which of them is a warning rather than a
 * refusal, and whether the directory is bb's to remove at all.
 */

/** What bb can tell us about one workspace before anything is touched. */
export interface WorktreeSurvey {
  /** The directory on disk. */
  readonly path: string;
  /** The machine that owns the directory. */
  readonly hostId: string;
  readonly branch: string | null;
  /** bb created this directory, so removing it is bb's own cleanup. */
  readonly bbOwned: boolean;
  /** A registered git worktree, rather than a project's own checkout. */
  readonly gitWorktree: boolean;
  readonly directoryExists: boolean;
  /** The repository the worktree belongs to, when bb knows it. */
  readonly mainRepoPath: string | null;
  /** Tracked files with uncommitted changes. */
  readonly changedFiles: number;
  /** Files git does not track at all. */
  readonly untrackedFiles: number;
  /** Commits this branch has that its base does not. */
  readonly aheadCommits: number;
  readonly baseRef: string | null;
  /** Threads that still live in this workspace. */
  readonly threads: number;
  /** Of those, the ones bb counts as live. */
  readonly liveThreads: number;
  readonly openTerminals: number;
}

/**
 * A reason the user has to read before the directory may go.
 *
 * `discard` is data about to be lost, `in-use` is something still holding the
 * directory, and `external` is a directory bb did not create — the tool that
 * did will go on listing it.
 */
export interface RemovalWarning {
  readonly kind: "discard" | "in-use" | "external";
  readonly text: string;
}

export interface DirectoryRemovalPlan {
  /** Which mechanism removes it: git's own worktree plumbing, or a plain delete. */
  readonly via: "git" | "delete";
  readonly warnings: readonly RemovalWarning[];
  /** Non-null when the directory must not be removed at all. */
  readonly refusal: string | null;
}

export interface WorktreeRemovalPlan {
  /** Every thread under the row, archived as one family each. */
  readonly threadCount: number;
  readonly liveThreadCount: number;
  readonly directory: DirectoryRemovalPlan;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function planWorktreeRemoval(survey: WorktreeSurvey): WorktreeRemovalPlan {
  const warnings: RemovalWarning[] = [];
  if (survey.changedFiles > 0) {
    warnings.push({
      kind: "discard",
      text: `${plural(survey.changedFiles, "changed file", "changed files")} will be lost`,
    });
  }
  if (survey.untrackedFiles > 0) {
    warnings.push({
      kind: "discard",
      text: `${plural(survey.untrackedFiles, "untracked file", "untracked files")} will be lost`,
    });
  }
  if (survey.aheadCommits > 0) {
    const base = survey.baseRef ?? "the base branch";
    warnings.push({
      kind: "discard",
      text: `${plural(survey.aheadCommits, "commit", "commits")} not on ${base} will be lost`,
    });
  }
  if (survey.openTerminals > 0) {
    warnings.push({
      kind: "in-use",
      text: `${plural(survey.openTerminals, "terminal is", "terminals are")} still open here`,
    });
  }
  if (!survey.bbOwned) {
    warnings.push({
      kind: "external",
      text: "bb did not create this directory, so the tool that did will still list it",
    });
  }

  return {
    threadCount: survey.threads,
    liveThreadCount: survey.liveThreads,
    directory: {
      via: survey.gitWorktree && survey.mainRepoPath !== null ? "git" : "delete",
      warnings,
      refusal: directoryRefusal(survey),
    },
  };
}

/**
 * A project's own checkout is the one directory this feature must never take:
 * it is where the project lives, not a copy of it. A directory that is already
 * gone needs no removal either — the row is then only stale bookkeeping.
 */
function directoryRefusal(survey: WorktreeSurvey): string | null {
  if (!survey.gitWorktree) {
    return "This is the project's own checkout, not a worktree.";
  }
  if (!survey.directoryExists) {
    return "The directory is already gone.";
  }
  return null;
}

export interface RemovalRequest {
  readonly deleteDirectory: boolean;
  /** The user ticked the acknowledgement for what the directory step costs. */
  readonly acknowledged: boolean;
}

/**
 * What still stands between a request and the button, or null when nothing does.
 *
 * Archiving threads and releasing the environment are reversible, so they need
 * no ceremony beyond the dialog itself. Removing the directory is neither, so it
 * asks for one thing the user has to have read: a box that says what the step
 * costs, next to the counts that say how much. Deliberately a box rather than
 * the directory's name typed out — the gate has to be read to be passed, and a
 * path is long enough that people paste it without reading anything.
 */
export function removalSubmissionBlocker(
  plan: WorktreeRemovalPlan,
  request: RemovalRequest,
): "unavailable" | "acknowledgement" | null {
  if (!request.deleteDirectory) return null;
  if (plan.directory.refusal !== null) return "unavailable";
  return request.acknowledged ? null : "acknowledgement";
}
