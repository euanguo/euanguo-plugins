import type {
  ExperimentalPanelTab,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";

import { familyStatus, type FamilyStatusPresentation } from "./family-status.ts";
import type {
  PartialWorkspaceIndex,
  Workspace,
  WorkspaceIndex,
} from "./workspace-index.ts";
import { workspaceSortOrder } from "./workspace.ts";

const GIT_PLUGIN_ID = "bb--git";
const GIT_DIFF_TAB_ID = "diff";

/** More conversations than this and the dropdown earns a search field. */
export const WORKSPACE_TAB_SEARCH_THRESHOLD = 8;

/**
 * The conversations the strip shows for one workspace.
 *
 * Every visible top-level thread in the workspace, oldest first, plus the
 * thread the pane is showing when it is a subagent or a hidden side chat. A
 * child runs where its parent does, so the family stays in the workspace it
 * was started in even though only the root is drawn on the strip.
 */
/**
 * What a lookup needs from the index: which workspace a thread runs in.
 *
 * Narrow on purpose, so the header's partial index can be passed without
 * claiming it carries the maps only the sidebar builds.
 */
export type WorkspaceOfThread = Pick<WorkspaceIndex, "workspaceOfThread">;

/** Returns non-pinned, non-active idle or stale conversation IDs eligible for batch settle. */
export function idleSettleableTabIds(
  tabs: readonly WorkspaceTab[],
  activeThreadId: string | null,
): string[] {
  return tabs
    .filter(
      (tab) =>
        !tab.thread.isPinned &&
        tab.thread.id !== activeThreadId &&
        (tab.status.kind === "inactive" || tab.status.kind === "stale"),
    )
    .map((tab) => tab.thread.id);
}

export function workspaceChats(
  threads: readonly PluginSidebarThread[],
  workspaceKey: string,
  currentThreadId: string,
  index: WorkspaceOfThread,
): PluginSidebarThread[] {
  return threads
    .filter((thread) => {
      if (thread.isArchived) return false;
      const workspace = index.workspaceOfThread(thread);
      if (workspace?.key !== workspaceKey) return false;
      return (
        thread.id === currentThreadId ||
        (!thread.isHidden && thread.parentThreadId === null)
      );
    })
    .sort(
      (left, right) =>
        left.createdAt - right.createdAt || left.id.localeCompare(right.id),
    );
}

/**
 * Every live descendant of one root, oldest first.
 *
 * A family is a tree even though the sidebar draws it as one flat run. The tab
 * strip only draws the root, so this is what its status has to aggregate and
 * what its child count has to name. Archived children are already off the
 * strip's own list, so they are off the count too.
 */
export function familyDescendants(
  threads: readonly PluginSidebarThread[],
  rootId: string,
): PluginSidebarThread[] {
  const byParent = new Map<string, PluginSidebarThread[]>();
  for (const thread of threads) {
    if (thread.isArchived || thread.parentThreadId === null) continue;
    const siblings = byParent.get(thread.parentThreadId) ?? [];
    siblings.push(thread);
    byParent.set(thread.parentThreadId, siblings);
  }
  const descendants: PluginSidebarThread[] = [];
  const seen = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const parentId = queue.shift();
    if (parentId === undefined) continue;
    for (const child of byParent.get(parentId) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      descendants.push(child);
      queue.push(child.id);
    }
  }
  return descendants.sort(
    (left, right) =>
      left.createdAt - right.createdAt || left.id.localeCompare(right.id),
  );
}

/** One tab: its conversation, the family's state, and how many hide behind it. */
export interface WorkspaceTab {
  readonly thread: PluginSidebarThread;
  readonly status: FamilyStatusPresentation;
  readonly childCount: number;
}

/**
 * Where a tab sits on the strip.
 *
 * Pinned ones first, in bb's pin order: a pin says "keep this where I can see
 * it", and a row that scrolls away is not that. The rest are most recently
 * used first — the conversation read last, then the one before it — so the
 * stack behind the pane behaves like a stack, and the conversation a user
 * wants back is the one at the left edge. One never opened falls back to when
 * it was started, which puts a brand-new conversation where it belongs.
 */
function tabOrderKey(tab: WorkspaceTab): {
  readonly pinned: number;
  readonly pin: string;
  readonly recent: number;
  readonly created: number;
  readonly id: string;
} {
  const { thread } = tab;
  return {
    pinned: thread.isPinned ? 0 : 1,
    pin: thread.pinSortKey ?? `${thread.pinnedAt ?? 0}`.padStart(20, "0"),
    recent: thread.lastReadAt ?? thread.createdAt,
    created: thread.createdAt,
    id: thread.id,
  };
}

