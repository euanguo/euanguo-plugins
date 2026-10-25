import { useCallback, useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { nestRpcContract } from "@/server";
import { ORDER_CHANNEL } from "@/lib/realtime-channels";
import type { ManualOrderMap } from "@/lib/manual-order";
import { clearFamilyOrder, readFamilyOrder } from "@/lib/family-order";
import { clearProjectOrder, readProjectOrder } from "@/lib/project-order";
import { defineStoreSnapshot } from "@/lib/store-snapshot";
import { useCoalescedRealtime } from "@/hooks/use-coalesced-realtime";
import {
  ORDER_SNAPSHOT_CODEC,
  type OrderSnapshot,
} from "@/lib/store-persistence";

// A manual arrangement that is not there yet reads as the default order, so an
// empty seed re-sorts the whole tree until the read lands. Persisted, for the
// same reason the groups are: an arrangement is the user's own work and a cold
// start should not undo it on screen.
const orderSnapshot = defineStoreSnapshot<OrderSnapshot>("manual-order", {
  persist: ORDER_SNAPSHOT_CODEC,
});

export interface NestOrderApi {
  /** Group scope key -> project ids. */
  readonly projects: ManualOrderMap;
  /** Project id -> root thread ids. */
  readonly families: ManualOrderMap;
  /** Project id -> worktree keys, in the order they are drawn. */
  readonly workspaces: ManualOrderMap;
  readonly ready: boolean;
  /**
   * True when this client's arrangement is not the one the server holds.
   *
   * A write built on a stale revision is refused rather than merged, so the
   * screen is showing an order nobody else has. It is a state to tell the user
   * about, not an error to log.
   */
  readonly changedElsewhere: boolean;
  /** Take the server's arrangement and clear the stale state. */
  reload: () => void;
  reorderProjects: (
    groupId: string,
    projectIds: readonly string[],
  ) => Promise<boolean>;
  reorderFamilies: (
    projectId: string,
    rootIds: readonly string[],
  ) => Promise<boolean>;
  reorderWorkspaces: (
    projectId: string,
    workspaceKeys: readonly string[],
  ) => Promise<boolean>;
  refresh: () => void;
}

function isEmptyOrder(
  projects: ManualOrderMap,
  families: ManualOrderMap,
  workspaces: ManualOrderMap,
): boolean {
  return (
    Object.keys(projects).length === 0 &&
    Object.keys(families).length === 0 &&
    Object.keys(workspaces).length === 0
  );
}

/**
 * The manual arrangement, read from the server and re-read on its publish.
 *
 * The one piece of migration lives here: the first build that sees an empty
 * server store pushes the old browser-local order up, so an arrangement made
 * before this existed is not silently lost. It runs once — the seed refuses to
 * write over existing rows, and the legacy keys are cleared on success.
 */
export function useNestOrder(): NestOrderApi {
  const rpc = useRpc<typeof nestRpcContract>();
  const [seed] = useState(() => orderSnapshot.read());
  const [projects, setProjects] = useState<ManualOrderMap>(seed?.projects ?? {});
  const [families, setFamilies] = useState<ManualOrderMap>(seed?.families ?? {});
  const [workspaces, setWorkspaces] = useState<ManualOrderMap>(
    seed?.workspaces ?? {},
  );
  const [ready, setReady] = useState(seed !== undefined);
  const [nonce, setNonce] = useState(0);
  const [changedElsewhere, setChangedElsewhere] = useState(false);
  /**
   * The revision the next write should be built on.
   *
   * A ref rather than the state: a write reads it at the moment the user drops a
   * row, and a value closed over by the handler would be the revision of the
   * render that created it.
   */
  const revisionRef = useRef(0);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await rpc.call("listManualOrder", {});
        if (cancelled) return;
        if (
          isEmptyOrder(result.projects, result.families, result.workspaces)
        ) {
          const seeded = await seedLegacyOrder(rpc);
          if (cancelled) return;
          if (seeded !== null) {
            orderSnapshot.write({
              projects: seeded.projects,
              families: seeded.families,
              workspaces: {},
            });
            setProjects(seeded.projects);
            setFamilies(seeded.families);
            setReady(true);
            return;
          }
        }
        orderSnapshot.write({
          projects: result.projects,
          families: result.families,
          workspaces: result.workspaces,
        });
        revisionRef.current = result.revision;
        setProjects(result.projects);
        setFamilies(result.families);
        setWorkspaces(result.workspaces);
        setReady(true);
        // `changedElsewhere` is deliberately not cleared here. A read follows a
        // refused write as well as a reload, so clearing it here would hide the
        // notice the refusal had just raised.
      } catch {
        // A failed read must not blank the tree: everything still renders, in
        // the default order, until the next read succeeds.
        if (!cancelled) setReady(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [nonce, rpc]);

  useCoalescedRealtime(ORDER_CHANNEL, refresh);

  /**
   * One write, whatever scope it is for.
   *
   * The echo of the move happens first so a drag does not wait on a round trip,
   * and is taken back when the write did not land — a stale refusal means the
   * echoed order is not the one the server holds, and leaving it on screen would
   * show an arrangement that does not exist.
   */
  const writeOrder = useCallback(
    async <T extends { ok: boolean; stale: boolean; revision: number }>(
      send: (baseRevision: number) => Promise<T>,
    ): Promise<boolean> => {
      try {
        const result = await send(revisionRef.current);
        revisionRef.current = result.revision;
        if (result.ok) setChangedElsewhere(false);
        else if (result.stale) setChangedElsewhere(true);
        if (!result.ok) refresh();
        return result.ok;
      } catch (error) {
        refresh();
        throw error;
      }
    },
    [refresh],
  );

  const reorderProjects = useCallback(
    (groupId: string, projectIds: readonly string[]) => {
      const next = [...projectIds];
      setProjects((current) => ({ ...current, [groupId]: next }));
      return writeOrder((baseRevision) =>
        rpc.call("reorderProjects", { groupId, projectIds: next, baseRevision }),
      );
    },
    [rpc, writeOrder],
  );

  const reorderWorkspaces = useCallback(
    (projectId: string, workspaceKeys: readonly string[]) => {
      const next = [...workspaceKeys];
      setWorkspaces((current) => ({ ...current, [projectId]: next }));
      return writeOrder((baseRevision) =>
        rpc.call("reorderWorkspaces", {
          projectId,
          workspaceKeys: next,
          baseRevision,
        }),
      );
    },
    [rpc, writeOrder],
  );

  const reorderFamilies = useCallback(
    (projectId: string, rootIds: readonly string[]) => {
      const next = [...rootIds];
      setFamilies((current) => ({ ...current, [projectId]: next }));
      return writeOrder((baseRevision) =>
        rpc.call("reorderFamilies", { projectId, rootIds: next, baseRevision }),
      );
    },
    [rpc, writeOrder],
  );

  const reload = useCallback(() => {
    setChangedElsewhere(false);
    refresh();
  }, [refresh]);

  return {
    projects,
    families,
    workspaces,
    ready,
    changedElsewhere,
    reorderProjects,
    reorderFamilies,
    reorderWorkspaces,
    reload,
    refresh,
  };
}

async function seedLegacyOrder(
  rpc: ReturnType<typeof useRpc<typeof nestRpcContract>>,
): Promise<{ projects: ManualOrderMap; families: ManualOrderMap } | null> {
  const legacyProjects = readProjectOrder();
  const legacyFamilies = readFamilyOrder();
  const familyEntries: Array<[string, string[]]> = Object.entries(
    legacyFamilies,
  ).map(([projectId, rootIds]) => [projectId, [...rootIds]]);
  if (legacyProjects.length === 0 && familyEntries.length === 0) return null;
  try {
    const seeded = await rpc.call("seedManualOrder", {
      projectIds: legacyProjects,
      families: Object.fromEntries(familyEntries),
    });
    if (!seeded.ok) return null;
    clearProjectOrder();
    clearFamilyOrder();
    const fresh = await rpc.call("listManualOrder", {});
    return { projects: fresh.projects, families: fresh.families };
  } catch {
    // Keep the legacy keys: the next load can try again.
    return null;
  }
}
