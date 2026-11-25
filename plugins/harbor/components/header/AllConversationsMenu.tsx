import { type PointerEvent, useEffect, useRef, useState } from "react";
import {
  FamilyStatusIcon,
  familyStatusNeedsIcon,
  StatusDot,
} from "@/components/inbox/family-status";
import { Icon } from "@/components/ui/icon";
import { Menu, MenuLabel, MenuRow } from "@/components/ui/menu";
import {
  filterWorkspaceTabs,
  idleSettleableTabIds,
  shouldShowWorkspaceSearch,
  type WorkspaceTab,
} from "@/lib/domain/workspace-tabs";
import { cn } from "@/lib/ui/utils";

export { idleSettleableTabIds };

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
/**
 * One action per conversation, on a target a thumb can hit.
 *
 * The row's own 16px buttons are a pointer's size; on a touch screen they grow
 * to 28 and the row to 40, which is what bb's own coarse scale does.
 */
// bb's own coarse scale for an icon button: a 36px target around a 20px glyph.
// At 32/12 the glyph read as a bullet rather than a control.
const ROW_ACTION_CLASS =
  "inline-flex size-4 items-center justify-center rounded-sm text-subtle-foreground hover:bg-state-hover hover:text-foreground [@media(pointer:coarse)]:size-9";
// Single-line rows, and 44px tall on touch: centring the title against the
// action cluster is what makes the row read as one line, not a stack.
const ROW_CLASS = "items-center [@media(pointer:coarse)]:min-h-11";

