import { cn } from "@/lib/utils";

const PAGE_BUTTON_CLASS =
  "rounded px-1.5 py-1 text-2xs font-medium text-muted-foreground hover:bg-sidebar-accent hover:text-foreground";

/**
 * The controls a paged list ends with.
 *
 * An explicit control rather than a scroll sentinel: a list is read top-down
 * looking for one row, and asking for more is a decision the user makes, not one
 * arriving on the way past. **Show less** is the same decision in reverse — it
 * goes back to the first page rather than removing one page at a time, because
 * what it is for is putting an expanded list away, and four clicks to undo four
 * is not putting it away.
 *
 * One component rather than one per list, so a project's rows, a worktree's rows
 * and the settled shelf cannot drift into three different controls — and so the
 * label, which depends on what is left, is computed in one place.
 */
export function PageControls({
  hasMore,
  remaining,
  page,
  onLoadMore,
  onShowLess,
  className,
}: {
  /** False once everything is drawn, or while a search is drawing it all. */
  hasMore: boolean;
  /** How many rows the next click adds, from `nextPageSize`. */
  remaining: number;
  /** How many pages are drawn. One means there is nothing to put away. */
  page: number;
  onLoadMore: () => void;
  onShowLess: () => void;
  className?: string;
}) {
  return (
    <div className={cn("mt-1 flex items-center gap-1", className)}>
      {hasMore ? (
        <button
          type="button"
          onClick={onLoadMore}
          className={PAGE_BUTTON_CLASS}
        >
          Load {remaining} more
        </button>
      ) : null}
      {page > 1 ? (
        <button
          type="button"
          onClick={onShowLess}
          className={PAGE_BUTTON_CLASS}
        >
          Show less
        </button>
      ) : null}
    </div>
  );
}
