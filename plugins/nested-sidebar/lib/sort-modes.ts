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

export const PROJECT_SORT_MODES = [
  "manual",
  "name-asc",
  "name-desc",
  "threads-desc",
  "updated-desc",
  "status",
] as const;

export type ProjectSortMode = (typeof PROJECT_SORT_MODES)[number];

export const THREAD_SORT_MODES = [
  "manual",
  "created-desc",
  "created-asc",
  "updated-desc",
  "updated-asc",
  "attention-desc",
  "name-asc",
  "status",
] as const;

export type ThreadSortMode = (typeof THREAD_SORT_MODES)[number];

/**
 * The worktree level's lens.
 *
 * Same shape as the other two, and the same default, but one rule is its own:
 * the checkout never takes part in the ranking. It is the project itself — the
 * one row that is always there — so it leads under every mode and only the
 * worktrees beneath it are ordered. That is also why there is no descending
 * name: the checkout already owns the top of the list, and a second name order
 * would only be a way to reverse the worktrees under a fixed header.
 */
export const WORKTREE_SORT_MODES = [
  "manual",
  "name-asc",
  "updated-desc",
  "threads-desc",
  "status",
] as const;

export type WorktreeSortMode = (typeof WORKTREE_SORT_MODES)[number];

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

export function isManualWorktreeSort(mode: WorktreeSortMode): boolean {
  return mode === "manual";
}
