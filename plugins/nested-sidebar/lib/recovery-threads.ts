/**
 * Live threads read from bb's own SDK, for the case the host's sidebar view is
 * down.
 *
 * `experimental_useSidebarThreads` is the sidebar's normal source, and it has no
 * way to be retried from a plugin — the hook returns state and nothing else, so
 * when the host reports `error` there is no refetch to call. That is a dead end
 * for the user: a whole sidebar replaced by one line, waiting for something
 * outside their control.
 *
 * bb's SDK can answer the same question. The plugin's backend already reaches it
 * for archived threads and for bulk-delete validation, and `threads.list` carries
 * every field a row draws — environment, host, pin, activity, attention. So the
 * recovery read goes through the plugin's own RPC, and the user gets a retry that
 * does something.
 *
 * This is a fallback, not a second source of truth: it is only consulted while
 * the host view is failing, and the host's answer wins the moment it returns.
 */

import type { PluginSidebarThread } from "@get-bb/plugin-sdk";
import {
  deriveIndicator,
  isUnread,
  originKindFor,
  workspaceDisplayKindFor,
  type SidebarThreadRowBase,
} from "./sidebar-thread-row.ts";

/** The environment facts a workspace row reads. */
export interface RecoveryThreadEnvironment {
  id: string | null;
  name: string | null;
  branchName: string | null;
  providerId: string | null;
  /**
   * Loose on the wire, like the other open fields: the backend validates it as a
   * plain string so a kind a newer bb invents cannot fail the read. It is
   * narrowed by `workspaceDisplayKindFor` on the way into a sidebar thread.
   */
  workspaceDisplayKind: string | null;
}

/** One live thread as the plugin's backend reports it. */
export interface RecoveryThreadRow extends SidebarThreadRowBase {
  environment: RecoveryThreadEnvironment | null;
  /**
   * Resolved by the backend, because a thread with no worktree still runs on a
   * machine and the row names it in the branch's place.
   */
  host: { id: string; name: string } | null;
}

export function toRecoveryThread(row: RecoveryThreadRow): PluginSidebarThread {
  const { indicator, indicatorLabel } = deriveIndicator(row);
  const status = sidebarStatus(row.status);
  const displayTitle =
    row.title?.trim() || row.titleFallback?.trim() || row.id;
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    titleFallback: row.titleFallback,
    displayTitle,
    parentThreadId: row.parentThreadId,
    lifecycleOwnerThreadId: null,
    sourceThreadId: null,
    sectionId: row.sectionId,
    originKind: originKindFor(row.originKind),
    originPluginId: row.originPluginId,
    providerId: row.providerId,
    status,
    runtimeStatus: status,
    queuedWork: "none",
    hasPendingInteraction: row.hasPendingInteraction,
    activity: row.activity,
    indicator,
    indicatorLabel,
    isUnread: isUnread(row),
    isPinned: row.isPinned,
    pinnedAt: null,
    pinSortKey: null,
    // The one field that makes this read different from the settled shelf's:
    // these rows are live, so nothing here was archived to be found.
    isArchived: false,
    archivedAt: null,
    href: `/projects/${row.projectId}/threads/${row.id}`,
    isHidden: false,
    environment:
      row.environment === null
        ? null
        : {
            id: row.environment.id,
            name: row.environment.name,
            branchName: row.environment.branchName,
            path: null,
            isWorktree:
              row.environment.workspaceDisplayKind === "managed-worktree" ||
              row.environment.workspaceDisplayKind === "unmanaged-worktree",
            providerId: row.environment.providerId,
            workspaceDisplayKind: workspaceDisplayKindFor(
              row.environment.workspaceDisplayKind,
            ),
          },
    host: row.host,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastReadAt: row.lastReadAt,
    latestAttentionAt: row.latestAttentionAt,
  };
}

function sidebarStatus(value: string): PluginSidebarThread["status"] {
  return value === "active" ||
    value === "error" ||
    value === "idle" ||
    value === "pending" ||
    value === "starting" ||
    value === "stopping"
    ? value
    : "idle";
}

/**
 * One archived row as a sidebar thread.
 *
 * The same mapping as the recovery read, with the one field that differs stated
 * here: these rows are archived, which is the whole reason the shelf exists.
 * Reusing the mapper rather than repeating it means a field added to one is added
 * to both — and both reads come from the same backend mapper, so they cannot
 * disagree about what a row holds.
 */
export function toArchivedThread(row: RecoveryThreadRow): PluginSidebarThread {
  return {
    ...toRecoveryThread(row),
    isArchived: true,
    archivedAt: row.updatedAt,
  };
}

/**
 * Every recovery row as a sidebar thread, with the host's own id order kept.
 *
 * Deliberately not deduplicated: the backend's read is paged over one table, so
 * a duplicate id would mean a bug there, and silently collapsing it here would
 * hide that instead of showing it.
 */
export function toRecoveryThreads(
  rows: readonly RecoveryThreadRow[],
): PluginSidebarThread[] {
  return rows.map(toRecoveryThread);
}