export function workspaceTabs(
  threads: readonly PluginSidebarThread[],
  workspaceKey: string,
  currentThreadId: string,
  index: WorkspaceOfThread,
  now: number,
): WorkspaceTab[] {
  return workspaceChats(threads, workspaceKey, currentThreadId, index)
    .map((thread) => {
      const family = familyDescendants(threads, thread.id);
      return {
        thread,
        status: familyStatus([thread, ...family], now),
        childCount: family.length,
      };
    })
    .sort((left, right) => {
      const a = tabOrderKey(left);
      const b = tabOrderKey(right);
      return (
        a.pinned - b.pinned ||
        (a.pinned === 0 ? a.pin.localeCompare(b.pin) : 0) ||
        b.recent - a.recent ||
        b.created - a.created ||
        a.id.localeCompare(b.id)
      );
    });
}

export function shouldShowWorkspaceSearch(count: number): boolean {
  return count > WORKSPACE_TAB_SEARCH_THRESHOLD;
}

/** Substring match on the visible title, preserving the strip's own order. */
export function filterWorkspaceTabs(
  tabs: readonly WorkspaceTab[],
  query: string,
): WorkspaceTab[] {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) return [...tabs];
  return tabs.filter((tab) =>
    tab.thread.displayTitle.toLowerCase().includes(normalized),
  );
}

export function tabAfterClose(
  chats: readonly PluginSidebarThread[],
  closingId: string,
): PluginSidebarThread | null {
  const index = chats.findIndex((chat) => chat.id === closingId);
  if (index === -1) return null;
  return chats[index + 1] ?? chats[index - 1] ?? null;
}

export function findDiffTabKey(
  tabs: readonly ExperimentalPanelTab[],
): string | null {
  return (
    tabs.find(
      (tab) =>
        tab.detail.kind === "plugin" &&
        tab.detail.pluginId === GIT_PLUGIN_ID &&
        tab.detail.tab.id === GIT_DIFF_TAB_ID,
    )?.key ?? null
  );
}

/**
 * The workspaces the breadcrumb's switcher offers.
 *
 * Inside a feature the other members and the root are the ones worth reaching:
 * they are the repositories of the same piece of work. Everywhere else it is
 * the project's other workspaces. The current row is never in the list, and
 * the order is stable so the menu does not reshuffle between opens.
 */
export function siblingWorkspaces(
  workspace: Workspace,
  index: PartialWorkspaceIndex,
): Workspace[] {
  // A partial index may not carry the grouping maps; an empty answer means the
  // switcher offers nothing rather than inventing neighbours.
  const candidates =
    workspace.featureId === null
      ? (index.byProject?.get(workspace.projectId) ?? [])
      : (index.byFeature?.get(workspace.featureId) ?? []);
  const others = candidates.filter((candidate) => candidate.key !== workspace.key);
  if (workspace.featureId === null) {
    return [...others].sort(
      (left, right) =>
        workspaceSortOrder(left.kind) - workspaceSortOrder(right.kind) ||
        left.label.localeCompare(right.label) ||
        left.key.localeCompare(right.key),
    );
  }
  return [...others].sort(
    (left, right) =>
      Number(left.parentKey !== null) - Number(right.parentKey !== null) ||
      left.label.localeCompare(right.label) ||
      left.key.localeCompare(right.key),
  );
}

/** The name of the feature a workspace belongs to, or null outside one. */
export function featureTitle(
  workspace: Workspace,
  index: PartialWorkspaceIndex,
): string | null {
  if (workspace.featureId === null) return null;
  return index.featureNames?.get(workspace.featureId) ?? null;
}

export type WorkspaceSwitchTarget =
  | { readonly kind: "thread"; readonly threadId: string }
  | { readonly kind: "new-chat"; readonly environmentId: string }
  | { readonly kind: "none" };

/**
 * What clicking a workspace opens.
 *
 * The conversation last read there first, then its oldest visible conversation,
 * then a new conversation bound to the workspace. The last step is why a
 * workspace with no history is still reachable from the switcher.
 */
