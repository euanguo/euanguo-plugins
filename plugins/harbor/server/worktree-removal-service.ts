/**
 * Removing a workspace: survey, refuse, archive, release, delete.
 *
 * The one operation in this plugin that can destroy a directory, so it is one
 * implementation reached from three places — the sidebar's dialog, the RPC, and
 * an agent tool — and it surveys twice: once to describe, once to re-check what
 * the caller actually agreed to.
 *
 * The order is not arbitrary. Archiving is what lets bb release the
 * environment, and an environment bb refuses to release stops the whole thing
 * before anything on disk is touched. Only then is the directory removed, and
 * only when the caller asked for that.
 */

import type { BbPluginApi } from "@get-bb/plugin-sdk";

import {
  classifyBatchSurvey,
  dirtyBatchWorktreeReason,
  failedBatchSurvey,
  planWorktreeRemoval,
  removalSubmissionBlocker,
  worktreePlanDigest,
  WORKSPACE_CHANGED_MESSAGE,
  type BatchRemoveWorktreesResult,
  type BatchWorktreeRemovalItem,
  type BatchWorktreeSurveyItem,
  type WorkspaceRemovalOutcome,
  type WorktreeSurvey,
} from "../lib/domain/worktree-removal.ts";

const DEFAULT_BATCH_SURVEY_TIMEOUT_MS = 15_000;

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export interface WorkspaceRemovalRequest {
  readonly environmentId: string;
  /** False releases the environment and keeps the directory. */
  readonly deleteDirectory: boolean;
  /** Required when the plan says the directory still holds work. */
  readonly acknowledged: boolean;
  /** The digest from the inspection whose plan the caller is confirming. */
  readonly expectedDigest: string | null;
}

export interface BatchWorkspaceRemovalRequest {
  readonly environmentIds: readonly string[];
  readonly deleteDirectory: boolean;
  readonly force?: boolean;
}

