import { type PointerEvent, useEffect, useRef, useState } from "react";
import {
  FamilyStatusIcon,
  familyStatusNeedsIcon,
  StatusDot,
} from "@/components/inbox/family-status";
import { Icon } from "@bb-ui/icon";
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

const ROW_ACTION_CLASS =
  "inline-flex size-4 items-center justify-center rounded-sm text-subtle-foreground hover:bg-state-hover hover:text-foreground [@media(pointer:coarse)]:size-9";
const ROW_CLASS = "items-center [@media(pointer:coarse)]:min-h-11";
const POINTER_MOVE_THRESHOLD_PX = 3;
const TYPING_HOVER_GUARD_MS = 400;

interface PointerPoint {
  readonly x: number;
  readonly y: number;
}

type FocusRegion = "search" | "item" | "action" | null;

function menuItemsOf(container: HTMLElement | null): HTMLElement[] {
  if (container === null) return [];
  return [
    ...container.querySelectorAll<HTMLElement>(
      '[role="menuitem"]:not([data-disabled])',
    ),
  ];
}

function hasPointerMoved(
  previous: PointerPoint | null,
  x: number,
  y: number,
): boolean {
  if (previous === null) return false;
  return (
    Math.abs(x - previous.x) > POINTER_MOVE_THRESHOLD_PX ||
    Math.abs(y - previous.y) > POINTER_MOVE_THRESHOLD_PX
  );
}

