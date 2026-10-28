import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";

import { parseArchivedThreadIds } from "../lib/lifecycle.ts";
import { LIFECYCLE_CHANNEL } from "../lib/realtime-channels.ts";
import {
  UNARCHIVE_RETRY_RENDERER_ID,
  UNARCHIVE_RETRY_TIMEOUT_MS,
  unarchiveRetryApproved,
  unarchiveRetryPayload,
} from "../lib/unarchive-retry.ts";
import type { StoredLifecycleRow } from "./lifecycle-store.ts";

interface LifecycleDbRow {
  thread_id: string;
  settled_at: number | null;
  snoozed_until: number | null;
  snoozed_at: number | null;
  archived_thread_ids: string | null;
}

export function createLifecycleService(input: {
  readonly bb: BbPluginApi;
  readonly db: Database.Database;
}) {
  const { bb, db } = input;

  const readAll = (): StoredLifecycleRow[] =>
    (
      db
        .prepare(
          `SELECT thread_id, settled_at, snoozed_until, snoozed_at,
                  archived_thread_ids
             FROM thread_lifecycle`,
        )
        .all() as LifecycleDbRow[]
    ).map(toStoredRow);

  const readOne = (threadId: string): StoredLifecycleRow | undefined => {
    const row = db
      .prepare(
        `SELECT thread_id, settled_at, snoozed_until, snoozed_at,
                archived_thread_ids
           FROM thread_lifecycle
          WHERE thread_id = ?`,
      )
      .get(threadId) as LifecycleDbRow | undefined;
    return row === undefined ? undefined : toStoredRow(row);
  };

  const write = (row: StoredLifecycleRow): void => {
    db.prepare(
      `INSERT INTO thread_lifecycle
         (thread_id, settled_at, snoozed_until, snoozed_at, archived_thread_ids)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(thread_id) DO UPDATE SET
         settled_at = excluded.settled_at,
         snoozed_until = excluded.snoozed_until,
         snoozed_at = excluded.snoozed_at,
         archived_thread_ids = excluded.archived_thread_ids`,
    ).run(
      row.threadId,
      row.settledAt,
      row.snoozedUntil,
      row.snoozedAt,
      row.archivedThreadIds.length === 0
        ? null
        : JSON.stringify(row.archivedThreadIds),
    );
    bb.realtime.publish(LIFECYCLE_CHANNEL, { threadId: row.threadId });
  };

  const clear = (threadId: string): void => {
    db.prepare(`DELETE FROM thread_lifecycle WHERE thread_id = ?`).run(
      threadId,
    );
    bb.realtime.publish(LIFECYCLE_CHANNEL, { threadId });
  };

  const archiveThread = async (threadId: string): Promise<string[]> => {
    try {
      const result = await bb.sdk.threads.archive({ threadId });
      const ids = result.archivedThreadIds ?? [];
      return ids.includes(threadId) ? ids : [...ids, threadId];
    } catch (error) {
      bb.log.warn(`archive failed for thread ${threadId}: ${String(error)}`);
      return [];
    }
  };

  const unarchiveThreads = async (
    threadIds: readonly string[],
  ): Promise<string | null> => {
    let failure: string | null = null;
    for (const threadId of threadIds) {
      try {
        await bb.sdk.threads.unarchive({ threadId });
      } catch (error) {
        bb.log.warn(`unarchive failed for thread ${threadId}: ${String(error)}`);
        failure ??=
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : String(error);
      }
    }
    return failure;
  };

  const askToRetryUnarchive = async (
    threadId: string,
    message: string,
  ): Promise<boolean> => {
    try {
      const payload = unarchiveRetryPayload({ threadId, message });
      const result = await bb.ui.requestInput({
        threadId,
        rendererId: UNARCHIVE_RETRY_RENDERER_ID,
        title: "Could not bring this thread back",
        payload: { threadId: payload.threadId, message: payload.message },
        timeoutMs: UNARCHIVE_RETRY_TIMEOUT_MS,
      });
      return unarchiveRetryApproved(result);
    } catch (error) {
      bb.log.warn(`could not ask about the unarchive: ${String(error)}`);
      return false;
    }
  };

  const archivedIdsFor = (threadId: string): string[] => {
    const stored = readOne(threadId)?.archivedThreadIds ?? [];
    return stored.length === 0 ? [threadId] : stored;
  };

  return {
    readAll,
    readOne,
    write,
    clear,
    archiveThread,
    unarchiveThreads,
    askToRetryUnarchive,
    archivedIdsFor,
  };
}

function toStoredRow(row: LifecycleDbRow): StoredLifecycleRow {
  return {
    threadId: row.thread_id,
    settledAt: row.settled_at,
    snoozedUntil: row.snoozed_until,
    snoozedAt: row.snoozed_at,
    archivedThreadIds: parseArchivedThreadIds(row.archived_thread_ids),
  };
}
