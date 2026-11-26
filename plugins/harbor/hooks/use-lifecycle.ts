import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk";
import type { harborRpcContract } from "@/server/contract";
import {
  canPark,
  hasExpiredSnoozeSince,
  nextWakeDelayMs,
  resolveShelf,
  rowsMatch,
  wokenSettledThreadIds,
  type ThreadActivitySignals,
  type ThreadLifecycleRow,
  type ThreadShelf,
} from "@/lib/domain/lifecycle";
import { readWarmStartRows, writeWarmStartRows } from "@/lib/persistence/warm-start";
import { useRealtimeRpcStore } from "@/hooks/use-realtime-rpc-store";
import { threadIsWorking } from "@/lib/domain/inbox";
import { announceToSidebar } from "@/lib/ui/clipboard";

function signalsFor(thread: PluginSidebarThread): ThreadActivitySignals {
  return {
    hasPendingInteraction: thread.hasPendingInteraction,
    isWorking: threadIsWorking(thread),
    isUnread: thread.isUnread,
    latestAttentionAt: thread.latestAttentionAt,
  };
}

export interface LifecycleApi {
  shelfFor(thread: PluginSidebarThread): ThreadShelf;
  parkedThreadIds: ReadonlySet<string>;
  parkedRows: ReadonlyMap<string, ThreadLifecycleRow>;
  shelvesReady: boolean;
  canPark(thread: PluginSidebarThread): boolean;
  wakeAtFor(thread: PluginSidebarThread): number | null;
  settle(threadId: string): void;
  unsettle(threadId: string): void;
  snooze(threadId: string, snoozedUntil: number): void;
  unsnooze(threadId: string): void;
}

const SHELF_GATE_MS = 250;

