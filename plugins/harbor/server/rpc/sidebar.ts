/**
 * Consolidated sidebar RPC handlers: groups, manual order, pinned order,
 * settled/snoozed lifecycle shelf, thread recovery/archive reads, and bulk delete.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { createBulkDeleteCoordinator } from "../../lib/domain/bulk-delete.ts";
import { UNGROUPED_ORDER_SCOPE } from "../../lib/domain/manual-order.ts";
import { isWithinSettledWindow } from "../../lib/domain/settled-threads.ts";
import { GROUP_CHANNEL } from "../../lib/realtime-channels.ts";
import type { createGroupStore } from "../../lib/stores/group-store.ts";
import type { createOrderStore, OrderWrite } from "../../lib/stores/order-store.ts";
import type { HarborRpcHandlers } from "../contract.ts";
import type { StoredLifecycleRow } from "../lifecycle-service.ts";
import type { ProjectService } from "../project-service.ts";
import {
  toThreadWireFields,
  toThreadWireRow,
  type ThreadPage,
  type ThreadReader,
} from "../thread-reader.ts";

type SidebarRpcMethod =
  | "listGroups"
  | "createGroup"
  | "renameGroup"
  | "deleteGroup"
  | "assignProjectToGroup"
  | "reorderGroups"
  | "listManualOrder"
  | "reorderProjects"
  | "reorderFamilies"
  | "reorderWorkspaces"
  | "listPinnedOrder"
  | "reorderPinned"
  | "listLifecycle"
  | "settle"
  | "unsettle"
  | "snooze"
  | "unsnooze"
  | "listSettledThreads"
  | "listThreadsForRecovery"
  | "listProjectArchivedThreads"
  | "previewBulkDelete"
  | "confirmBulkDelete";

export interface SidebarHandlerDeps {
  readonly bb: BbPluginApi;
  readonly groups: ReturnType<typeof createGroupStore>;
  readonly projects: ProjectService;
  readonly orders: ReturnType<typeof createOrderStore>;
  readonly orderOutcome: (result: OrderWrite) => {
    ok: boolean;
    stale: boolean;
    revision: number;
  };
  readonly readAll: () => StoredLifecycleRow[];
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
  readonly threads: ThreadReader;
  readonly listVisibleThreadRows: () => Promise<ThreadPage>;
  readonly bulkDelete: ReturnType<typeof createBulkDeleteCoordinator>;
}

function compareCodepoints(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function sidebarHandlers(
  deps: SidebarHandlerDeps,
): HarborRpcHandlers<SidebarRpcMethod> {
  const {
    bb,
    groups,
    projects,
    orders,
    orderOutcome,
    readAll,
    settleThread,
    unsettleThread,
    snoozeThread,
    threads,
    listVisibleThreadRows,
    bulkDelete,
  } = deps;

  return {
    async listGroups() {
      return {
        groups: groups.list(),
        assignment: groups.assignments(),
      };
    },

    async createGroup({ name, icon }) {
      const created = await projects.createGroup(name, icon);
      if (created === null) throw new Error("Invalid group name.");
      return created;
    },

    async renameGroup({ groupId, name, icon }) {
      return { ok: await projects.renameGroup(groupId, name, icon) };
    },

    async deleteGroup({ groupId }) {
      return { ok: await projects.deleteGroup(groupId) };
    },

    async assignProjectToGroup({ projectId, groupId }) {
      return {
        ok: await projects.assignProjectToGroup(projectId, groupId),
      };
    },

    async reorderGroups({ groupIds }) {
      const known = new Set(groups.list().map((group) => group.id));
      if (!groupIds.every((id) => known.has(id))) return { ok: false };
      const ok = groups.reorder(groupIds);
      if (ok) bb.realtime.publish(GROUP_CHANNEL, {});
      return { ok };
    },

    async listManualOrder() {
      return { ...orders.list(), revision: orders.revision() };
    },

    async reorderProjects({ groupId, projectIds, baseRevision }) {
      if (groupId !== UNGROUPED_ORDER_SCOPE) {
        const known = new Set(groups.list().map((group) => group.id));
        if (!known.has(groupId)) {
          return { ok: false, stale: false, revision: orders.revision() };
        }
      }
      return orderOutcome(
        orders.setProjectOrder(groupId, projectIds, baseRevision),
      );
    },

    async reorderFamilies({ projectId, rootIds, baseRevision }) {
      return orderOutcome(
        orders.setFamilyOrder(projectId, rootIds, baseRevision),
      );
    },

    async reorderWorkspaces({ projectId, workspaceKeys, baseRevision }) {
      return orderOutcome(
        orders.setWorkspaceOrder(projectId, workspaceKeys, baseRevision),
      );
    },

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

    async listLifecycle() {
      return { rows: readAll() };
    },

    async settle({ threadId }) {
      return settleThread(threadId);
    },

    async unsettle({ threadId }) {
      return unsettleThread(threadId);
    },

    async snooze({ threadId, snoozedUntil }) {
      return snoozeThread(threadId, snoozedUntil);
    },

    async unsnooze({ threadId }) {
      return snoozeThread(threadId, null);
    },

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
      let archived: Awaited<ReturnType<typeof threads.listArchivedThreads>>;
      try {
        archived = await threads.listArchivedThreads();
      } catch (error) {
        bb.log.warn(`listing archived threads failed: ${String(error)}`);
        throw error;
      }
      return {
        ...(archived.truncated ? { truncated: true } : {}),
        threads: archived.rows
          .filter((thread) => settledAtById.has(thread.id))
          .map((thread) => ({
            settledAt: settledAtById.get(thread.id) ?? 0,
            ...toThreadWireFields(thread),
          })),
      };
    },

    async listThreadsForRecovery() {
      const [rows, projectList, hostNameById] = await Promise.all([
        threads.listVisibleThreadRows(),
        bb.sdk.projects.list({ includePersonal: true }),
        threads.hostNamesById(),
      ]);
      return {
        threads: rows.rows.map((thread) =>
          toThreadWireRow(thread, hostNameById),
        ),
        projects: projectList.map((project) => ({
          id: project.id,
          name: project.name,
          isPersonal: project.kind === "personal",
        })),
        ...(rows.truncated ? { truncated: true } : {}),
      };
    },

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
      const rows = projectRows.flatMap((page) => page.rows);
      const filtered = rows.filter((row) => {
        if (ownershipMode === "claimed") return row.projectId === projectId;
        if (
          row.environmentId !== null &&
          ownedEnvironmentIds.has(row.environmentId)
        ) {
          return true;
        }
        return row.projectId === projectId && row.environmentId === null;
      });
      const newest = filtered
        .filter((row) => row.visibility === "visible")
        .sort((left, right) => (right.archivedAt ?? 0) - (left.archivedAt ?? 0))
        .slice(0, limit);
      return {
        ...(projectRows.some((page) => page.truncated)
          ? { truncated: true }
          : {}),
        threads: newest.map((thread) => toThreadWireRow(thread, hostNameById)),
      };
    },

    async previewBulkDelete({ threadIds, protectedThreadId }) {
      return bulkDelete.preview(threadIds, protectedThreadId);
    },

    async confirmBulkDelete({ token }) {
      return bulkDelete.confirm(token);
    },
  };
}
