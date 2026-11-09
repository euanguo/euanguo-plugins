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
  /**
   * The four lifecycle writes, owned by the lifecycle service.
   *
   * They live there rather than here so an agent tool and a row menu perform
   * the same settle: the row order, the archive and the retry prompt are one
   * decision, and a second copy is a second place for a thread to disappear.
   */
  readonly settleThread: (
    threadId: string,
  ) => Promise<{ ok: boolean; archived: boolean }>;
  readonly unsettleThread: (
    threadId: string,
  ) => Promise<{ ok: boolean; message: string | null }>;
  readonly snoozeThread: (
    threadId: string,
    snoozedUntil: number | null,
  ) => Promise<{ ok: boolean; message: string | null }>;
}

export function shelfHandlers(
  deps: ShelfHandlerDeps,
): Handlers<"listLifecycle" | "settle" | "unsettle" | "snooze" | "unsnooze"> {
  return {
    async listLifecycle() {
      return { rows: deps.readAll() };
    },

    async settle({ threadId }) {
      return deps.settleThread(threadId);
    },

    async unsettle({ threadId }) {
      return deps.unsettleThread(threadId);
    },

    async snooze({ threadId, snoozedUntil }) {
      return deps.snoozeThread(threadId, snoozedUntil);
    },

    async unsnooze({ threadId }) {
      return deps.snoozeThread(threadId, null);
    },
  };
}
