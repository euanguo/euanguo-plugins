/**
 * How much of a list the sidebar draws at once.
 *
 * Two lists page: the settled shelf, where a day of settling piles up, and a
 * project's or worktree's thread list, where a long-running project piles up.
 * Both are read top-down looking for one row, and in both the row being looked
 * for is almost always near the top.
 *
 * The shelf's rule is derived from BB Sidebar (`src/ThreadInbox.tsx`'s
 * `visibleShelfThreads`, `SETTLED_INITIAL_LIMIT` and `SETTLED_PAGE_SIZE`), with
 * two deliberate divergences: the page is user-configurable rather than fixed,
 * and the first draw and every later click use the same size. A five-row first
 * page followed by a twenty-five-row jump reads as two different controls.
 *
 * Kept pure so it can be tested without a bb server.
 */

/** How many rows a page holds, until the user says otherwise. */
export const DEFAULT_PAGE_SIZE = 5;

export const MIN_PAGE_SIZE = 1;
export const MAX_PAGE_SIZE = 100;

/**
 * The configured page size, or the default.
 *
 * Bounds live here rather than in the settings declaration so there is one
 * place to change them: a stored value from an older build, a hand-edited
 * database, and a `NaN` all have to land on something drawable.
 */
export function resolvePageSize(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, Math.floor(value)));
}

/**
 * The rows a paged list draws.
 *
 * A filter rather than a slice, because the open thread keeps its place past
 * the limit: the row the user is on must never be the one held back. Filtering
 * also means an active row already inside the limit cannot be drawn twice.
 *
 * `idOf` is asked rather than assumed: the lists that page hold different
 * things — a settled thread, a thread family whose id is its root's — and a
 * silent `row.id` would match nothing on the families and quietly drop the
 * escape hatch.
 */
export function visibleRows<T>(
  rows: readonly T[],
  limit: number,
  activeRowId: string | null,
  idOf: (row: T) => string,
): T[] {
  return rows.filter((row, index) => index < limit || idOf(row) === activeRowId);
}

/** Whether the list is still holding rows back. */
export function hasMoreRows(total: number, limit: number): boolean {
  return total > limit;
}

/** How many rows the next click adds, for the button's own label. */
export function nextPageSize(
  total: number,
  limit: number,
  pageSize: number,
): number {
  return Math.max(0, Math.min(pageSize, total - limit));
}
