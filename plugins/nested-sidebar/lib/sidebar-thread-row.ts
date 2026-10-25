/**
 * The shared vocabulary for turning a row that did **not** come from the host
 * into a sidebar thread.
 *
 * The host hands the plugin `PluginSidebarThread` rows with `indicator` already
 * resolved through bb's own precedence. Two paths read threads from bb's SDK
 * instead and are given no such answer:
 *
 * - the **settled shelf**, whose rows the host's sidebar view can never contain,
 *   because settling archives the thread and that view is pinned to
 *   `archived: false`;
 * - the **recovery read**, which runs when the host view itself is down.
 *
 * Both map rows here, so the two cannot disagree with each other and a change to
 * one cannot silently skip the other. This module is deliberately free of React
 * and of bb's SDK runtime, so it is tested as plain functions.
 */

import type {
  PluginSidebarThread,
  PluginSidebarThreadIndicator,
} from "@get-bb/plugin-sdk";

/** The fields the indicator derivation reads. Every row source has all of them. */
export interface IndicatorSignals {
  /** bb's thread status: "active", "starting", "stopping", "idle", "error". */
  status: string;
  hasPendingInteraction: boolean;
  activity: {
    workflows: number;
    backgroundAgents: number;
    backgroundCommands: number;
    planMode: number;
    goals: number;
  };
  lastReadAt: number | null;
  latestAttentionAt: number;
}

/** The fields both row sources carry verbatim, before their own extras. */
export interface SidebarThreadRowBase extends IndicatorSignals {
  id: string;
  projectId: string;
  title: string | null;
  titleFallback: string | null;
  parentThreadId: string | null;
  sectionId: string | null;
  originKind: string | null;
  originPluginId: string | null;
  providerId: string;
  isPinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface DerivedIndicator {
  indicator: PluginSidebarThreadIndicator;
  indicatorLabel: string | null;
}

/** bb's own rule: read means the last read caught up with the last attention. */
export function isUnread(
  row: Pick<IndicatorSignals, "lastReadAt" | "latestAttentionAt">,
): boolean {
  return (row.lastReadAt ?? 0) < row.latestAttentionAt;
}

function isWorkingStatus(status: string): boolean {
  return status === "active" || status === "starting" || status === "stopping";
}

/**
 * The one status bb would paint, derived from what a non-host read can see.
 *
 * The precedence, and why it is this order: a raised hand outranks everything,
 * because the user is what is blocking it. Live work comes next, because a
 * thread that is running is not a thread that is done — and bb has more kinds of
 * live work than a session status, which is why the activity counts are read and
 * not just `status`. Unread is last, and splits on whether the thread ended
 * badly.
 */
export function deriveIndicator(row: IndicatorSignals): DerivedIndicator {
  if (row.hasPendingInteraction) {
    return {
      indicator: "waiting-for-input",
      indicatorLabel: "Thread needs user input",
    };
  }
  const { activity } = row;
  const hasLiveWork =
    activity.workflows > 0 ||
    activity.backgroundAgents > 0 ||
    activity.backgroundCommands > 0 ||
    activity.planMode > 0 ||
    activity.goals > 0;
  if (hasLiveWork || isWorkingStatus(row.status)) {
    return { indicator: "runtime", indicatorLabel: "Thread is working" };
  }
  if (isUnread(row)) {
    return row.status === "error"
      ? {
          indicator: "unread-error",
          indicatorLabel: "Thread ended with an error",
        }
      : {
          indicator: "unread-success",
          indicatorLabel: "Thread has unread activity",
        };
  }
  return { indicator: "none", indicatorLabel: null };
}

/**
 * Only the origin kinds this sidebar draws a parent chip for survive.
 *
 * bb 0.40 adds the legacy `side-chat` value to this sidebar field. The plugin
 * still ships declarations compatible with older bb releases, where the same
 * field was typed as `"fork" | null`; the runtime value is kept so archived
 * legacy side chats remain identifiable across both.
 */
export function originKindFor(
  value: string | null,
): PluginSidebarThread["originKind"] {
  return (value === "fork" || value === "side-chat"
    ? value
    : null) as PluginSidebarThread["originKind"];
}

/**
 * The workspace kinds this sidebar knows how to label.
 *
 * Spelled out rather than imported from the SDK so a bb release that adds a
 * kind degrades to `null` — an unlabelled workspace — instead of failing the
 * backend's output validation and blanking the tree.
 */
export type WorkspaceDisplayKind =
  | "managed-worktree"
  | "unmanaged-worktree"
  | "other";

export function workspaceDisplayKindFor(
  value: string | null,
): WorkspaceDisplayKind | null {
  return value === "managed-worktree" ||
    value === "unmanaged-worktree" ||
    value === "other"
    ? value
    : null;
}