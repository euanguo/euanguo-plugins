/**
 * How the tree is ordered.
 *
 * Ordering has two halves that must not be confused: the *manual order* is
 * data the user arranged by dragging, and the *sort mode* is the lens that
 * decides whether that data is read. `manual` is the default everywhere,
 * because this sidebar's whole promise is that activity never re-orders the
 * list — a row keeps its place until the user moves it.
 *
 * Kept free of any inbox or SDK type so the server can validate a stored mode
 * without pulling the frontend in.
 */

import {
  PROJECT_SORT_MODES,
  THREAD_SORT_MODES,
  WORKTREE_SORT_MODES,
  type ProjectSortMode,
  type ThreadSortMode,
  type WorktreeSortMode,
} from "../schemas/settings.ts";

export {
  PROJECT_SORT_MODES,
  THREAD_SORT_MODES,
  WORKTREE_SORT_MODES,
  type ProjectSortMode,
  type ThreadSortMode,
  type WorktreeSortMode,
};

export const PROJECT_SORT_LABELS: Readonly<Record<ProjectSortMode, string>> = {
  manual: "Manual",
  "name-asc": "Name A→Z",
  "name-desc": "Name Z→A",
  "threads-desc": "Most threads",
  "updated-desc": "Recently updated",
  status: "Status",
};

export const THREAD_SORT_LABELS: Readonly<Record<ThreadSortMode, string>> = {
  manual: "Manual",
  "created-desc": "Newest",
  "created-asc": "Oldest",
  "updated-desc": "Recently updated",
  "updated-asc": "Least recent",
  "attention-desc": "Recent attention",
  "name-asc": "Name",
  status: "Status",
};

export const WORKTREE_SORT_LABELS: Readonly<Record<WorktreeSortMode, string>> = {
  manual: "Manual",
  "name-asc": "Name",
  "updated-desc": "Recently updated",
  "threads-desc": "Most threads",
  status: "Status",
};

export const DEFAULT_PROJECT_SORT: ProjectSortMode = "manual";
export const DEFAULT_THREAD_SORT: ThreadSortMode = "manual";
export const DEFAULT_WORKTREE_SORT: WorktreeSortMode = "manual";

export function validProjectSort(value: unknown): value is ProjectSortMode {
  return (
    typeof value === "string" &&
    (PROJECT_SORT_MODES as readonly string[]).includes(value)
  );
}

export function validThreadSort(value: unknown): value is ThreadSortMode {
  return (
    typeof value === "string" &&
    (THREAD_SORT_MODES as readonly string[]).includes(value)
  );
}

export function validWorktreeSort(value: unknown): value is WorktreeSortMode {
  return (
    typeof value === "string" &&
    (WORKTREE_SORT_MODES as readonly string[]).includes(value)
  );
}

/** True when a mode reads the user's manual arrangement and allows dragging. */
export function isManualProjectSort(mode: ProjectSortMode): boolean {
  return mode === "manual";
}

export function isManualThreadSort(mode: ThreadSortMode): boolean {
  return mode === "manual";
}