export function createWorktreeRemovalService(input: {
  readonly bb: BbPluginApi;
  readonly surveyWorktree: (environmentId: string) => Promise<WorktreeSurvey>;
  readonly removeWorktreeDirectory: (args: {
    path: string;
    hostId: string;
    mainRepoPath: string | null;
  }) => Promise<{ directory: "removed" | "failed"; message: string | null }>;
  /** The held repository facts describe the state before the removal. */
  readonly invalidateFacts: () => void;
  readonly surveyTimeoutMs?: number;
}) {
  const { bb, surveyWorktree, removeWorktreeDirectory, invalidateFacts } = input;
  const surveyTimeoutMs = input.surveyTimeoutMs ?? DEFAULT_BATCH_SURVEY_TIMEOUT_MS;

  const executeRemoval = async (args: {
    readonly environmentId: string;
    readonly survey: WorktreeSurvey;
    readonly via: "git" | "delete";
    readonly deleteDirectory: boolean;
  }): Promise<WorkspaceRemovalOutcome> => {
    const { environmentId, survey, via, deleteDirectory } = args;
    await bb.sdk.environments.archiveThreads({ environmentId });

    let environmentRemoved = false;
    try {
      await bb.sdk.environments.delete({ environmentId });
      environmentRemoved = true;
      invalidateFacts();
    } catch (error) {
      return {
        ok: false,
        code: null,
        archivedThreads: true,
        environmentRemoved: false,
        directory: "kept",
        message: error instanceof Error ? error.message : String(error),
      };
    }

    if (!deleteDirectory) {
      return {
        ok: true,
        code: null,
        archivedThreads: true,
        environmentRemoved,
        directory: "kept",
        message: null,
      };
    }

    const removal = await removeWorktreeDirectory({
      path: survey.path,
      hostId: survey.hostId,
      mainRepoPath: via === "git" ? survey.mainRepoPath : null,
    });
    return {
      ok: true,
      code: null,
      archivedThreads: true,
      environmentRemoved,
      directory: removal.directory,
      message: removal.message,
    };
  };

  const inspect = async (environmentId: string) => {
    const survey = await surveyWorktree(environmentId);
    return {
      survey,
      plan: planWorktreeRemoval(survey),
      digest: worktreePlanDigest(survey),
    };
  };

  const remove = async (request: WorkspaceRemovalRequest): Promise<WorkspaceRemovalOutcome> => {
    const { environmentId, deleteDirectory, acknowledged, expectedDigest } = request;
    const survey = await surveyWorktree(environmentId);
    if (expectedDigest !== null && worktreePlanDigest(survey) !== expectedDigest) {
      return {
        ok: false,
        code: "changed",
        archivedThreads: false,
        environmentRemoved: false,
        directory: "kept",
        message: WORKSPACE_CHANGED_MESSAGE,
      };
    }
    const plan = planWorktreeRemoval(survey);
    const blocker = removalSubmissionBlocker(plan, { deleteDirectory, acknowledged });
    if (blocker !== null) {
      return {
        ok: false,
        code: blocker,
        archivedThreads: false,
        environmentRemoved: false,
        directory: "kept",
        message: null,
      };
    }

    return executeRemoval({
      environmentId,
      survey,
      via: plan.directory.via,
      deleteDirectory,
    });
  };

  const batchSurvey = async (
    environmentIds: readonly string[],
  ): Promise<{ items: BatchWorktreeSurveyItem[] }> => {
    const uniqueIds = [...new Set(environmentIds)];
    const items = await Promise.all(
      uniqueIds.map(async (environmentId) => {
        try {
          const survey = await withTimeout(
            surveyWorktree(environmentId),
            surveyTimeoutMs,
            `Timed out inspecting worktree (${surveyTimeoutMs}ms).`,
          );
          return classifyBatchSurvey(environmentId, survey, worktreePlanDigest(survey));
        } catch (error) {
          return failedBatchSurvey(
            environmentId,
            error instanceof Error ? error.message : String(error),
          );
        }
      }),
    );
    return { items };
  };

  const batchRemove = async (
    request: BatchWorkspaceRemovalRequest,
  ): Promise<BatchRemoveWorktreesResult> => {
    const { environmentIds, deleteDirectory, force = false } = request;
    const uniqueIds = [...new Set(environmentIds)];
    const items: BatchWorktreeRemovalItem[] = [];
    let removedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const environmentId of uniqueIds) {
      let survey: WorktreeSurvey;
      try {
        survey = await withTimeout(
          surveyWorktree(environmentId),
          surveyTimeoutMs,
          `Timed out inspecting worktree (${surveyTimeoutMs}ms).`,
        );
      } catch (error) {
        failedCount += 1;
        items.push({
          environmentId,
          status: "failed",
          outcome: null,
          reason: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      const dirtyReason = dirtyBatchWorktreeReason(survey);
      if (dirtyReason !== null && !force) {
        skippedCount += 1;
        items.push({
          environmentId,
          status: "skipped",
          outcome: null,
          reason: dirtyReason,
        });
        continue;
      }

      // Dangling worktrees already have no directory on disk, so only archive
      // threads and remove the BB environment record without failing on rmdir.
      const effectiveDeleteDirectory = deleteDirectory && survey.directoryExists;
      const plan = planWorktreeRemoval(survey);
      if (effectiveDeleteDirectory && plan.directory.refusal !== null) {
        skippedCount += 1;
        items.push({
          environmentId,
          status: "skipped",
          outcome: null,
          reason: plan.directory.refusal,
        });
        continue;
      }

      try {
        const outcome = await executeRemoval({
          environmentId,
          survey,
          via: plan.directory.via,
          deleteDirectory: effectiveDeleteDirectory,
        });
        if (!outcome.ok) {
          failedCount += 1;
          items.push({
            environmentId,
            status: "failed",
            outcome,
            reason: outcome.message ?? outcome.code ?? "Removal blocked.",
          });
        } else if (effectiveDeleteDirectory && outcome.directory === "failed") {
          failedCount += 1;
          items.push({
            environmentId,
            status: "failed",
            outcome,
            reason: outcome.message ?? "Failed to remove worktree directory.",
          });
        } else {
          removedCount += 1;
          items.push({
            environmentId,
            status: "removed",
            outcome,
            reason: null,
          });
        }
      } catch (error) {
        failedCount += 1;
        items.push({
          environmentId,
          status: "failed",
          outcome: null,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { items, removedCount, skippedCount, failedCount };
  };

  return { inspect, remove, batchSurvey, batchRemove };
}