export function workspaceSwitchTarget(
  workspace: Workspace,
  threads: readonly PluginSidebarThread[],
  index: WorkspaceOfThread,
  lastActive: string | null,
): WorkspaceSwitchTarget {
  const chats = workspaceChats(threads, workspace.key, "", index);
  const remembered =
    lastActive === null
      ? undefined
      : chats.find((chat) => chat.id === lastActive);
  const target = remembered ?? chats[0];
  if (target !== undefined) {
    return { kind: "thread", threadId: target.id };
  }
  const environmentId =
    workspace.canonicalEnvironmentId ?? workspace.environmentId;
  return environmentId === null
    ? { kind: "none" }
    : { kind: "new-chat", environmentId };
}

/**
 * Where closing the Untitled tab goes: the last conversation read here, else
 * the newest one. Null when the workspace has no conversation to return to.
 */
export function untitledCloseTarget(
  workspace: Workspace,
  threads: readonly PluginSidebarThread[],
  index: WorkspaceOfThread,
  lastActive: string | null,
): string | null {
  const chats = workspaceChats(threads, workspace.key, "", index);
  const remembered =
    lastActive === null
      ? undefined
      : chats.find((chat) => chat.id === lastActive);
  return remembered?.id ?? chats.at(-1)?.id ?? null;
}

/**
 * The conversations a bulk close takes: every unpinned tab on one side of the
 * anchor, or every unpinned tab except it.
 *
 * Pinned tabs are never in the answer. A pin is the promise that the tab stays
 * put, and "close the others" must not quietly break it; the pin has to come
 * off first, which is a decision of its own.
 */
export function tabsToClose(
  chats: readonly PluginSidebarThread[],
  anchorId: string,
  direction: "others" | "left" | "right",
): PluginSidebarThread[] {
  const index = chats.findIndex((chat) => chat.id === anchorId);
  if (index === -1) return [];
  return chats.filter((chat, position) => {
    if (chat.isPinned) return false;
    if (direction === "others") return position !== index;
    if (direction === "left") return position < index;
    return position > index;
  });
}

/**
 * Where the pane goes when several conversations leave at once.
 *
 * The first tab to the right of the active one that survives, else the first to
 * the left, else null when the open conversation is not among the closed ones
 * and the pane can stay where it is.
 */
export function tabAfterBulkClose(
  chats: readonly PluginSidebarThread[],
  closingIds: ReadonlySet<string>,
  activeThreadId: string,
): PluginSidebarThread | null {
  const index = chats.findIndex((chat) => chat.id === activeThreadId);
  if (index === -1 || !closingIds.has(activeThreadId)) return null;
  return (
    chats.slice(index + 1).find((chat) => !closingIds.has(chat.id)) ??
    chats
      .slice(0, index)
      .reverse()
      .find((chat) => !closingIds.has(chat.id)) ??
    null
  );
}

const PENDING_SETTLE_TTL_MS = 5_000;

interface PendingSettle {
  readonly threadId: string;
  readonly nextThreadId: string;
  readonly expiresAt: number;
}

/**
 * A settle that waits for the pane it navigates to.
 *
 * Closing the active tab settles it, and a settle archives its thread, which
 * removes it from the strip. Doing that before the neighbour is open would
 * leave the pane pointing at a conversation that no longer exists. So the
 * close records the pair, navigation happens, and the next pane's strip takes
 * the record and settles from there.
 *
 * A module slot rather than component state on purpose: the record has to
 * outlive the unmount that navigation causes. It is a five-second handoff, not
 * a store, and a record whose window closed is simply dropped.
 */
let pendingSettle: PendingSettle | null = null;

export function deferSettleUntilOpen(
  threadId: string,
  nextThreadId: string,
  now: number = Date.now(),
): void {
  pendingSettle = {
    threadId,
    nextThreadId,
    expiresAt: now + PENDING_SETTLE_TTL_MS,
  };
}

export function takePendingSettle(
  threadId: string,
  activeThreadId: string,
  now: number = Date.now(),
): boolean {
  if (pendingSettle === null) return false;
  if (pendingSettle.expiresAt < now) {
    pendingSettle = null;
    return false;
  }
  if (
    pendingSettle.threadId !== threadId ||
    pendingSettle.nextThreadId !== activeThreadId
  ) {
    return false;
  }
  pendingSettle = null;
  return true;
}

/** The icon a switcher row uses for the kind of workspace it is. */
export function workspaceKindIcon(kind: Workspace["kind"]): string {
  if (kind === "git-worktree") return "GitBranch";
  if (kind === "project-checkout") return "FolderGit";
  return "Folder";
}
