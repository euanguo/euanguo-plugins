/**
 * The Pinned section: pinned roots from every project, in bb's own pin order.
 *
 * Pinned used to mean "first inside its project", and that is a weaker promise
 * than the one the word makes. A pin says *keep this where I can see it*; hiding
 * it inside a collapsed project, or behind a group tab that excludes that
 * project, is the one thing a pin is for. Every other sidebar in the ecosystem
 * draws a pinned section above the tree, and bb's own list does too.
 *
 * Two rules make it work rather than merely look right:
 *
 * 1. **The order is bb's, not a private one.** `bb.sdk.threads.reorderPinned`
 *    writes the same order the built-in sidebar drags by, so a pin moved in one
 *    place is in the same place in the other. A private order would make the two
 *    surfaces disagree, which is worse than having no pinned section at all.
 * 2. **A pinned root leaves its project.** It is drawn once, in the section. Two
 *    rows for one thread is a sidebar that cannot be trusted to say how many
 *    things it is showing.
 *
 * The order read is allowed to be incomplete or stale — a thread pinned on
 * another client, or a pin this read has not caught up with — so a pinned family
 * the order does not name lands after the ones it does, by the same creation
 * order the tree uses. Dropping it would hide a pinned thread, which is the
 * failure the section exists to prevent.
 */

import type { PluginSidebarThread } from "@get-bb/plugin-sdk";
import type { ProjectThreadGroup, ThreadFamily } from "./inbox.ts";

/** A pinned root, with the project it belongs to so its row can name it. */
export interface PinnedFamily {
  readonly projectId: string;
  readonly projectName: string;
  readonly family: ThreadFamily;
}

/**
 * Take every project's pinned families out of the tree.
 *
 * Only a pinned thread moves; its project stays where it has always been. That
 * includes a project with no threads at all, whose empty row is where the next
 * thread starts.
 */
export function splitPinnedFamilies(
  groups: readonly ProjectThreadGroup[],
): { pinned: PinnedFamily[]; rest: ProjectThreadGroup[] } {
  const pinned: PinnedFamily[] = [];
  const rest: ProjectThreadGroup[] = [];
  for (const group of groups) {
    const families: ThreadFamily[] = [];
    for (const family of group.families) {
      if (family.root.isPinned) {
        pinned.push({
          projectId: group.project.id,
          projectName: group.project.name,
          family,
        });
      } else {
        families.push(family);
      }
    }
    rest.push({ ...group, families });
  }
  return { pinned, rest };
}

/**
 * bb's pin order over the pinned families this client is holding.
 *
 * The order is a list of root ids. Anything it does not name keeps its relative
 * place at the end, newest first, so a pin made elsewhere shows up rather than
 * disappearing until the next read lands.
 */
export function orderPinnedFamilies(
  pinned: readonly PinnedFamily[],
  order: readonly string[],
): PinnedFamily[] {
  if (pinned.length === 0) return [];
  const rank = new Map(order.map((id, index) => [id, index]));
  // Named entries take bb's order; anything the read has not caught up with — a
  // pin made on another client — lands after them, newest first, rather than
  // disappearing until the next read lands.
  const named: PinnedFamily[] = [];
  const unnamed: PinnedFamily[] = [];
  for (const entry of pinned) {
    if (rank.has(entry.family.root.id)) named.push(entry);
    else unnamed.push(entry);
  }
  named.sort(
    (left, right) =>
      (rank.get(left.family.root.id) ?? 0) -
      (rank.get(right.family.root.id) ?? 0),
  );
  unnamed.sort(
    (left, right) =>
      right.family.root.createdAt - left.family.root.createdAt,
  );
  return [...named, ...unnamed];
}

/**
 * The neighbour a dragged pinned row should be placed against.
 *
 * bb's reorder takes the ids either side of the drop rather than an index, so
 * the caller needs the pair, and the pair is only meaningful inside the list the
 * drop happened in. A source or target the list does not contain is refused
 * rather than guessed at: a reorder that moves the wrong row is worse than one
 * that does nothing.
 */
export function pinnedNeighbours(input: {
  orderedIds: readonly string[];
  sourceId: string;
  targetId: string;
  position: "before" | "after";
}): { previousThreadId: string | null; nextThreadId: string | null } | null {
  const { orderedIds, sourceId, targetId, position } = input;
  if (sourceId === targetId) return null;
  const sourceIndex = orderedIds.indexOf(sourceId);
  const targetIndex = orderedIds.indexOf(targetId);
  if (sourceIndex < 0 || targetIndex < 0) return null;
  // The list as it would be without the row being moved, so the neighbours are
  // the ones the drop actually lands between.
  const without = orderedIds.filter((id) => id !== sourceId);
  const anchor = without.indexOf(targetId);
  const insertAt = position === "before" ? anchor : anchor + 1;
  return {
    previousThreadId: insertAt > 0 ? (without[insertAt - 1] ?? null) : null,
    nextThreadId: without[insertAt] ?? null,
  };
}

/** The root ids of a pinned section, in the order it draws them. */
export function pinnedRootIds(pinned: readonly PinnedFamily[]): string[] {
  return pinned.map((entry) => entry.family.root.id);
}

/** One thread's family root, for the rows that only have the thread. */
export function isPinnedRoot(thread: PluginSidebarThread): boolean {
  return thread.parentThreadId === null && thread.isPinned;
}

/**
 * The payload a dragged pinned row carries.
 *
 * Its own type rather than the family one: a drop handler has to tell "move this
 * thread inside its project" from "move this thread inside the pinned section",
 * and the two land in different stores. A shared type would make the receiving
 * list guess.
 */
export const PINNED_DRAG_TYPE = "application/x-nest-pinned";

export function encodeDraggedPinned(rootId: string): string {
  return JSON.stringify({ rootId });
}

export function parseDraggedPinned(
  raw: string,
): { rootId: string } | null {
  if (raw.length === 0 || raw.length > 1_000) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  if (!("rootId" in parsed) || typeof parsed.rootId !== "string") return null;
  if (parsed.rootId.length === 0 || parsed.rootId.length > 200) return null;
  return { rootId: parsed.rootId };
}
