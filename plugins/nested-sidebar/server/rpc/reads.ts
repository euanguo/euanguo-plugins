/**
 * The three lists bb's own sidebar view cannot answer.
 *
 * A settled thread is archived, and bb's list is pinned to `archived: false`, so
 * it is invisible to the view this plugin replaces. The same is true of a
 * project's archive and of the recovery read that fills in when the host view
 * has failed. All three build their answers from the shared thread reader.
 */
import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import type { nestRpcContract } from "../contract.ts";

/** This module's slice of the contract, with every other method omitted. */
type Handlers<Method extends keyof typeof nestRpcContract> = Pick<
  PluginRpcHandlers<typeof nestRpcContract>,
  Method
>;
import type { StoredLifecycleRow } from "../lifecycle-store.ts";
import { isWithinSettledWindow } from "../../lib/settled-threads.ts";
import {
  toThreadWireFields,
  toThreadWireRow,
  type ThreadReader,
} from "../thread-reader.ts";

export interface ReadHandlerDeps {
  readonly bb: BbPluginApi;
  readonly readAll: () => StoredLifecycleRow[];
  readonly threads: ThreadReader;
}

export function readHandlers(
  deps: ReadHandlerDeps,
): Handlers<"listSettledThreads" | "listThreadsForRecovery" | "listProjectArchivedThreads"> {
  const {
    bb,
    readAll,
    threads,
  } = deps;

  return {
    /**
     * The archived threads this plugin settled in the last day, and only
     * those. A thread the user archived through bb itself has no row here and
     * stays out of the sidebar, exactly as it did before any of this existed;
     * one settled longer ago than the window keeps its row and its archive and
     * simply stops being drawn.
     *
     * The window is applied here as well as on the frontend. The frontend's is
     * the live one — it re-cuts on its own clock, so a row ages off screen
     * without a refetch — and this one keeps the response proportional to the
     * shelf instead of to the whole archive.
     */
    async listSettledThreads() {
      const now = Date.now();
      const settledAtById = new Map<string, number>();
      for (const row of readAll()) {
        if (
          row.settledAt !== null &&
          isWithinSettledWindow(row.settledAt, now)
        ) {
          settledAtById.set(row.threadId, row.settledAt);
        }
      }
      if (settledAtById.size === 0) return { threads: [] };
      let archived;
      try {
        archived = await threads.listArchivedThreads();
      } catch (error) {
        // The shelf keeps whatever the frontend already had rather than
        // emptying itself over one failed read.
        bb.log.warn(`listing archived threads failed: ${String(error)}`);
        throw error;
      }
      return {
        threads: archived
          .filter((thread) => settledAtById.has(thread.id))
          .map((thread) => ({
            // Non-null by construction: the id came from this map.
            settledAt: settledAtById.get(thread.id) ?? 0,
            ...toThreadWireFields(thread),
          })),
      };
    },

    /**
     * The live view, read from bb's SDK.
     *
     * The rows the host's cache holds, read from the source and mapped into the
     * shape the list already speaks. The frontend calls this only while the
     * host view is failing, so it is a way back rather than a second opinion.
     */
    async listThreadsForRecovery() {
      const [rows, projects, hostNameById] = await Promise.all([
        threads.listVisibleThreadRows(),
        bb.sdk.projects.list({ includePersonal: true }),
        threads.hostNamesById(),
      ]);
      return {
        threads: rows.map((thread) => toThreadWireRow(thread, hostNameById)),
        projects: projects.map((project) => ({
          id: project.id,
          name: project.name,
          isPersonal: project.kind === "personal",
        })),
      };
    },

    /**
     * A project's newest archived threads, for the shelf under its list.
     *
     * The archive is where finished work goes, and bb's own sidebar view cannot
     * show it — that view is built from queries pinned to `archived: false`, the
     * same fact the settled shelf exists for — so recovering one meant a search.
     * This reads the newest few for one project, newest archive first, which is
     * the order a person looks for them in.
     *
     * Hidden rows are left out for the same reason the recovery read leaves them
     * out: the host's own sidebar does not draw them.
     */
    async listProjectArchivedThreads({
      projectId,
      ownershipMode,
      projectIds,
      environmentIds,
      limit,
    }) {
      const actualProjectIds = [...new Set(projectIds ?? [projectId])];
      const ownedEnvironmentIds = new Set(environmentIds ?? []);
      const [projectRows, hostNameById] = await Promise.all([
        Promise.all(
          actualProjectIds.map((actualProjectId) =>
            threads.listThreadRows({
              archived: true,
              projectId: actualProjectId,
            }),
          ),
        ),
        threads.hostNamesById(),
      ]);
      const rows = projectRows.flat().filter((row) => {
        if (ownershipMode === "claimed") return row.projectId === projectId;
        if (
          row.environmentId !== null &&
          ownedEnvironmentIds.has(row.environmentId)
        ) {
          return true;
        }
        return row.projectId === projectId && row.environmentId === null;
      });
      const newest = rows
        .filter((row) => row.visibility === "visible")
        .sort((left, right) => (right.archivedAt ?? 0) - (left.archivedAt ?? 0))
        .slice(0, limit);
      return {
        threads: newest.map((thread) => toThreadWireRow(thread, hostNameById)),
      };
    },
  };
}
