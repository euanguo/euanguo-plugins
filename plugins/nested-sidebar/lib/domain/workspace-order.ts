/**
 * The arrangement of a project's worktrees.
 *
 * The checkout never moves. It is the project itself, it is the one row that is
 * always there, and it leads under every arrangement — so only worktrees are
 * ordered here, and the list that gets stored holds only their keys.
 *
 * The lens is the same idea as the other two levels, with that one exception
 * built in: `manual` reads what the user dragged, every other mode ranks the
 * worktrees by a fact about them, and the checkout sits above the result either
 * way rather than being ranked with them. It is a place the user did not choose
 * to work in, so a ranking by activity or status would push the worktrees that
 * are actually moving below a header that never does anything.
 *
 * A key is a workspace's own key, which is its environment id. What the user is
 * arranging is a place on disk, not a branch name that two places can share.
 */

import { validOrderId, validOrderItems } from "./manual-order.ts";
import { familyUpdatedAt } from "./thread-management.ts";
import { statusKindRank, type StatusRollup } from "./rollup.ts";
import type { ThreadFamily } from "./inbox.ts";
import type { WorktreeSortMode } from "./sort-modes.ts";
import { workspaceSortOrder, type WorkspaceRef } from "./workspace.ts";

/** What a worktree's lens reads. All of it is already on the row. */
export interface SortableWorkspace {
  readonly ref: WorkspaceRef;
  readonly families: readonly ThreadFamily[];
  readonly rollup: StatusRollup;
}

/** The numbers a lens ranks by, computed once per row. */
export interface WorkspaceSortFacts {
  /** Latest activity across the workspace's own threads. */
  readonly updatedAt: number;
  /** How many thread families live in it. */
  readonly families: number;
  /** Its rollup kind, on the same ladder the status dots fold with. */
  readonly statusRank: number;
}

/** The facts of a row the tree has already rolled up. */
export function workspaceSortFacts(
  workspace: SortableWorkspace,
): WorkspaceSortFacts {
  return {
    updatedAt: workspace.families.reduce(
      (latest, family) => Math.max(latest, familyUpdatedAt(family)),
      0,
    ),
    families: workspace.families.length,
    statusRank: statusKindRank(workspace.rollup.kind),
  };
}

export type WorkspaceMoveResult =
  | { readonly ok: true; readonly keys: string[] }
  | {
      readonly ok: false;
      readonly reason:
        | "cross-project"
        | "invalid-id"
        | "missing-workspace"
        | "same-workspace";
    };

/**
 * Where one worktree lands when it is dropped on another.
 *
 * Both keys have to belong to the project being arranged and both have to be in
 * the list it was arranged from: a drop that names something the sidebar is not
 * drawing would otherwise write an arrangement for rows the user cannot see.
 */
export function moveProjectWorkspace({
  projectId,
  sourceProjectId,
  targetProjectId,
  keys,
  sourceKey,
  targetKey,
  position,
}: {
  projectId: string;
  sourceProjectId: string;
  targetProjectId: string;
  keys: readonly string[];
  sourceKey: string;
  targetKey: string;
  position: "before" | "after";
}): WorkspaceMoveResult {
  if (sourceProjectId !== projectId || targetProjectId !== projectId) {
    return { ok: false, reason: "cross-project" };
  }
  if (![projectId, sourceKey, targetKey].every(validOrderId)) {
    return { ok: false, reason: "invalid-id" };
  }
  if (sourceKey === targetKey) return { ok: false, reason: "same-workspace" };
  if (!validOrderItems(keys)) return { ok: false, reason: "invalid-id" };
  const sourceIndex = keys.indexOf(sourceKey);
  if (sourceIndex < 0 || !keys.includes(targetKey)) {
    return { ok: false, reason: "missing-workspace" };
  }
  const order = [...keys];
  order.splice(sourceIndex, 1);
  order.splice(
    order.indexOf(targetKey) + (position === "after" ? 1 : 0),
    0,
    sourceKey,
  );
  return { ok: true, keys: order };
}

