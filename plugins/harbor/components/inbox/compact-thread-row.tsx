import { memo } from "react";
import {
  experimental_useSidebarThreadSplit as useSidebarThreadSplit,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";

import { StatusOrTime } from "@/components/inbox/status-slot";
import { ThreadRowMenu } from "@/components/inbox/thread-menu-items";
import { ThreadRowLink } from "@/components/inbox/thread-row-link";
import { usePointerCoarse } from "@/components/ui/hooks/use-pointer-coarse";
import { Icon, type IconName } from "@/components/ui/icon";
import { threadDisplayTitle } from "@/lib/domain/inbox";
import { snoozeWakeLabel } from "@/lib/domain/lifecycle";
import { relativeTimeLabel } from "@/lib/domain/relative-time";
import { cn } from "@/lib/ui/utils";

export type CompactThreadRowProps =
  | {
      variant: "loose";
      thread: PluginSidebarThread;
      active: boolean;
      now: number;
      onNavigate: () => void;
    }
  | {
      variant: "parked";
      thread: PluginSidebarThread;
      active: boolean;
      shelf: "snoozed" | "settled";
      wakeAt: number | null;
      now: number;
      onNavigate: () => void;
      onRestore: () => void;
    }
  | {
      variant: "archived";
      thread: PluginSidebarThread;
      now: number;
      onNavigate: () => void;
      onRestore: () => void;
    };

/**
 * Unified single-line thread row shared by Workspaces-mode loose rows,
 * Snoozed/Settled shelf rows, and Archived shelf rows.
 */
export const CompactThreadRow = memo(function CompactThreadRow(
  props: CompactThreadRowProps,
) {
  const { variant, thread, now, onNavigate } = props;
  const { layout } = useSidebarThreadSplit(thread.id);
  const coarse = usePointerCoarse();
  const title = threadDisplayTitle(thread);
  const active = variant === "archived" ? false : props.active;

  if (variant === "loose") {
    return (
      <ThreadRowMenu thread={thread}>
        <div
          className={cn(
            "group/compact relative flex h-7 items-center gap-2 rounded-md pl-4 pr-1.5 text-xs",
            active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/50",
          )}
        >
          <ThreadRowLink
            thread={thread}
            active={active}
            onNavigate={onNavigate}
            ariaLabel={title}
            shortcutTarget={false}
            splitSource={false}
            className="rounded-md"
          />
          <span className="pointer-events-none relative min-w-0 flex-1 truncate text-foreground/85">
            {title}
          </span>
          <span className="pointer-events-none relative shrink-0">
            <StatusOrTime thread={thread} now={now} />
          </span>
        </div>
      </ThreadRowMenu>
    );
  }

  const isArchived = variant === "archived";
  const restoreLabel = isArchived
    ? `Unarchive ${title}`
    : props.shelf === "snoozed"
      ? "Wake thread now"
      : "Un-settle thread";
  const restoreIcon: IconName = isArchived
    ? "ArchiveRestore"
    : props.shelf === "snoozed"
      ? "Clock"
      : "ArrowTurnBackward";

  const row = (
    <li
      className={cn(
        "list-none relative flex items-center gap-2 rounded-md",
        isArchived
          ? "group/archived h-7 px-1.5 text-2xs"
          : cn(
              "group/slim h-8 px-2.5 text-xs",
              active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60",
              !active && layout !== null && "bg-sidebar-accent/25",
            ),
      )}
    >
      <ThreadRowLink
        thread={thread}
        active={active}
        onNavigate={onNavigate}
        ariaLabel={isArchived ? `${title} — archived` : title}
        mode={isArchived ? "archived" : undefined}
        splitSource={!isArchived}
        className="rounded-md"
      />
      <span
        className={cn(
          "pointer-events-none relative min-w-0 flex-1 truncate",
          isArchived
            ? "text-muted-foreground"
            : "text-foreground group-hover/slim:text-foreground",
        )}
      >
        {title}
      </span>
      <span
        className={cn(
          "pointer-events-none shrink-0 tabular-nums",
          isArchived
            ? "relative text-muted-foreground/50"
            : cn(
                "text-2xs text-muted-foreground/60 transition-opacity duration-150 ease-out motion-reduce:transition-none",
                coarse ? "opacity-0" : "group-hover/slim:opacity-0",
              ),
        )}
      >
        {isArchived ? (
          relativeTimeLabel(thread.updatedAt, now)
        ) : props.shelf === "snoozed" && props.wakeAt !== null ? (
          snoozeWakeLabel(props.wakeAt, now)
        ) : (
          <StatusOrTime thread={thread} now={now} />
        )}
      </span>
      <button
        type="button"
        aria-label={restoreLabel}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          props.onRestore();
        }}
        className={cn(
          "z-10 shrink-0 rounded text-muted-foreground hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none",
          coarse ? "opacity-100" : "opacity-0",
          isArchived
            ? "relative px-1 py-0.5 hover:bg-sidebar-accent focus-visible:ring-1 focus-visible:ring-ring group-hover/archived:opacity-100"
            : "pointer-events-auto absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 group-hover/slim:opacity-100",
        )}
      >
        <Icon
          name={restoreIcon}
          className={isArchived ? "size-3" : "size-3.5"}
          aria-hidden
        />
      </button>
    </li>
  );

  return isArchived ? (
    row
  ) : (
    <ThreadRowMenu thread={thread} onUnarchive={props.onRestore}>
      {row}
    </ThreadRowMenu>
  );
});
