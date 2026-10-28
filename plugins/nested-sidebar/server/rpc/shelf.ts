/**
 * The settled / snoozed shelf: the four writes and the read that draws it.
 *
 * "Settled" and "archived" are the same statement, so each write here moves two
 * things — the plugin's row and bb's archive — in an order chosen so a failure
 * leaves the thread visible rather than gone. That ordering is the whole reason
 * this module exists as its own subject.
 */
import type { PluginRpcHandlers } from "@get-bb/plugin-sdk";
import type { nestRpcContract } from "../contract.ts";

/** This module's slice of the contract, with every other method omitted. */
type Handlers<Method extends keyof typeof nestRpcContract> = Pick<
  PluginRpcHandlers<typeof nestRpcContract>,
  Method
>;
import type { StoredLifecycleRow } from "../lifecycle-store.ts";

export interface ShelfHandlerDeps {
  readonly readAll: () => StoredLifecycleRow[];
  readonly readOne: (threadId: string) => StoredLifecycleRow | undefined;
  readonly write: (row: StoredLifecycleRow) => void;
  readonly clear: (threadId: string) => void;
  readonly archiveThread: (threadId: string) => Promise<string[]>;
  readonly unarchiveThreads: (
    threadIds: readonly string[],
  ) => Promise<string | null>;
  readonly askToRetryUnarchive: (
    threadId: string,
    message: string,
  ) => Promise<boolean>;
  readonly archivedIdsFor: (threadId: string) => string[];
}

export function shelfHandlers(
  deps: ShelfHandlerDeps,
): Handlers<"listLifecycle" | "settle" | "unsettle" | "snooze" | "unsnooze"> {
  const {
    readAll,
    readOne,
    write,
    clear,
    archiveThread,
    unarchiveThreads,
    askToRetryUnarchive,
    archivedIdsFor,
  } = deps;

  return {
    async listLifecycle() {
      return { rows: readAll() };
    },

    async settle({ threadId }) {
      // Settling clears any snooze: they are two answers to the same
      // question, and holding both would make the shelf order ambiguous.
      write({
        threadId,
        settledAt: Date.now(),
        snoozedUntil: null,
        snoozedAt: null,
        archivedThreadIds: [],
      });
      // The row first, then the archive. A settled thread stays on screen
      // only because its row says so, so archiving first would blink it out
      // of the list until the row landed.
      const archivedThreadIds = await archiveThread(threadId);
      if (archivedThreadIds.length > 0) {
        // Second write, second publish — and the publish is the point. bb has
        // just evicted the thread from the host's sidebar view, so this is
        // what tells the frontend to fetch it back from `listSettledThreads`.
        // Re-read rather than re-derive: a user who restored the thread while
        // the archive was in flight must not have their un-settle overwritten
        // by the settle that started before it.
        const row = readOne(threadId);
        if (row !== undefined && row.settledAt !== null) {
          write({ ...row, archivedThreadIds });
        }
      }
      return { ok: true, archived: archivedThreadIds.length > 0 };
    },

    async unsettle({ threadId }) {
      // The archive first, then the row — the mirror of settle, for the same
      // reason: clearing the row while the thread is still archived would
      // drop it out of the sidebar entirely.
      const ids = archivedIdsFor(threadId);
      let failure = await unarchiveThreads(ids);
      if (failure !== null && (await askToRetryUnarchive(threadId, failure))) {
        // One retry, on the user's word. A second failure is logged like the
        // first and the row is cleared as before — the thread is still in bb's
        // archived view, which is where the README has always pointed.
        failure = await unarchiveThreads(ids);
      }
      clear(threadId);
      return { ok: true, message: failure };
    },

    async snooze({ threadId, snoozedUntil }) {
      const now = Date.now();
      // Snoozing a settled thread takes the archive back first: a snoozed row
      // is not on the settled shelf, so the thread has nowhere to be drawn
      // until bb reports it again.
      //
      // A failure here is the one lifecycle path that can lose a thread. The
      // host's sidebar view is built from `archived: false`, so a thread that
      // stays archived is in neither the tree nor `listSettledThreads` — while
      // the row would say it is snoozed. Nothing would draw it again until bb
      // unarchived it by hand. So the row is not written, and the failure is
      // reported instead of the thread disappearing.
      const failure = await unarchiveThreads(archivedIdsFor(threadId));
      if (failure !== null) return { ok: false, message: failure };
      write({
        threadId,
        settledAt: null,
        snoozedUntil,
        snoozedAt: now,
        archivedThreadIds: [],
      });
      return { ok: true, message: null };
    },

    async unsnooze({ threadId }) {
      clear(threadId);
      return { ok: true };
    },
  };
}