/** One step for the keyboard, which is the same move against the next row. */
export function keyboardWorkspaceMove(
  projectId: string,
  keys: readonly string[],
  sourceKey: string,
  delta: -1 | 1,
): WorkspaceMoveResult {
  const sourceIndex = keys.indexOf(sourceKey);
  if (sourceIndex < 0) return { ok: false, reason: "missing-workspace" };
  const targetKey = keys[sourceIndex + delta];
  if (targetKey === undefined) {
    return { ok: false, reason: "missing-workspace" };
  }
  return moveProjectWorkspace({
    projectId,
    sourceProjectId: projectId,
    targetProjectId: projectId,
    keys,
    sourceKey,
    targetKey,
    position: delta < 0 ? "before" : "after",
  });
}

/**
 * A project's workspaces in the order they are drawn.
 *
 * Under `manual` — the default — the checkout leads because
 * `workspaceSortOrder` says so, whatever the stored arrangement says; then the
 * worktrees the user arranged; then, for a worktree the stored list does not
 * mention — one that was just created, or created on another machine — its
 * label, which is the order everything had before any of it was arranged.
 *
 * Under a lens the same rule survives in the one place it matters: the checkout
 * is still first, and the lens ranks everything under it.
 */
export function orderWorkspaces<T extends { readonly ref: WorkspaceRef }>(
  workspaces: readonly T[],
  storedKeys: readonly string[] | undefined,
  lens?: {
    readonly mode: Exclude<WorktreeSortMode, "manual">;
    readonly facts: (workspace: T) => WorkspaceSortFacts;
  },
): T[] {
  if (lens === undefined) return inArrangedOrder(workspaces, storedKeys);
  const compare = worktreeComparator(lens.mode, lens.facts);
  return [...workspaces].sort((left, right) => {
    const byCheckout = checkoutRank(left) - checkoutRank(right);
    if (byCheckout !== 0) return byCheckout;
    // The label last, so two rows a lens cannot separate still hold one order
    // between renders rather than following the input array's.
    return compare(left, right) || left.ref.label.localeCompare(right.ref.label);
  });
}

function inArrangedOrder<T extends { readonly ref: WorkspaceRef }>(
  workspaces: readonly T[],
  storedKeys: readonly string[] | undefined,
): T[] {
  const stored = validOrderItems(storedKeys) ? storedKeys : [];
  const rank = new Map(stored.map((key, index) => [key, index]));
  const unlisted = stored.length;
  return [...workspaces].sort((left, right) => {
    const kindOrder =
      workspaceSortOrder(left.ref.kind) - workspaceSortOrder(right.ref.kind);
    if (kindOrder !== 0) return kindOrder;
    const leftRank = rankForWorkspace(left.ref, rank, unlisted);
    const rightRank = rankForWorkspace(right.ref, rank, unlisted);
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.ref.label.localeCompare(right.ref.label);
  });
}

/** Zero for the checkout, one for everything else: the whole exemption. */
function checkoutRank(workspace: { readonly ref: WorkspaceRef }): number {
  return workspace.ref.kind === "project-checkout" ? 0 : 1;
}

function worktreeComparator<T extends { readonly ref: WorkspaceRef }>(
  mode: Exclude<WorktreeSortMode, "manual">,
  facts: (workspace: T) => WorkspaceSortFacts,
): (left: T, right: T) => number {
  switch (mode) {
    case "name-asc":
      return (left, right) => left.ref.label.localeCompare(right.ref.label);
    case "updated-desc":
      return (left, right) => facts(right).updatedAt - facts(left).updatedAt;
    case "threads-desc":
      return (left, right) => facts(right).families - facts(left).families;
    case "status":
      return (left, right) =>
        facts(left).statusRank - facts(right).statusRank ||
        facts(right).updatedAt - facts(left).updatedAt;
  }
}

function rankForWorkspace(
  ref: WorkspaceRef,
  stored: ReadonlyMap<string, number>,
  fallback: number,
): number {
  const ranks = [ref.key, ...ref.environmentIds]
    .map((key) => stored.get(key))
    .filter((rank): rank is number => rank !== undefined);
  return ranks.length === 0 ? fallback : Math.min(...ranks);
}
