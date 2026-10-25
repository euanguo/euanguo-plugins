/**
 * bb's own pin order, and the write that keeps it.
 *
 * `PluginSidebarThread` says whether a thread is pinned and nothing else about
 * the pin, so the order cannot be derived from the host view — a section ordered
 * from that array would be ordered by whatever the array happened to be in. The
 * key lives on bb's own row, so the read goes through the plugin's backend.
 *
 * The write goes the same way, and that is the point: `bb.sdk.threads
 * .reorderPinned` is the mutation bb's built-in sidebar drags by, so a pin moved
 * here is in the same place there. A private order would make the two surfaces
 * disagree, which is worse than having no pinned section at all.
 *
 * When it re-reads, and why not on every render:
 *
 * - **On mount**, for the first order.
 * - **When the set of pinned roots changes**, which is the case a local pin or
 *   unpin produces — and the one where a stale order would put a new pin in an
 *   arbitrary slot.
 * - **When the window comes back to the front**, because another client can
 *   reorder pins without changing which ones exist, and nothing else would tell
 *   this one. The workspace-path read uses the same trigger for the same reason.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { nestRpcContract } from "@/server";
import { pinnedNeighbours } from "@/lib/pinned";

export interface PinnedOrderApi {
  /** Root ids in bb's own pin order. Empty until the first read lands. */
  readonly order: readonly string[];
  /** Place a pinned root against another, writing bb's order. */
  move(input: {
    sourceId: string;
    targetId: string;
    position: "before" | "after";
  }): void;
}

export function usePinnedOrder(pinnedIdsKey: string): PinnedOrderApi {
  const rpc = useRpc<typeof nestRpcContract>();
  const [order, setOrder] = useState<readonly string[]>([]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Only the newest read may write: a move's own re-read can race the one the
  // id-set change triggered, and an older answer would put the row back.
  const sequence = useRef(0);
  const read = useCallback(async () => {
    const current = ++sequence.current;
    try {
      const result = await rpc.call("listPinnedOrder", {});
      if (!mounted.current || current !== sequence.current) return;
      setOrder(result.threadIds);
    } catch {
      // A failed read leaves the order as it was. The section still draws every
      // pinned row — `orderPinnedFamilies` appends what the order does not name
      // — so the failure costs a position, never a row.
    }
  }, [rpc]);

  useEffect(() => {
    void read();
  }, [read, pinnedIdsKey]);

  useEffect(() => {
    const wake = () => void read();
    window.addEventListener("focus", wake);
    return () => window.removeEventListener("focus", wake);
  }, [read]);

  /**
   * The order as of the last read, for the drop handler.
   *
   * A drop is answered against the list the user was looking at, not against the
   * closure the callback was created with: a read that landed between the drag
   * and the drop would otherwise move the row against a stale list.
   */
  const orderRef = useRef(order);
  orderRef.current = order;

  const move = useCallback(
    (input: {
      sourceId: string;
      targetId: string;
      position: "before" | "after";
    }) => {
      void (async () => {
        const neighbours = pinnedNeighbours({
          orderedIds: orderRef.current,
          sourceId: input.sourceId,
          targetId: input.targetId,
          position: input.position,
        });
        if (neighbours === null) return;
        try {
          await rpc.call("reorderPinned", {
            threadId: input.sourceId,
            previousThreadId: neighbours.previousThreadId,
            nextThreadId: neighbours.nextThreadId,
          });
        } catch {
          // The host refused, so nothing moved; the next read shows the order it
          // actually holds rather than the one this client asked for.
        }
        await read();
      })();
    },
    [read, rpc],
  );

  return { order, move };
}