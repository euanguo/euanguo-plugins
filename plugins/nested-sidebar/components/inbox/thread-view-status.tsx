/**
 * What the list says when it is not simply showing the live tree.
 *
 * Two surfaces, and the difference between them is the whole point of the
 * recovery path:
 *
 * - A **notice** sits above rows that are real but not current. The tree stays
 *   exactly where the user left it, and the line is the only thing that admits
 *   the refresh did not land. Replacing a good tree over a failed refresh is the
 *   failure this exists to prevent.
 * - A **failure** is the cold case: nothing to draw, and no last answer to fall
 *   back on. It is the only state that owns the whole scroll area, and it is the
 *   only one that offers the retry — which is a real read of bb's own thread
 *   table through the plugin's backend, not a re-render.
 */

import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/**
 * A non-blocking line: the rows below are real, one refresh behind.
 *
 * Not dismissible. The state it describes is not a notification the user can
 * clear — it is a fact about what they are looking at, and it stops being true
 * the moment the host answers again.
 */
export function ThreadViewNotice({ text }: { text: string }) {
  return (
    <p
      role="status"
      className={cn(
        "mx-1.5 mb-1 flex items-start gap-1.5 rounded-md px-1.5 py-1",
        "text-2xs text-muted-foreground",
        "border border-sidebar-border/60 bg-sidebar-accent/25",
      )}
    >
      <Icon
        name="CircleX"
        className="mt-px size-3 shrink-0 text-muted-foreground/70"
        aria-hidden
      />
      <span className="min-w-0">{text}</span>
    </p>
  );
}

/**
 * The arrangement on screen is not the one the server holds.
 *
 * It lives beside the thread-view notices because it is the same kind of thing:
 * a statement about whether what the user is looking at is the truth. It is
 * actionable, though, which the other two are not — so it carries the one button
 * that fixes it, and it stays until the user presses it.
 *
 * Raised when a drag is refused for being built on a stale revision. Two clients
 * holding the arrangement at once is the normal case — a desktop and a browser —
 * and without this the second window's drag simply reverts with no explanation.
 */
export function OrderChangedNotice({ onReload }: { onReload: () => void }) {
  return (
    <p
      role="status"
      className={cn(
        "mx-1.5 mb-1 flex items-start gap-1.5 rounded-md px-1.5 py-1",
        "text-2xs text-muted-foreground",
        "border border-sidebar-border/60 bg-sidebar-accent/25",
      )}
    >
      <Icon
        name="ArrowTurnBackward"
        className="mt-px size-3 shrink-0 text-muted-foreground/70"
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        The order changed in another window, so this one is not up to date.
      </span>
      <button
        type="button"
        onClick={onReload}
        className={cn(
          "shrink-0 rounded px-1 font-medium text-foreground",
          "hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        )}
      >
        Reload
      </button>
    </p>
  );
}

/**
 * The cold failure, and the two ways out of it.
 *
 * `onRetry` reads the live view from bb's SDK — the one route back a plugin
 * actually has, since `experimental_useSidebarThreads` has no refetch. It is
 * offered only here, because a retry while rows are on screen would be a button
 * that appears to do nothing: the rows are already as current as they can be.
 *
 * `onUseOriginal` hands the scroll area to Nest's flat recovery view. A retry
 * can fail, and a user looking at a sidebar that is not working should still
 * have a way to see and open the rows the recovery read returned.
 */
export function ThreadLoadFailure({
  recovering,
  error,
  onRetry,
  onUseOriginal,
}: {
  recovering: boolean;
  /** Why the last retry failed, when one has. */
  error: string | null;
  onRetry: () => void;
  /** Draw bb's own thread list in place of this one. */
  onUseOriginal: () => void;
}) {
  return (
    <div className={cn("px-2 py-6 text-center")}>
      <p role="status" className="text-xs text-muted-foreground">
        Could not load threads.
      </p>
      <div className="mt-2 flex items-center justify-center gap-1.5">
        <button
          type="button"
          onClick={onRetry}
          disabled={recovering}
          className={cn(
            "inline-flex h-6 items-center gap-1.5 rounded-md px-2",
            "border border-sidebar-border text-2xs font-medium text-foreground",
            "hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "disabled:opacity-60",
          )}
        >
          {recovering ? (
            <>
              <Icon name="Loading" className="size-3 animate-spin" aria-hidden />
              Trying…
            </>
          ) : (
            "Try again"
          )}
        </button>
        <button
          type="button"
          onClick={onUseOriginal}
          className={cn(
            "inline-flex h-6 items-center rounded-md px-2",
            "text-2xs text-muted-foreground",
            "hover:bg-sidebar-accent hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          )}
        >
          Show flat list
        </button>
      </div>
      {error === null ? null : (
        <p className="mx-auto mt-2 max-w-56 text-2xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