function useLifecycleSnapshot({ persist = true }: { persist?: boolean } = {}) {
  const rpc = useRpc<typeof harborRpcContract>();
  const [seededRows] = useState(() => readWarmStartRows());
  const [rows, setRows] = useState<ReadonlyMap<string, ThreadLifecycleRow>>(
    () => new Map((seededRows ?? []).map((row) => [row.threadId, row])),
  );
  const [now, setNow] = useState(() => Date.now());
  const [shelvesReady, setShelvesReady] = useState(seededRows !== null);
  const [serverRowsLoaded, setServerRowsLoaded] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const read = useCallback(
    async (isCurrent: () => boolean) => {
      try {
        const result = await rpc.call("listLifecycle", {});
        if (!isCurrent()) return;
        setRows((current) =>
          rowsMatch(current, result.rows)
            ? current
            : new Map(result.rows.map((row) => [row.threadId, row])),
        );
        setServerRowsLoaded(true);
        if (mountedRef.current && persist) writeWarmStartRows(result.rows);
      } catch (error) {
        if (!isCurrent()) return;
        throw error;
      } finally {
        setShelvesReady(true);
      }
    },
    [persist, rpc],
  );
  useRealtimeRpcStore({ channel: "lifecycle", read });

  useEffect(() => {
    if (shelvesReady) return;
    const timer = setTimeout(() => setShelvesReady(true), SHELF_GATE_MS);
    return () => clearTimeout(timer);
  }, [shelvesReady]);

  useEffect(() => {
    const armedAt = Date.now();
    const snoozedUntilValues = [...rows.values()].flatMap((row) =>
      row.snoozedUntil === null ? [] : [row.snoozedUntil],
    );
    if (hasExpiredSnoozeSince(snoozedUntilValues, now, armedAt)) {
      setNow(armedAt);
      return;
    }
    const delay = nextWakeDelayMs(snoozedUntilValues, armedAt);
    if (delay === null) return;
    const timer = setTimeout(() => setNow(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [now, rows]);

  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") return;
    const wakeIfElapsed = () => {
      if (document.visibilityState === "hidden") return;
      const current = Date.now();
      const snoozedUntilValues = [...rows.values()].flatMap((row) =>
        row.snoozedUntil === null ? [] : [row.snoozedUntil],
      );
      if (hasExpiredSnoozeSince(snoozedUntilValues, now, current)) setNow(current);
    };
    document.addEventListener("visibilitychange", wakeIfElapsed);
    window.addEventListener("focus", wakeIfElapsed);
    return () => {
      document.removeEventListener("visibilitychange", wakeIfElapsed);
      window.removeEventListener("focus", wakeIfElapsed);
    };
  }, [now, rows]);

  const parkedThreadIds = useMemo(() => new Set(rows.keys()), [rows]);
  return { rows, now, shelvesReady, serverRowsLoaded, parkedThreadIds };
}

export interface ThreadShelvesApi {
  shelfFor(thread: PluginSidebarThread): ThreadShelf;
  canPark(thread: PluginSidebarThread): boolean;
  shelvesReady: boolean;
}

/** Classify threads without subscribing to lifecycle mutations. */
export function useThreadShelves(): ThreadShelvesApi {
  const { rows, now, shelvesReady } = useLifecycleSnapshot({ persist: false });
  return useMemo(
    () => ({
      shelfFor: (thread) => resolveShelf(rows.get(thread.id), signalsFor(thread), now),
      canPark: (thread) => canPark(signalsFor(thread)),
      shelvesReady,
    }),
    [now, rows, shelvesReady],
  );
}

/**
 * Reads Harbor's lifecycle store, wakes settled threads with new activity, and
 * exposes settle/unsettle/snooze/unsnooze actions.
 */
export function useLifecycle(threads: readonly PluginSidebarThread[]): LifecycleApi {
  const { rows, now, shelvesReady, serverRowsLoaded, parkedThreadIds } = useLifecycleSnapshot();
  const rpc = useRpc<typeof harborRpcContract>();

  const wakingRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!serverRowsLoaded) return;
    const threadById = new Map(threads.map((thread) => [thread.id, thread]));
    const woken = wokenSettledThreadIds(
      rows.values(),
      (threadId) => {
        const thread = threadById.get(threadId);
        return thread === undefined ? undefined : signalsFor(thread);
      },
      now,
    );
    for (const threadId of woken) {
      if (wakingRef.current.has(threadId)) continue;
      wakingRef.current.add(threadId);
      void rpc
        .call("unsettle", { threadId })
        .catch(() => {})
        .finally(() => wakingRef.current.delete(threadId));
    }
  }, [now, rows, rpc, serverRowsLoaded, threads]);

  return useMemo<LifecycleApi>(() => {
    const settle = async (threadId: string) => {
      try {
        const result = await rpc.call("settle", { threadId });
        if (!result.archived) {
          announceToSidebar("Settled, but bb could not archive this thread. It stays on the shelf here.");
        }
      } catch {
        announceToSidebar("Could not settle this thread.");
      }
    };
    const unsettle = async (threadId: string) => {
      try {
        const result = await rpc.call("unsettle", { threadId });
        if (result.message !== null) {
          announceToSidebar(`Could not unarchive this thread: ${result.message}. It is still in bb's archived view.`);
        }
      } catch {
        announceToSidebar("Could not restore this thread.");
      }
    };
    const snooze = async (threadId: string, snoozedUntil: number) => {
      try {
        const result = await rpc.call("snooze", { threadId, snoozedUntil });
        if (!result.ok) {
          announceToSidebar(`Could not snooze this thread: ${result.message ?? "the archive could not be taken back"}.`);
        }
      } catch {
        announceToSidebar("Could not snooze this thread.");
      }
    };
    return {
      shelfFor: (thread) => resolveShelf(rows.get(thread.id), signalsFor(thread), now),
      parkedThreadIds,
      parkedRows: rows,
      shelvesReady,
      canPark: (thread) => canPark(signalsFor(thread)),
      wakeAtFor: (thread) => rows.get(thread.id)?.snoozedUntil ?? null,
      settle: (threadId) => void settle(threadId),
      unsettle: (threadId) => void unsettle(threadId),
      unsnooze: (threadId) => void rpc.call("unsnooze", { threadId }),
      snooze: (threadId, snoozedUntil) => void snooze(threadId, snoozedUntil),
    };
  }, [now, parkedThreadIds, rows, rpc, shelvesReady]);
}
