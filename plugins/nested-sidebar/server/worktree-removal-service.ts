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
  planWorktreeRemoval,
  removalSubmissionBlocker,
  type WorkspaceRemovalOutcome,
  type WorktreeSurvey,
} from "../lib/worktree-removal.ts";

export interface WorkspaceRemovalRequest {
  readonly environmentId: string;
  /** False releases the environment and keeps the directory. */
  readonly deleteDirectory: boolean;
  /** Required when the plan says the directory still holds work. */
  readonly acknowledged: boolean;
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
}) {
  const { bb, surveyWorktree, removeWorktreeDirectory, invalidateFacts } = input;

  const inspect = async (environmentId: string) => {
    const survey = await surveyWorktree(environmentId);
    return { survey, plan: planWorktreeRemoval(survey) };
  };

  const remove = async (request: WorkspaceRemovalRequest): Promise<WorkspaceRemovalOutcome> => {
    const { environmentId, deleteDirectory, acknowledged } = request;
    const survey = await surveyWorktree(environmentId);
    const plan = planWorktreeRemoval(survey);
    const blocker = removalSubmissionBlocker(plan, { deleteDirectory, acknowledged });
    if (blocker !== null) {
      return {
        ok: false,
        blocker,
        archivedThreads: false,
        environmentRemoved: false,
        directory: "kept",
        message: null,
      };
    }

    await bb.sdk.environments.archiveThreads({ environmentId });

    let environmentRemoved = false;
    try {
      await bb.sdk.environments.delete({ environmentId });
      environmentRemoved = true;
      invalidateFacts();
    } catch (error) {
      return {
        ok: false,
        blocker: null,
        archivedThreads: true,
        environmentRemoved: false,
        directory: "kept",
        message: error instanceof Error ? error.message : String(error),
      };
    }

    if (!deleteDirectory) {
      return {
        ok: true,
        blocker: null,
        archivedThreads: true,
        environmentRemoved,
        directory: "kept",
        message: null,
      };
    }

    const removal = await removeWorktreeDirectory({
      path: survey.path,
      hostId: survey.hostId,
      mainRepoPath: plan.directory.via === "git" ? survey.mainRepoPath : null,
    });
    return {
      ok: true,
      blocker: null,
      archivedThreads: true,
      environmentRemoved,
      directory: removal.directory,
      message: removal.message,
    };
  };

  return { inspect, remove };
}
