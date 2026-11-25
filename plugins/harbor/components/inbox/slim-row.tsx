import {
  experimental_useSidebarThreadSplit as useSidebarThreadSplit,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { memo, useCallback } from "react";
import { Icon } from "@/components/ui/icon";
import { usePointerCoarse } from "@/components/ui/hooks/use-pointer-coarse";
import { cn } from "@/lib/ui/utils";
import { ThreadRowMenu } from "@/components/inbox/thread-menu-items";
import { ThreadRowLink } from "@/components/inbox/thread-row-link";
import { StatusOrTime } from "@/components/inbox/status-slot";
import { threadDisplayTitle } from "@/lib/domain/inbox";
import { snoozeWakeLabel } from "@/lib/domain/lifecycle";
import type { LifecycleApi } from "@/hooks/use-lifecycle";

/**
 * A parked thread: one line instead of a card. Density comes from the user
 * actually parking work, never from the sidebar guessing what still matters.
 *
 * Same structure as the card — a full-bleed anchor under the restore button,
 * because a `<button>` inside an `<a>` is invalid interactive nesting.
 */
export const SlimRow = memo(function SlimRow({
  thread,
  isActive,
  shelf,
  wakeAt,
  now,
  onNavigate,
  lifecycle,
}: {
  thread: PluginSidebarThread;
  isActive: boolean;
  shelf: "snoozed" | "settled";
  wakeAt: number | null;
  now: number;
  onNavigate: () => void;
  lifecycle: LifecycleApi;
}) {
  /**
   * A parked row is still a thread, so it is still a split source.
   *
   * The shelves used to be the one place a row could not be dragged out to a
   * pane: modifier-click opened one, but the drag did not, and a thread open in
   * another pane went untinted. `layout` is read for that tint and `isAvailable`
   * is not consulted, because a parked row draws no open-in-split affordance of
   * its own — the gesture is the whole of it.
   */
  const { layout } = useSidebarThreadSplit(thread.id);
  const title = threadDisplayTitle(thread);
  // No hover on a coarse pointer, so the restore control would never appear —
  // and `pointer-events-auto` on an invisible button means a tap on empty row
  // space restores the thread instead. Always shown there.
  const coarse = usePointerCoarse();
  const onRestore = useCallback(() => {
    if (shelf === "snoozed") {
      lifecycle.unsnooze(thread.id);
      return;
    }
    lifecycle.unsettle(thread.id);
  }, [lifecycle, shelf, thread.id]);

  return (
    <ThreadRowMenu thread={thread} onUnarchive={onRestore}>
      <li className="list-none">
        <div
          className={cn(
            "group/slim relative flex h-8 items-center gap-2 rounded-md px-2.5 text-xs",
            isActive ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60",
            // A thread open in another pane gets a weaker tint than the active
            // row, so the two states stay distinguishable.
            !isActive && layout !== null && "bg-sidebar-accent/25",
          )}
        >
          {/* Must stay an anchor: the shortcut-target contract and
              modifier-click split-open both depend on it. A button breaks
              each. */}
          <ThreadRowLink
            thread={thread}
            active={isActive}
            onNavigate={onNavigate}
            ariaLabel={title}
            className="rounded-md"
          />
          <span
            className={cn(
              "pointer-events-none relative min-w-0 flex-1 truncate",
              "text-foreground",
              "group-hover/slim:text-foreground",
            )}
          >
            {title}
          </span>
          {/* The age is intrinsic. Restore is a hover-only overlay, so it does
              not make every parked row reserve an action-sized column. */}
          <span
            className={cn(
              "pointer-events-none shrink-0 tabular-nums text-2xs text-muted-foreground/60 transition-opacity duration-150 ease-out motion-reduce:transition-none",
              coarse ? "opacity-0" : "group-hover/slim:opacity-0",
            )}
          >
            {shelf === "snoozed" && wakeAt !== null ? (
              snoozeWakeLabel(wakeAt, now)
            ) : (
              <StatusOrTime thread={thread} now={now} />
            )}
          </span>
          <button
            type="button"
            aria-label={
              shelf === "snoozed" ? "Wake thread now" : "Un-settle thread"
            }
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onRestore();
            }}
            className={cn(
              "pointer-events-auto absolute right-1.5 top-1/2 z-10 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:opacity-100 group-hover/slim:opacity-100",
              coarse ? "opacity-100" : "opacity-0",
            )}
          >
            <Icon
              name={shelf === "snoozed" ? "Clock" : "ArrowTurnBackward"}
              className="size-3.5"
            />
          </button>
        </div>
      </li>
    </ThreadRowMenu>
  );
});
