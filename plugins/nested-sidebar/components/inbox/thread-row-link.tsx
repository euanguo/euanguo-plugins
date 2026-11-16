import type { ReactNode } from "react";
import {
  experimental_useSidebarThreadSplit as useSidebarThreadSplit,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";

import { useThreadActions } from "@/hooks/use-thread-actions";
import {
  threadRowAriaCurrent,
  threadRowSplitClick,
} from "@/lib/domain/thread-row-link";
import { cn } from "@/lib/ui/utils";

/**
 * The one full-row anchor every thread row draws under its content.
 *
 * The anchor carries the sidebar's shortcut and split-drag contracts
 * (`data-sidebar-thread-shortcut-target` plus the spread `splitProps`), the
 * `aria-current` state, and the keyboard focus ring. The row keeps its own
 * radius, tint, and density; position the anchor with `className` on top of
 * the shared `absolute inset-0` base.
 */
export function ThreadRowLink({
  thread,
  active,
  onNavigate,
  className,
  ariaLabel,
  focusRing = true,
  mode = "split",
  shortcutTarget = true,
  splitSource = true,
  children,
}: {
  thread: PluginSidebarThread;
  active: boolean;
  onNavigate: () => void;
  className?: string;
  ariaLabel?: string;
  focusRing?: boolean;
  /**
   * `split` is every live row: a plain click opens, a modified one opens a
   * split pane. `archived` is the archived shelf: a modified click is the
   * host's (new tab, copy link), and a plain one calls the caller's open.
   */
  mode?: "split" | "archived";
  /** Whether this row is a target for the host's numbered shortcuts. */
  shortcutTarget?: boolean;
  /** Whether the row carries bb's drag-to-split props. */
  splitSource?: boolean;
  children?: ReactNode;
}) {
  const actions = useThreadActions();
  const { splitProps } = useSidebarThreadSplit(thread.id);
  return (
    <a
      data-sidebar-thread-shortcut-target={shortcutTarget ? "" : undefined}
      data-sidebar-thread-id={thread.id}
      href={thread.href}
      aria-label={ariaLabel}
      aria-current={threadRowAriaCurrent(active)}
      {...(splitSource ? splitProps : {})}
      onClick={(event) => {
        if (
          mode === "archived" &&
          (event.metaKey || event.ctrlKey || event.shiftKey)
        ) {
          return;
        }
        // The primary click is ours: it carries the split gesture and any
        // row-level navigation side effects. The href is the host's route, so
        // middle-click and copy-link work without this handler.
        event.preventDefault();
        if (mode === "split") {
          actions.open(thread.id, { split: threadRowSplitClick(event) });
        }
        onNavigate();
      }}
      className={cn(
        "absolute inset-0 cursor-pointer",
        focusRing &&
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className,
      )}
    >
      {children}
    </a>
  );
}
