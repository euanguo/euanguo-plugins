/**
 * The settled shelf's own thread rows.
 *
 * Settling archives the thread in bb, and the host's sidebar view is built
 * from queries pinned to `archived: false` — an archived thread is evicted
 * from that cache, so `experimental_useSidebarThreads` can never report it.
 * `isArchived` on a reported thread is therefore always false, and a filter
 * that spares parked threads spares nothing.
 *
 * So the plugin fetches its own settled threads through its backend and maps
 * them into the shape the rest of the list already speaks. These functions are
 * that mapping, kept pure so they can be tested without a bb server.
 */
import type { PluginSidebarThread } from "@get-bb/plugin-sdk";
import type { ThreadLifecycleRow } from "@/lib/lifecycle";
import {
  deriveIndicator,
  isUnread,
  originKindFor,
  type SidebarThreadRowBase,
} from "./sidebar-thread-row.ts";

// The shared vocabulary's own names, so this module's callers keep one import
// site and the two row sources cannot drift apart.
export { isUnread };

/**
 * How far back the settled shelf reaches.
 *
 * A shelf that keeps everything ever settled is an archive with extra steps —
 * it grows without bound and buries the one thing the shelf is for: undoing a
 * settle you regret. A day is long enough to cover "I filed that this morning"
 * and short enough that the shelf stays readable.
 *
 * Nothing is un-settled or unarchived when a thread ages out. It stops being
 * drawn here and stays exactly where it is, in bb's archived view.
 */
export const SETTLED_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Whether a settle is recent enough to still be drawn on the shelf. */
export function isWithinSettledWindow(
  settledAt: number,
  now: number,
  windowMs: number = SETTLED_WINDOW_MS,
): boolean {
  // A settle stamped in the future — a clock that moved — is kept rather than
  // hidden. Losing a row the user just made would be the worse failure.
  return settledAt > now - windowMs;
}

/**
 * One archived, settled thread as the plugin's backend reports it.
 *
 * The shared row fields come from `SidebarThreadRowBase`; the settle timestamp
 * is this shelf's own, and is what its window is measured on.
 */
export interface SettledThreadRow extends SidebarThreadRowBase {
  /** When this plugin settled it. The shelf's window is measured on this. */
  settledAt: number;
}

/**
 * A settled row as a sidebar thread.
 *
 * `environment` and `host` are null: the settled shelf draws one line — title,
 * glyph, time — and nothing on it reads a branch or a machine. Inventing them
 * from a second lookup would buy pixels nobody renders.
 */
export function toSidebarThread(row: SettledThreadRow): PluginSidebarThread {
  const { indicator, indicatorLabel } = deriveIndicator(row);
  const status =
    row.status === "active" ||
    row.status === "error" ||
    row.status === "idle" ||
    row.status === "pending" ||
    row.status === "starting" ||
    row.status === "stopping"
      ? row.status
      : "idle";
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    titleFallback: row.titleFallback,
    displayTitle: row.title?.trim() || row.titleFallback?.trim() || row.id,
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
    // The one field the host would never report as true, and the reason this
    // whole path exists.
    isArchived: true,
    archivedAt: row.updatedAt,
    href: `/projects/${row.projectId}/threads/${row.id}`,
    isHidden: false,
    environment: null,
    host: null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastReadAt: row.lastReadAt,
    latestAttentionAt: row.latestAttentionAt,
  };
}

/**
 * The host's threads plus the settled ones it cannot see.
 *
 * The host wins every collision. Its view is live and this one is a round trip
 * old, so a thread bb has already unarchived — an un-settle that landed while
 * the fetch was in flight — must not be dragged back to the settled shelf by a
 * stale copy of itself.
 */
export function mergeSettledThreads(
  hostThreads: readonly PluginSidebarThread[],
  settledThreads: readonly PluginSidebarThread[],
): PluginSidebarThread[] {
  if (settledThreads.length === 0) return [...hostThreads];
  const hostIds = new Set(hostThreads.map((thread) => thread.id));
  return [
    ...hostThreads,
    ...settledThreads.filter((thread) => !hostIds.has(thread.id)),
  ];
}

/**
 * How many settled threads the merge above has not been handed yet.
 *
 * `listSettledThreads` is the only source of a settled thread's row, and it is
 * a round trip behind on every mount, so the shelf starts empty and its header
 * — one line, a count, and nothing else, because a remount always starts it
 * collapsed — arrives late. The lifecycle rows naming those same threads do
 * not: `listLifecycle` returns every row it holds, settled ones included, and
 * the warm-start cache seeds them before the first paint. So the count is
 * already knowable, and it is knowable from a timestamp rather than a stored
 * number for the reason the whole shelf is: the window is cut against the
 * list's own clock, and a number cached last night would still be claiming a
 * row that has since aged out.
 *
 * `visibleThreadIds` is the merged list, and subtracting it is what keeps this
 * from counting a thread twice. A settled thread bb still reports — an archive
 * that failed, or a settle from before this plugin archived anything — already
 * reaches the shelf through `resolveShelf`, and one whose new attention has
 * un-settled it already reaches the inbox. What is left is exactly the set the
 * host cannot report, which is the set whose absence empties the shelf.
 *
 * It errs high and never low, which is the direction that matters: the caller
 * adds this to the total that decides whether the sidebar has anything to draw
 * at all, and a user whose threads are all settled must never be told they have
 * none. Erring
 * high is not free, so the caller asks for this only while `listSettledThreads`
 * still owes it an answer, and two kinds of row are over-counted inside that
 * window.
 *
 * One is a row the read cannot resolve: a thread deleted while the plugin was
 * stopped, with no `thread.deleted` to clear the row, or one sitting past the
 * backend's archived-listing cap. It costs a line until the read answers, and
 * the answer is what retires it. Counted past that it would cost far more than a
 * line — a user whose one remaining row is that ghost would have a total of one,
 * so "No threads yet" would never be reached at all and a header that expands to
 * nothing would stand in its place for the rest of the day.
 *
 * The other is a row the list will re-classify once the thread arrives, and
 * nothing on the first frame could know better: the thread is archived, so the
 * activity signals that decide are precisely what the read is being waited on
 * for. A settled thread that took a turn while the user was on the settings
 * route comes back to the Inbox; a settled child whose parent is on screen goes
 * into that parent's chip rather than onto any shelf, because `visibleThreadIds`
 * is the merged list and knows nothing of the filters applied after it. Either
 * way the header is drawn for a round trip and then withdrawn — a blink, against
 * a header that would otherwise arrive late for every row that is really there.
 */
export function pendingSettledCount(
  rows: Iterable<ThreadLifecycleRow>,
  visibleThreadIds: ReadonlySet<string>,
  now: number,
): number {
  let pending = 0;
  for (const row of rows) {
    if (row.settledAt === null) continue;
    if (visibleThreadIds.has(row.threadId)) continue;
    if (!isWithinSettledWindow(row.settledAt, now)) continue;
    pending += 1;
  }
  return pending;
}
