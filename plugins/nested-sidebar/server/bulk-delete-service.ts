import type { BbPluginApi } from "@get-bb/plugin-sdk";

import {
  createBulkDeleteCoordinator,
  MAX_BULK_DELETE_THREADS,
  type BulkDeleteFamilySnapshot,
  type BulkDeleteThreadSnapshot,
} from "../lib/bulk-delete.ts";
import type { ThreadReader } from "./thread-reader.ts";
import type { AuthoritativeThreadRow } from "./thread-rows.ts";

export function createBulkDeleteService(input: {
  readonly bb: BbPluginApi;
  readonly threads: ThreadReader;
}) {
  const { bb, threads } = input;

  const toBulkSnapshot = (
    thread: AuthoritativeThreadRow,
  ): BulkDeleteThreadSnapshot => ({
    id: thread.id,
    title:
      thread.title?.trim() ||
      thread.titleFallback?.trim() ||
      "Untitled thread",
    parentThreadId: thread.parentThreadId,
    status: thread.runtime.displayStatus,
    hasPendingInteraction: thread.hasPendingInteraction,
    isPinned: thread.pinnedAt !== null,
    isUnread: thread.latestAttentionAt > (thread.lastReadAt ?? 0),
    activity: {
      workflows: thread.activity.activeWorkflowCount,
      backgroundAgents: thread.activity.activeBackgroundAgentCount,
      backgroundCommands: thread.activity.activeBackgroundCommandCount,
      planMode: thread.activity.activePlanModeCount,
      goals: thread.activity.activeGoalCount,
    },
  });

  const readBulkFamily = async (
    rootId: string,
  ): Promise<BulkDeleteFamilySnapshot | null> => {
    let detail;
    try {
      detail = await bb.sdk.threads.get({ threadId: rootId });
    } catch {
      return null;
    }
    if (detail.deletedAt !== null) return null;

    const projectRows = await threads.listBothArchiveStates({
      projectId: detail.projectId,
    });
    const root = projectRows.find((thread) => thread.id === rootId);
    if (root === undefined || root.deletedAt !== null) return null;

    const descendants: AuthoritativeThreadRow[] = [];
    const visited = new Set([rootId]);
    const parents = [rootId];
    while (parents.length > 0) {
      const parentThreadId = parents.shift();
      if (parentThreadId === undefined) break;
      const children = await threads.listBothArchiveStates({ parentThreadId });
      for (const child of children) {
        if (child.deletedAt !== null || visited.has(child.id)) continue;
        visited.add(child.id);
        descendants.push(child);
        parents.push(child.id);
        if (descendants.length > MAX_BULK_DELETE_THREADS) {
          throw new RangeError(
            `A selected family exceeds ${MAX_BULK_DELETE_THREADS} threads.`,
          );
        }
      }
    }

    const summary = await bb.sdk.threads.childSummary({ threadId: rootId });
    if (summary.nonDeletedChildCount > descendants.length) {
      throw new Error("Could not enumerate every child thread safely.");
    }

    return {
      root: toBulkSnapshot(root),
      descendants: descendants.map(toBulkSnapshot),
    };
  };

  return createBulkDeleteCoordinator({
    readFamily: readBulkFamily,
    async deleteRoot(threadId, childThreadsConfirmed) {
      await bb.sdk.threads.delete({ threadId, childThreadsConfirmed });
    },
    now: () => Date.now(),
    createToken: () => crypto.randomUUID(),
    reportFailure(threadId, error) {
      bb.log.warn(`bulk delete failed for thread ${threadId}: ${String(error)}`);
    },
  });
}
