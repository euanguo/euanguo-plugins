import { useCallback, useMemo, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk";
import type { harborRpcContract } from "@/server/contract";
import {
  isWithinSettledWindow,
  toSidebarThread,
  type SettledThreadRow,
} from "@/lib/domain/settled-threads";
import { useRealtimeRpcStore } from "@/hooks/use-realtime-rpc-store";
import { defineStoreSnapshot } from "@/lib/persistence/snapshot";

const EMPTY: readonly SettledThreadRow[] = [];
const settledThreadsSnapshot =
  defineStoreSnapshot<readonly SettledThreadRow[]>("settled-threads");

export interface SettledThreadsApi {
  /** Settled threads, cut to the window against the caller's clock. */
  threads: readonly PluginSidebarThread[];
  /** Whether `listSettledThreads` still owes this mount a resolved answer. */
  rowsPending: boolean;
}

/**
 * Fetches settled threads from Harbor's backend and cuts them against `now`.
 */
export function useSettledThreads(now: number): SettledThreadsApi {
  const rpc = useRpc<typeof harborRpcContract>();
  const [rows, setRows] = useState<readonly SettledThreadRow[]>(
    () => settledThreadsSnapshot.read() ?? EMPTY,
  );
  const [rowsPending, setRowsPending] = useState(true);

  const read = useCallback(
    async (isCurrent: () => boolean) => {
      setRowsPending(true);
      try {
        const result = await rpc.call("listSettledThreads", {});
        if (!isCurrent()) return;
        setRows(result.threads);
        settledThreadsSnapshot.write(result.threads);
        setRowsPending(false);
      } catch (error) {
        if (!isCurrent()) return;
        throw error;
      }
    },
    [rpc],
  );
  useRealtimeRpcStore({ channel: "lifecycle", read });

  const threads = useMemo(
    () => rows.filter((row) => isWithinSettledWindow(row.settledAt, now)).map(toSidebarThread),
    [now, rows],
  );

  return useMemo(() => ({ threads, rowsPending }), [rowsPending, threads]);
}
