/**
 * Pinned threads: the order bb holds, and the one call that moves a pin.
 *
 * The order is bb's own `pinSortKey` compared by codepoint — not by locale,
 * because the host compares those keys as byte strings and a locale-aware sort
 * would order them differently on a machine whose locale disagreed.
 */
import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import type { harborRpcContract } from "../contract.ts";
import type { ThreadPage } from "../thread-reader.ts";

/** This module's slice of the contract, with every other method omitted. */
type Handlers<Method extends keyof typeof harborRpcContract> = Pick<
  PluginRpcHandlers<typeof harborRpcContract>,
  Method
>;

export interface PinnedHandlerDeps {
  readonly bb: BbPluginApi;
  readonly listVisibleThreadRows: () => Promise<ThreadPage>;
  readonly compareCodepoints: (left: string, right: string) => number;
}

export function pinnedHandlers(
  deps: PinnedHandlerDeps,
): Handlers<"listPinnedOrder" | "reorderPinned"> {
  const { bb, listVisibleThreadRows, compareCodepoints } = deps;

  return {
    /**
     * bb's own pin order, newest-pinned last.
     *
     * The comparison is bb's: the pin sort key, compared by codepoint. That is
     * what the key is for — it survives re-pinning without renumbering the rows
     * around it — and matching it is what keeps this list in the same order as
     * the built-in sidebar. A row pinned before the key existed falls back to
     * the pin time, newest first, so it is ordered rather than dropped.
     */
    async listPinnedOrder() {
      const { rows, truncated } = await listVisibleThreadRows();
      const pinned = rows.filter((row) => row.pinnedAt !== null);
      pinned.sort((left, right) => {
        const leftKey = left.pinSortKey;
        const rightKey = right.pinSortKey;
        if (leftKey !== null && rightKey !== null) {
          return compareCodepoints(leftKey, rightKey);
        }
        if (leftKey !== null) return -1;
        if (rightKey !== null) return 1;
        return (right.pinnedAt ?? 0) - (left.pinnedAt ?? 0);
      });
      return {
        threadIds: pinned.map((row) => row.id),
        ...(truncated ? { truncated: true } : {}),
      };
    },

    async reorderPinned({ threadId, previousThreadId, nextThreadId }) {
      await bb.sdk.threads.reorderPinned({
        threadId,
        previousThreadId,
        nextThreadId,
      });
      return { ok: true };
    },
  };
}