export function AllConversationsMenu({
  tabs,
  currentThreadId,
  onOpen,
  onSettle,
  onSnooze,
  onTogglePin,
  onBatchSettleIdle,
  canSettleTab,
  canSnoozeTab,
  compact = false,
  currentTitle,
}: {
  tabs: readonly WorkspaceTab[];
  currentThreadId: string | null;
  onOpen(threadId: string): void;
  onSettle?(threadId: string): void;
  onSnooze?(threadId: string): void;
  onTogglePin?(tab: WorkspaceTab): void;
  onBatchSettleIdle?(threadIds: readonly string[]): void;
  canSettleTab?(tab: WorkspaceTab): boolean;
  canSnoozeTab?(tab: WorkspaceTab): boolean;
  /**
   * The phone bar's chip: it names the conversation the pane shows and opens
   * this list, because a 390px row cannot hold a tab per conversation.
   */
  compact?: boolean;
  /** The chip's label when the pane shows something other than a conversation. */
  currentTitle?: string;
}) {
  const current = tabs.find((tab) => tab.thread.id === currentThreadId);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const frame = requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);
  const visible = filterWorkspaceTabs(tabs, query);
  const idleIds = idleSettleableTabIds(tabs, currentThreadId);

  return (
    <Menu
      label={`All conversations (${tabs.length})`}
      // A phone drop-down is as wide as its trigger unless it asks for more;
      // here it asks for the screen minus its margins, so a long title has room
      // before it has to ellipsise. The width is bounded rather than intrinsic:
      // sizing to content let a long title push the list past the screen edge.
      className={compact ? "w-[calc(100vw-2rem)] max-w-[24rem]" : "w-72 max-w-[22rem]"}
      align={compact ? "start" : "end"}
      sideOffset={compact ? 6 : 4}
      open={open}
      onOpenChange={setOpen}
      trigger={
        compact ? (
          <button
            type="button"
            aria-label={`Switch conversation (${tabs.length} in this workspace)`}
            // 20px is what bb renders for a menu surface at this width; the
            // strip's own `rounded-md` resolves to half that, so the chip that
            // opens the list would otherwise read as a different family.
            className="inline-flex h-10 min-w-0 flex-1 items-center gap-1.5 rounded-[1.25rem] border border-border px-3 text-sm text-foreground active:bg-state-hover"
          >
            {current === undefined ? null : (
              <StatusDot status={current.status} className="size-2 shrink-0" />
            )}
            <span className="min-w-0 truncate">
              {currentTitle ??
                current?.thread.displayTitle ??
                `Conversations (${tabs.length})`}
            </span>
            <Icon
              name="ChevronDown"
              className="ml-auto size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
          </button>
        ) : (
          <button
            type="button"
            className="inline-flex h-7 shrink-0 items-center gap-1 self-center rounded-md px-2 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground"
          >
            All ({tabs.length})
            <Icon name="ChevronDown" className="size-3" aria-hidden />
          </button>
        )
      }
    >
      {shouldShowWorkspaceSearch(tabs.length) ? (
        <div className="px-2 pb-1">
          <input
            ref={searchInputRef}
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
      <div className="max-h-72 overflow-x-hidden overflow-y-auto">
        {visible.length === 0 ? (
          <p className="px-2 py-1.5 text-2xs text-muted-foreground">
            No conversation matches.
          </p>
        ) : null}
        {visible.map((tab) => (
          <MenuRow
            key={tab.thread.id}
            onSelect={() => onOpen(tab.thread.id)}
            className={cn(
              ROW_CLASS,
              tab.thread.id === currentThreadId && "bg-accent/50",
            )}
          >
            <FamilyStatusIcon
              status={tab.status}
              variant={familyStatusNeedsIcon(tab.status) ? "icon" : "dot"}
              className="size-4"
            />
            <span className="min-w-0 flex-1 truncate">
              {tab.thread.displayTitle}
            </span>
            {tab.childCount === 0 ? null : (
              <span
                title={`${tab.childCount} child threads`}
                className="shrink-0 rounded-full bg-current/10 px-1 text-[10px] leading-4 tabular-nums text-muted-foreground"
              >
                {tab.childCount}
              </span>
            )}
            <span className="flex shrink-0 items-center gap-0.5">
              {onTogglePin === undefined ? null : (
              <button
                type="button"
                aria-label={`${tab.thread.isPinned ? "Unpin" : "Pin"} ${tab.thread.displayTitle}`}
                title={tab.thread.isPinned ? "Unpin" : "Pin"}
                className={ROW_ACTION_CLASS}
                {...STOP}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onTogglePin(tab);
                }}
              >
                <Icon
                  name={tab.thread.isPinned ? "PinOff" : "Pin"}
                  className="size-3.5 [@media(pointer:coarse)]:size-5"
                  aria-hidden
                />
              </button>
              )}
              {onSettle === undefined || (canSettleTab !== undefined && !canSettleTab(tab)) ? null : (
              <button
                type="button"
                aria-label={`Settle ${tab.thread.displayTitle}`}
                title="Settle"
                className={ROW_ACTION_CLASS}
                {...STOP}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onSettle(tab.thread.id);
                }}
              >
                <Icon
                  name="Archive"
                  className="size-3.5 [@media(pointer:coarse)]:size-5"
                  aria-hidden
                />
              </button>
              )}
              {onSnooze === undefined || (canSnoozeTab !== undefined && !canSnoozeTab(tab)) ? null : (
              <button
                type="button"
                aria-label={`Snooze ${tab.thread.displayTitle} until tomorrow`}
                title="Snooze until tomorrow"
                className={ROW_ACTION_CLASS}
                {...STOP}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onSnooze(tab.thread.id);
                }}
              >
                <Icon
                  name="Clock"
                  className="size-3.5 [@media(pointer:coarse)]:size-5"
                  aria-hidden
                />
              </button>
              )}
            </span>
          </MenuRow>
        ))}
      </div>
      {onBatchSettleIdle !== undefined && idleIds.length >= 2 ? (
        <div className="mt-1 border-t border-border pt-1 px-1">
          <button
            type="button"
            onClick={() => {
              onBatchSettleIdle(idleIds);
              setOpen(false);
            }}
            className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-left text-2xs text-muted-foreground hover:bg-state-hover hover:text-foreground"
          >
            <Icon name="Archive" className="size-3 shrink-0" aria-hidden />
            Clean up {idleIds.length} idle
          </button>
        </div>
      ) : null}
    </Menu>
  );
}
