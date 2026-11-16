import { useEffect, useState, type PointerEvent } from "react";

import { Icon } from "@/components/ui/icon";
import {
  FamilyStatusIcon,
  familyStatusNeedsIcon,
} from "@/components/inbox/family-status";
import { Menu, MenuLabel, MenuRow } from "@/components/ui/menu";
import { cn } from "@/lib/ui/utils";
import {
  filterWorkspaceTabs,
  shouldShowWorkspaceSearch,
  type WorkspaceTab,
} from "@/lib/domain/workspace-tabs";

const STOP = {
  onPointerDown: (event: PointerEvent) => event.stopPropagation(),
  onPointerUp: (event: PointerEvent) => event.stopPropagation(),
};

/**
 * Every conversation in the workspace, for the ones the strip cannot fit.
 *
 * The strip is a row of tabs, and a workspace with 44 conversations has more
 * than a row can show. This is the lookup surface: all of them in the strip's
 * order — pinned first, then most recently used — each with its family state,
 * and each one can be opened, pinned, settled, or snoozed without first
 * opening it. Past eight rows
 * it grows a search field.
 */
export function AllConversationsMenu({
  tabs,
  currentThreadId,
  onOpen,
  onSettle,
  onSnooze,
  onTogglePin,
}: {
  tabs: readonly WorkspaceTab[];
  currentThreadId: string | null;
  onOpen(threadId: string): void;
  onSettle(threadId: string): void;
  onSnooze(threadId: string): void;
  onTogglePin(tab: WorkspaceTab): void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);
  const visible = filterWorkspaceTabs(tabs, query);

  return (
    <Menu
      label={`All conversations (${tabs.length})`}
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button
          type="button"
          className="inline-flex h-7 shrink-0 items-center gap-1 self-center rounded-md px-2 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground"
        >
          All ({tabs.length})
          <Icon name="ChevronDown" className="size-3" aria-hidden />
        </button>
      }
    >
      {shouldShowWorkspaceSearch(tabs.length) ? (
        <div className="px-2 pb-1">
          <input
            autoFocus
            value={query}
            aria-label="Search conversations"
            placeholder={`Search ${tabs.length} conversations`}
            className="h-6 w-full rounded-sm border border-border bg-transparent px-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => event.stopPropagation()}
          />
        </div>
      ) : null}
      <MenuLabel>
        {query.trim().length === 0
          ? "Conversations"
          : `Matches (${visible.length} of ${tabs.length})`}
      </MenuLabel>
      <div className="max-h-72 overflow-y-auto">
        {visible.length === 0 ? (
          <p className="px-2 py-1.5 text-2xs text-muted-foreground">
            No conversation matches.
          </p>
        ) : null}
        {visible.map((tab) => (
          <MenuRow
            key={tab.thread.id}
            onSelect={() => onOpen(tab.thread.id)}
            className={cn(tab.thread.id === currentThreadId && "bg-accent/50")}
          >
            <FamilyStatusIcon
              status={tab.status}
              variant={familyStatusNeedsIcon(tab.status) ? "icon" : "dot"}
              className="mt-0.5 size-4"
            />
            <span className="min-w-0 flex-1 truncate">
              {tab.thread.displayTitle}
            </span>
            {tab.childCount === 0 ? null : (
              <span
                title={`${tab.childCount} child threads`}
                className="mt-0.5 shrink-0 rounded-full bg-current/10 px-1 text-[10px] leading-4 tabular-nums text-muted-foreground"
              >
                {tab.childCount}
              </span>
            )}
            <span className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                aria-label={`${tab.thread.isPinned ? "Unpin" : "Pin"} ${tab.thread.displayTitle}`}
                title={tab.thread.isPinned ? "Unpin" : "Pin"}
                className="inline-flex size-4 items-center justify-center rounded-sm text-subtle-foreground hover:bg-state-hover hover:text-foreground"
                {...STOP}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onTogglePin(tab);
                }}
              >
                <Icon
                  name={tab.thread.isPinned ? "PinOff" : "Pin"}
                  className="size-3"
                  aria-hidden
                />
              </button>
              <button
                type="button"
                aria-label={`Settle ${tab.thread.displayTitle}`}
                title="Settle"
                className="inline-flex size-4 items-center justify-center rounded-sm text-subtle-foreground hover:bg-state-hover hover:text-foreground"
                {...STOP}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onSettle(tab.thread.id);
                }}
              >
                <Icon name="Archive" className="size-3" aria-hidden />
              </button>
              <button
                type="button"
                aria-label={`Snooze ${tab.thread.displayTitle} until tomorrow`}
                title="Snooze until tomorrow"
                className="inline-flex size-4 items-center justify-center rounded-sm text-subtle-foreground hover:bg-state-hover hover:text-foreground"
                {...STOP}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onSnooze(tab.thread.id);
                }}
              >
                <Icon name="Clock" className="size-3" aria-hidden />
              </button>
            </span>
          </MenuRow>
        ))}
      </div>
    </Menu>
  );
}
