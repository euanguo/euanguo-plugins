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
import {
  MAX_BATCH_WORKTREES,
  type BatchRemoveWorktreesResult,
  type BatchWorktreeRemovalItem,
  type BatchWorktreeSurveyItem,
  type RemovalWarning,
  type WorkspaceRemovalOutcome,
  type WorktreeRemovalPlan,
  type WorktreeSurvey,
} from "../schemas/workspace.ts";

export {
  MAX_BATCH_WORKTREES,
  type BatchRemoveWorktreesResult,
  type BatchWorktreeRemovalItem,
  type BatchWorktreeSurveyItem,
  type RemovalWarning,
  type WorkspaceRemovalOutcome,
  type WorktreeRemovalPlan,
  type WorktreeSurvey,
};

export type DirectoryRemovalPlan = WorktreeRemovalPlan["directory"];

export const WORKSPACE_CHANGED_MESSAGE =
  "The workspace changed after you inspected it. Review it again before removing anything.";

/**
 * The stable fingerprint of the plan the user read. It deliberately includes
 * only the facts that decide what the removal would do, not display-only
 * fields such as the branch name or total thread count.
 */
export function worktreePlanDigest(survey: WorktreeSurvey): string {
  return JSON.stringify([
    survey.path,
    survey.gitWorktree,
    survey.directoryExists,
    survey.changedFiles,
    survey.untrackedFiles,
    survey.aheadCommits,
    survey.baseRef,
    survey.liveThreads,
    survey.openTerminals,
    survey.statusUnavailable === true,
  ]);
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
  if (survey.statusUnavailable) {
    warnings.push({
      kind: "discard",
      text: "Git status could not be verified — inspect directory before removing",
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

// Schema-derived batch survey/removal DTOs are re-exported above.

/**
 * Why a worktree cannot be silently batch-removed without `force`.
 *
 * Fails closed whenever local changes, unmerged commits, unverifiable git
 * status, live threads, or open terminals are present.
 */
export function dirtyBatchWorktreeReason(survey: WorktreeSurvey): string | null {
  const reasons: string[] = [];
  if (survey.changedFiles > 0) {
    reasons.push(plural(survey.changedFiles, "changed file", "changed files"));
  }
  if (survey.untrackedFiles > 0) {
    reasons.push(plural(survey.untrackedFiles, "untracked file", "untracked files"));
  }
  if (survey.aheadCommits > 0) {
    reasons.push(plural(survey.aheadCommits, "unpushed commit", "unpushed commits"));
  }
  if (survey.statusUnavailable) {
    reasons.push("git status could not be verified");
  }
  if (survey.liveThreads > 0) {
    reasons.push(plural(survey.liveThreads, "live thread", "live threads"));
  }
  if (survey.openTerminals > 0) {
    reasons.push(plural(survey.openTerminals, "open terminal", "open terminals"));
  }
  return reasons.length === 0 ? null : reasons.join(", ");
}

export function classifyBatchSurvey(
  environmentId: string,
  survey: WorktreeSurvey,
  digest: string = worktreePlanDigest(survey),
): BatchWorktreeSurveyItem {
  const plan = planWorktreeRemoval(survey);
  const blockedReason = dirtyBatchWorktreeReason(survey);
  return {
    environmentId,
    ok: true,
    survey,
    plan,
    digest,
    dirty: blockedReason !== null,
    blockedReason,
    error: null,
  };
}

export function failedBatchSurvey(
  environmentId: string,
  message: string,
): BatchWorktreeSurveyItem {
  return {
    environmentId,
    ok: false,
    survey: null,
    plan: null,
    digest: null,
    dirty: true,
    blockedReason: message,
    error: message,
  };
}