/**
 * Every conversation in the workspace, for the ones the strip cannot fit.
 */
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
  touchSized,
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
  compact?: boolean;
  touchSized?: boolean;
  currentTitle?: string;
}) {
  const useTouchSizing = touchSized ?? compact;
  const current = tabs.find((tab) => tab.thread.id === currentThreadId);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [keyboardRowNav, setKeyboardRowNav] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const keyboardNavRef = useRef(false);
  const lastTypingAtRef = useRef(0);
  const lastPointerRef = useRef<PointerPoint | null>(null);
  const focusedRegionRef = useRef<FocusRegion>(null);
  const lastKeyboardItemRef = useRef<HTMLElement | null>(null);
  const hasSearch = shouldShowWorkspaceSearch(tabs.length);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setKeyboardRowNav(false);
      keyboardNavRef.current = false;
      lastPointerRef.current = null;
      focusedRegionRef.current = null;
      lastKeyboardItemRef.current = null;
      return;
    }
    if (hasSearch) {
      keyboardNavRef.current = true;
      focusedRegionRef.current = "search";
    }
    const frame = requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [hasSearch, open]);

  // Radix's MenuItem `onPointerLeave` calls `contentRef.current?.focus()`,
  // which would yank focus out of the search box or keyboard-selected item
  // when filtered rows reflow or the pointer exits a row. Also tracks keyboard
  // navigation on the menu content and moves ArrowUp from the first item back
  // into the search box.
  useEffect(() => {
    if (!open) return;
    const listEl = listRef.current;
    const contentEl = listEl?.closest<HTMLElement>('[role="menu"]') ?? null;
    if (contentEl === null) return;

    const restoreFocusIfStolen = (event: FocusEvent) => {
      if (event.target !== contentEl) return;
      if (
        focusedRegionRef.current === "search" &&
        searchInputRef.current !== null
      ) {
        searchInputRef.current.focus({ preventScroll: true });
        return;
      }
      if (
        focusedRegionRef.current === "item" &&
        keyboardNavRef.current &&
        lastKeyboardItemRef.current?.isConnected === true
      ) {
        lastKeyboardItemRef.current.focus({ preventScroll: true });
      }
    };

    const handleContentKeyDown = (event: KeyboardEvent) => {
      if (event.target === searchInputRef.current) return;
      if (
        event.key !== "ArrowDown" &&
        event.key !== "ArrowUp" &&
        event.key !== "Home" &&
        event.key !== "End" &&
        event.key !== "PageUp" &&
        event.key !== "PageDown"
      ) {
        return;
      }
      if (event.key === "ArrowUp" && searchInputRef.current !== null) {
        const items = menuItemsOf(listEl);
        if (document.activeElement === items[0]) {
          event.preventDefault();
          event.stopPropagation();
          keyboardNavRef.current = true;
          setKeyboardRowNav(false);
          focusedRegionRef.current = "search";
          lastKeyboardItemRef.current = null;
          searchInputRef.current.focus();
          return;
        }
      }
      keyboardNavRef.current = true;
      setKeyboardRowNav(true);
    };

    contentEl.addEventListener("keydown", handleContentKeyDown, { capture: true });
    contentEl.addEventListener("focusin", restoreFocusIfStolen);
    return () => {
      contentEl.removeEventListener("keydown", handleContentKeyDown, {
        capture: true,
      });
      contentEl.removeEventListener("focusin", restoreFocusIfStolen);
    };
  }, [open]);

  const visible = filterWorkspaceTabs(tabs, query);
  const idleIds = idleSettleableTabIds(tabs, currentThreadId);

  const focusMenuItem = (target: HTMLElement | undefined) => {
    if (target === undefined) return;
    keyboardNavRef.current = true;
    setKeyboardRowNav(true);
    focusedRegionRef.current = "item";
    lastKeyboardItemRef.current = target;
    target.focus();
  };

  return (
    <Menu
      label={`All conversations (${tabs.length})`}
      className={
        useTouchSizing
          ? "w-[calc(100vw-2rem)] max-w-[24rem]"
          : "w-72 max-w-[22rem]"
      }
      align={compact ? "start" : "end"}
      sideOffset={useTouchSizing ? 6 : 4}
      open={open}
      onOpenChange={setOpen}
      trigger={
        compact ? (
          <button
            type="button"
            aria-label={`Switch conversation (${tabs.length} in this workspace)`}
            className={
              useTouchSizing
                ? "inline-flex h-10 min-w-0 flex-1 items-center gap-1.5 rounded-[1.25rem] border border-border px-3 text-sm text-foreground active:bg-state-hover"
                : "inline-flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border/70 bg-sidebar-accent/40 px-2 text-xs text-foreground hover:bg-state-hover"
            }
          >
            {current === undefined ? null : (
              <StatusDot status={current.status} className="size-2 shrink-0" />
            )}
            <span className="min-w-0 truncate">
              {currentTitle ??
                current?.thread.displayTitle ??
                `Conversations (${tabs.length})`}
            </span>
            {!useTouchSizing && tabs.length > 1 ? (
              <span className="ml-auto shrink-0 text-2xs tabular-nums text-muted-foreground">
                {tabs.length}
              </span>
            ) : null}
            <Icon
              name="ChevronDown"
              className={cn(
                "shrink-0 text-muted-foreground",
                useTouchSizing ? "ml-auto size-4" : "size-3.5",
                !useTouchSizing && tabs.length <= 1 && "ml-auto",
              )}
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
      {hasSearch ? (
        <div className="px-2 pb-1">
          <input
            ref={searchInputRef}
            value={query}
            aria-label="Search conversations"
            placeholder={`Search ${tabs.length} conversations`}
            className="h-6 w-full rounded-sm border border-border bg-transparent px-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
            onFocus={() => {
              focusedRegionRef.current = "search";
              setKeyboardRowNav(false);
            }}
            onChange={(event) => {
              lastTypingAtRef.current = Date.now();
              keyboardNavRef.current = true;
              setQuery(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setOpen(false);
                return;
              }
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                const items = menuItemsOf(listRef.current);
                if (items.length === 0) return;
                event.preventDefault();
                event.stopPropagation();
                focusMenuItem(
                  event.key === "ArrowDown" ? items[0] : items.at(-1),
                );
                return;
              }
              keyboardNavRef.current = true;
              lastTypingAtRef.current = Date.now();
              event.stopPropagation();
            }}
          />
        </div>
      ) : null}
      <MenuLabel>
        {query.trim().length === 0
          ? "Conversations"
          : `Matches (${visible.length} of ${tabs.length})`}
      </MenuLabel>
      <div
        ref={listRef}
        className="max-h-72 overflow-x-hidden overflow-y-auto"
        onFocusCapture={(event) => {
          const target = event.target;
          if (!(target instanceof HTMLElement)) return;
          if (target.getAttribute("role") === "menuitem") {
            focusedRegionRef.current = "item";
            lastKeyboardItemRef.current = target;
            return;
          }
          if (target.closest('[role="menuitem"]') !== null) {
            focusedRegionRef.current = "action";
          }
        }}
        onPointerMoveCapture={(event) => {
          const moved = hasPointerMoved(
            lastPointerRef.current,
            event.clientX,
            event.clientY,
          );
          lastPointerRef.current = { x: event.clientX, y: event.clientY };
          const searchFocused =
            searchInputRef.current !== null &&
            document.activeElement === searchInputRef.current;
          const withinTypingBurst =
            Date.now() - lastTypingAtRef.current < TYPING_HOVER_GUARD_MS;
          if (
            searchFocused ||
            withinTypingBurst ||
            (keyboardNavRef.current && !moved)
          ) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          keyboardNavRef.current = false;
          setKeyboardRowNav(false);
          lastKeyboardItemRef.current = null;
        }}
      >
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
              hasSearch && !keyboardRowNav && "hover:bg-accent/50",
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
        <div className="mt-1 border-t border-border px-1 pt-1">
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
