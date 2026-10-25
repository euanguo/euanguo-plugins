/**
 * A project's newest archived threads, for the shelf under its list.
 *
 * The archive is where finished work goes, and bb's own sidebar view cannot show
 * it — that view is built from queries pinned to `archived: false`, which is the
 * same fact the settled shelf exists for. So recovering a thread you archived a
 * week ago meant a search, even when you knew which project it was in.
 *
 * Three decisions worth stating:
 *
 * - **Per project, on demand.** Only the projects whose shelf is turned on are
 *   read, and the read is bounded by `limit`. A sidebar that read every project's
 *   archive on every mount would pay for a surface almost nobody has open.
 * - **The rows are read, not remembered.** No cache, no snapshot: the shelf is
 *   the one surface where being wrong is worst, because the whole point is
 *   finding something that is *not* on screen.
 * - **Unarchiving goes through the plugin's own `unsettle`.** That is the same
 *   call the settled shelf makes, and it does exactly the right thing for a
 *   thread Nest never settled: it takes bb's archive off the id and clears a row
 *   that is not there. It also means a failure gets the retry prompt the settled
 *   shelf gets, rather than a second, quieter failure path.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useRpc,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import type { nestRpcContract } from "@/server";
import { useCoalescedRealtime } from "@/hooks/use-coalesced-realtime";
import { announceToSidebar } from "@/lib/clipboard";
import { toArchivedThread, type RecoveryThreadRow } from "@/lib/recovery-threads";
import type { WorkspaceEnvironmentDescriptor } from "@/lib/workspace";
import type { WorkspaceOwnershipMap } from "@/lib/workspace-ownership";

export interface ProjectArchivedThreadsApi {
  /** Archived rows per project id, for the projects whose shelf is on. */
  readonly byProject: ReadonlyMap<string, readonly PluginSidebarThread[]>;
  /** Take bb's archive off a thread and drop its row. */
  unarchive(threadId: string): void;
}

export function useProjectArchivedThreads({
  projectIds,
  environments,
  ownership,
  limit,
}: {
  /** The projects whose shelf is on. Empty means nothing is read. */
  projectIds: readonly string[];
  /** Every environment, for deriving the physical rows under each project. */
  environments: Readonly<Record<string, WorkspaceEnvironmentDescriptor>>;
  /** Filesystem ownership when that view is enabled, absent in claimed mode. */
  ownership: WorkspaceOwnershipMap | undefined;
  limit: number;
}): ProjectArchivedThreadsApi {
  const rpc = useRpc<typeof nestRpcContract>();
  const [byProject, setByProject] = useState<
    ReadonlyMap<string, readonly PluginSidebarThread[]>
  >(new Map());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Keyed by value, so an array rebuilt on every render does not re-read. The
  // comparator is explicit rather than `sort()`'s implicit string order: the key
  // is a join on a separator, and a sort that depends on the engine's default is
  // not a thing to leave unsaid.
  const requestByProject = useMemo(
    () =>
      new Map(
        projectIds.map((projectId) => {
          const owned = Object.values(environments).filter(
            (environment) =>
              ownership === undefined
                ? environment.projectId === projectId
                : ownership[environment.id]?.ownerProjectId === projectId,
          );
          const environmentIds = owned.map((environment) => environment.id);
          const actualProjectIds = [
            projectId,
            ...owned.map((environment) => environment.projectId),
          ];
          return [
            projectId,
            {
              projectIds: [...new Set(actualProjectIds)].sort(),
              environmentIds: [...new Set(environmentIds)].sort(),
            },
          ] as const;
        }),
      ),
    [environments, ownership, projectIds],
  );
  const key = [...projectIds]
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    .map((projectId) => {
      const request = requestByProject.get(projectId);
      return request === undefined
        ? projectId
        : [
            projectId,
            request.projectIds.join(","),
            request.environmentIds.join(","),
          ].join("|");
    })
    .join("\u0000");

  // Only the newest read may write: two reads race whenever the shelf is toggled
  // while a read is in flight, and an older answer would restore a row the user
  // just unarchived.
  const sequence = useRef(0);
  const read = useCallback(async () => {
    const ids = key === "" ? [] : key.split("\u0000");
    const current = ++sequence.current;
    if (ids.length === 0) {
      setByProject(new Map());
      return;
    }
    const results = await Promise.all(
      ids.map(
        async (
          encoded,
        ): Promise<readonly [string, readonly PluginSidebarThread[] | null]> => {
          const projectId = encoded.split("|")[0] ?? encoded;
          const request = requestByProject.get(projectId);
          try {
            const result = await rpc.call("listProjectArchivedThreads", {
              projectId,
              ownershipMode:
                ownership === undefined ? "claimed" : "filesystem",
              projectIds: request?.projectIds,
              environmentIds: request?.environmentIds,
              limit,
            });
            return [
              projectId,
              (result.threads as readonly RecoveryThreadRow[]).map(
                toArchivedThread,
              ),
            ] as const;
          } catch {
            // A project whose archive could not be read draws no shelf rather
            // than an empty one: "nothing is archived here" and "we could not
            // look" are different answers, and only one of them is a reason to
            // stop looking.
            return [projectId, null] as const;
          }
        },
      ),
    );
    if (!mounted.current || current !== sequence.current) return;
    const next = new Map<string, readonly PluginSidebarThread[]>();
    for (const [projectId, threads] of results) {
      if (threads !== null) next.set(projectId, threads);
    }
    setByProject(next);
  }, [key, limit, requestByProject, rpc]);

  useEffect(() => {
    void read();
  }, [read]);

  // Unarchiving publishes on the lifecycle channel, so the shelf re-reads itself
  // rather than depending on the caller to remember to refresh it.
  useCoalescedRealtime("lifecycle", read);

  const unarchive = useCallback(
    (threadId: string) => {
      // Optimistic, and only for the row: the thread is leaving this shelf
      // whatever the host answers, and the settled shelf owns the failure prompt.
      setByProject((current) => {
        const next = new Map<string, readonly PluginSidebarThread[]>();
        for (const [projectId, threads] of current) {
          next.set(
            projectId,
            threads.filter((thread) => thread.id !== threadId),
          );
        }
        return next;
      });
      // The row has already gone, so a silent failure here is a thread that
      // vanished from the shelf and did not come back anywhere. The backend
      // raises its own retry prompt when the unarchive itself fails, and that
      // prompt is not always raised (it can time out, or be dismissed) — so the
      // outcome is announced as well rather than assumed.
      void rpc
        .call("unsettle", { threadId })
        .then((result) => {
          if (result.message !== null) {
            announceToSidebar(
              `Could not unarchive this thread: ${result.message}. It is still in bb's archived view.`,
            );
          }
        })
        .catch(() => {
          announceToSidebar("Could not restore this thread.");
        });
    },
    [rpc],
  );

  return { byProject, unarchive };
}
