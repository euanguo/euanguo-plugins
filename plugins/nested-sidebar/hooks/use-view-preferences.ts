import { useCallback, useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { nestRpcContract } from "@/server";
import { VIEW_PREFERENCE_CHANNEL } from "@/lib/realtime-channels";
import {
  DEFAULT_PROJECT_SORT,
  DEFAULT_THREAD_SORT,
  DEFAULT_WORKTREE_SORT,
  type ProjectSortMode,
  type ThreadSortMode,
  type WorktreeSortMode,
} from "@/lib/sort-modes";
import {
  DEFAULT_ORGANIZATION_MODE,
  type OrganizationMode,
} from "@/lib/organization";
import { defineStoreSnapshot } from "@/lib/store-snapshot";
import { useCoalescedRealtime } from "@/hooks/use-coalesced-realtime";
import {
  VIEW_PREFERENCES_SNAPSHOT_CODEC,
  type ViewPreferencesSnapshot,
} from "@/lib/store-persistence";

// The default sort is a real order, not a neutral one, so an empty seed draws
// the tree in an order the user did not choose until the read lands. Persisted:
// the mode is a standing choice, and a cold start should honour it.
const viewPreferencesSnapshot = defineStoreSnapshot<ViewPreferencesSnapshot>(
  "view-preferences",
  { persist: VIEW_PREFERENCES_SNAPSHOT_CODEC },
);

export interface ViewPreferencesApi {
  readonly projectSort: ProjectSortMode;
  readonly threadSort: ThreadSortMode;
  readonly worktreeSort: WorktreeSortMode;
  /** What the tree's first level is: the user's groups, or their machines. */
  readonly organizationMode: OrganizationMode;
  readonly ready: boolean;
  setProjectSort: (mode: ProjectSortMode) => void;
  setThreadSort: (mode: ThreadSortMode) => void;
  setWorktreeSort: (mode: WorktreeSortMode) => void;
  setOrganizationMode: (mode: OrganizationMode) => void;
}

/**
 * How the tree is ordered, read once and re-read on the plugin's publish.
 *
 * The frontend cannot write `bb.settings`, so these live in the plugin's own
 * store and every change goes through the server. The hook only mirrors it.
 */
export function useViewPreferences(): ViewPreferencesApi {
  const rpc = useRpc<typeof nestRpcContract>();
  const [seed] = useState(() => viewPreferencesSnapshot.read());
  const [projectSort, setProjectSortState] =
    useState<ProjectSortMode>(seed?.projectSort ?? DEFAULT_PROJECT_SORT);
  const [threadSort, setThreadSortState] =
    useState<ThreadSortMode>(seed?.threadSort ?? DEFAULT_THREAD_SORT);
  const [worktreeSort, setWorktreeSortState] = useState<WorktreeSortMode>(
    seed?.worktreeSort ?? DEFAULT_WORKTREE_SORT,
  );
  const [organizationMode, setOrganizationModeState] =
    useState<OrganizationMode>(
      seed?.organizationMode ?? DEFAULT_ORGANIZATION_MODE,
    );
  const [ready, setReady] = useState(seed !== undefined);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    rpc
      .call("getViewPreferences", {})
      .then((result) => {
        if (cancelled) return;
        viewPreferencesSnapshot.write({
          projectSort: result.projectSort,
          threadSort: result.threadSort,
          worktreeSort: result.worktreeSort,
          organizationMode: result.organizationMode,
        });
        setProjectSortState(result.projectSort);
        setThreadSortState(result.threadSort);
        setWorktreeSortState(result.worktreeSort);
        setOrganizationModeState(result.organizationMode);
        setReady(true);
      })
      .catch(() => {
        // The default order is always a safe answer.
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [nonce, rpc]);

  useCoalescedRealtime(VIEW_PREFERENCE_CHANNEL, refresh);

  const setProjectSort = useCallback(
    (mode: ProjectSortMode) => {
      setProjectSortState(mode);
      void rpc
        .call("setViewPreferences", { projectSort: mode })
        .catch(() => refresh());
    },
    [rpc, refresh],
  );

  const setThreadSort = useCallback(
    (mode: ThreadSortMode) => {
      setThreadSortState(mode);
      void rpc
        .call("setViewPreferences", { threadSort: mode })
        .catch(() => refresh());
    },
    [rpc, refresh],
  );

  const setWorktreeSort = useCallback(
    (mode: WorktreeSortMode) => {
      setWorktreeSortState(mode);
      void rpc
        .call("setViewPreferences", { worktreeSort: mode })
        .catch(() => refresh());
    },
    [rpc, refresh],
  );

  const setOrganizationMode = useCallback(
    (mode: OrganizationMode) => {
      setOrganizationModeState(mode);
      void rpc
        .call("setViewPreferences", { organizationMode: mode })
        .catch(() => refresh());
    },
    [rpc, refresh],
  );

  return {
    projectSort,
    threadSort,
    worktreeSort,
    organizationMode,
    ready,
    setProjectSort,
    setThreadSort,
    setWorktreeSort,
    setOrganizationMode,
  };
}
