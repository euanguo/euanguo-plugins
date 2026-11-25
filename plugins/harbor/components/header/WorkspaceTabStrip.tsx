import {
  ThreadTitle,
  experimental_useProviders as useProviders,
} from "@get-bb/plugin-sdk/app";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { AllConversationsMenu } from "@/components/header/AllConversationsMenu";
import {
  FamilyStatusIcon,
  familyStatusNeedsIcon,
  StatusDot,
} from "@/components/inbox/family-status";
import {
  ProviderGlyph,
  type ProviderGlyphInfo,
} from "@/components/inbox/provider-glyph";
import { RowMenu, type RowMenuItem } from "@/components/inbox/row-context-menu";
import { useMediaQuery } from "@/components/ui/hooks/use-media-query";
import { Icon } from "@/components/ui/icon";
import { ScrollStrip } from "@/components/ui/scroll-strip";
import { threadLinkUrl } from "@/lib/domain/thread-link";
import { tabsToClose, type WorkspaceTab } from "@/lib/domain/workspace-tabs";
import { copyWithAnnouncement } from "@/lib/ui/clipboard";
import { cn } from "@/lib/ui/utils";

const TAB_CLASS =
  "group/tab relative flex h-7 max-w-56 min-w-0 shrink-0 items-center gap-1 rounded-md px-2 text-xs [@media(pointer:coarse)]:h-9";
const ACTIVE_TAB_CLASS = "text-foreground bg-sidebar-accent";
const IDLE_TAB_CLASS =
  "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50";
const CLOSE_CLASS =
  "relative z-10 inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-subtle-foreground opacity-0 hover:bg-state-hover hover:text-foreground group-hover/tab:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:size-6 [@media(pointer:coarse)]:opacity-100";
const CHILD_BADGE_CLASS =
  "shrink-0 rounded-full bg-current/10 px-1 text-[10px] leading-4 tabular-nums text-muted-foreground";
/**
 * The slot at the tab's trailing edge.
 *
 * One slot, two uses, like the leading one: the family's state sits there at
 * rest, and the close takes the same box once the pointer is on the tab. The
 * status is not squeezed between the agent and the name; it reads as the
 * tab's last word, which is what it is.
 */
const TRAILING_SLOT_CLASS =
  "relative flex size-4 shrink-0 items-center justify-center";
const TRAILING_STATUS_CLASS =
  "pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity duration-150 motion-reduce:transition-none";
/**
 * The slot at the tab's leading edge, where the agent's glyph sits.
 *
 * One slot, two uses: the glyph says who runs the conversation, and once the
 * pointer is on the tab the pin takes the same box. Nothing moves sideways as
 * the pointer crosses the strip, and a tab needs no second control.
 */
const SLOT_CLASS = "relative flex size-4 shrink-0 items-center justify-center";
const SLOT_GLYPH_CLASS =
  "pointer-events-none absolute inset-0 flex items-center justify-center opacity-75 group-hover/tab:opacity-0 group-focus-within/tab:opacity-0";
const SLOT_ACTION_CLASS =
  "absolute inset-0 z-10 flex items-center justify-center rounded-sm text-subtle-foreground opacity-0 hover:bg-state-hover hover:text-foreground group-hover/tab:opacity-100 group-focus-within/tab:opacity-100 focus-visible:opacity-100";

/**
 * The conversations of one workspace, above the timeline.
 *
 * Every workspace surface draws this same strip: the thread pane and the new
 * conversation page. The layout is one tab per visible conversation — pinned
 * ones first, then the rest most recently used first — and the active one is
 * scrolled into view whenever the pane changes.
 *
 * The strip leads with the new conversation, outside the scrolling list so it
 * is always the first thing at hand. A tab says three things besides its name:
 * which agent runs it, the state of its whole family — quiet ones in a muted
 * dot, so a tab never looks stateless — and how many conversations hide behind
 * it. Pinned conversations are fixed at the strip's left, outside the
 * scrolling list, and the pin that put one there is toggled from the agent's
 * own slot on hover — the close on the right is the only other control. The strip scrolls sideways, and a vertical wheel drives it, so a
 * workspace with forty conversations is reachable with an ordinary mouse.
 */
export function WorkspaceTabStrip({
  tabs,
  activeThreadId,
  untitled,
  newChatLabel = "New conversation in this workspace",
  onNewChat,
  onOpenTab,
  onCloseTab,
  onCloseUntitled,
  onTogglePin,
  onSnooze,
  onCloseTabs,
  trailing,
}: {
  tabs: readonly WorkspaceTab[];
  /** The conversation the pane is showing; null on the Untitled page. */
  activeThreadId: string | null;
  /** Draw an active Untitled tab, for the new-conversation page. */
  untitled: boolean;
  newChatLabel?: string;
  onNewChat(): void;
  /** Opens a conversation from the strip's own list, not from a tab. */
  onOpenTab?(tab: WorkspaceTab): void;
  onCloseTab?(tab: WorkspaceTab): void;
  onCloseUntitled?(): void;
  onTogglePin?(tab: WorkspaceTab): void;
  onSnooze?(tab: WorkspaceTab): void;
  onCloseTabs?(tabs: readonly WorkspaceTab[]): void;
  trailing?: ReactNode;
}) {
  const closable = tabs.length + (untitled ? 1 : 0) > 1;
  /**
   * A phone row cannot hold a tab per conversation.
   *
   * At 390px the leading plus, the trailing controls and the padding left 79px
   * for a 446px strip, so the bar showed one truncated title and a sideways
   * hunt for the next. Below bb's compact breakpoint the strip becomes one chip
   * that names the conversation the pane shows and opens the list instead.
   */
  const compact = useMediaQuery("(width <= 767px)");
  const activeRef = useRef<HTMLDivElement | null>(null);
  const { providers } = useProviders();
  const providerInfoById = useMemo<ReadonlyMap<string, ProviderGlyphInfo>>(
    () =>
      new Map(
        providers.map((provider) => [
          provider.id,
          { displayName: provider.displayName, logoUrl: provider.logoUrl },
        ]),
      ),
    [providers],
  );

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeThreadId]);

  /**
   * A pinned tab is fixed, not merely first.
   *
   * The rest of the strip scrolls — a workspace can hold forty conversations —
   * and a pin that scrolls away is not a pin. So the pinned tabs sit outside
   * the scrolling list, where the plus and the trailing controls already are,
   * and the list keeps the space that is left.
   */
  const pinnedTabs = tabs.filter((tab) => tab.thread.isPinned);
  const scrollingTabs = tabs.filter((tab) => !tab.thread.isPinned);

  /**
   * The actions a tab offers on right-click.
   *
   * The same verbs as a thread row, cut down to what a strip can do without a
   * second surface: pin, settle, snooze, copy the link. Pinning and settling
   * stay deliberate menu items even for a pinned tab, where the hover close is
   * gone — a stray button must not undo a pin, but the menu can.
   */
  const menuItems = (tab: WorkspaceTab): RowMenuItem[] => {
    const items: RowMenuItem[] = [];
    if (onTogglePin !== undefined) {
      items.push({
        key: "pin",
        icon: tab.thread.isPinned ? "PinOff" : "Pin",
        label: tab.thread.isPinned ? "Unpin" : "Pin",
        onSelect: () => onTogglePin(tab),
      });
    }
    if (onCloseTab !== undefined) {
      items.push({
        key: "settle",
        icon: "Archive",
        label: "Settle conversation",
        separatorBefore: true,
        onSelect: () => onCloseTab(tab),
      });
    }
    if (onSnooze !== undefined) {
      items.push({
        key: "snooze",
        icon: "Clock",
        label: "Snooze until tomorrow",
        onSelect: () => onSnooze(tab),
      });
    }
    // Bulk closes skip the pinned tabs, so the anchor's own side may be empty.
    if (onCloseTabs !== undefined) {
      const byId = new Map(tabs.map((entry) => [entry.thread.id, entry]));
      const closing = (
        direction: "others" | "left" | "right",
      ): WorkspaceTab[] =>
        tabsToClose(
          tabs.map((entry) => entry.thread),
          tab.thread.id,
          direction,
        ).flatMap((thread) => byId.get(thread.id) ?? []);
      for (const [key, label, icon, direction] of [
        ["close-others", "Close others", "XCircle", "others"],
        ["close-left", "Close tabs to the left", "ArrowLeft", "left"],
        ["close-right", "Close tabs to the right", "ArrowRight", "right"],
      ] as const) {
        const list = closing(direction);
        items.push({
          key,
          icon,
          label,
          separatorBefore: key === "close-others",
          disabled: list.length === 0,
          hint:
            list.length === 0
              ? "Nothing to close on this side"
              : undefined,
          onSelect: () => onCloseTabs(list),
        });
      }
    }
    items.push({
      key: "copy-link",
      icon: "Link",
      label: "Copy link",
      separatorBefore: true,
      onSelect: () => {
        void copyWithAnnouncement(
          threadLinkUrl(tab.thread.projectId, tab.thread.id),
          "Link",
        );
      },
    });
    return items;
  };

  const renderTab = (tab: WorkspaceTab) => {
    const active = tab.thread.id === activeThreadId;
    /**
     * A pinned tab has no close. The pin is the promise that the tab stays put,
     * and a button that settles it on hover is the wrong offer at the wrong
     * moment; unpinning brings the close back.
     */
    const closeable =
      closable && onCloseTab !== undefined && !tab.thread.isPinned;
    return (
      <RowMenu
        key={tab.thread.id}
        label={`Actions for ${tab.thread.displayTitle}`}
        items={menuItems(tab)}
      >
        <div
          ref={active ? activeRef : undefined}
          className={cn(TAB_CLASS, active ? ACTIVE_TAB_CLASS : IDLE_TAB_CLASS)}
        >
          <a
            role="tab"
            aria-selected={active}
            href={tab.thread.href}
            draggable={false}
            title={tab.thread.displayTitle}
            className="absolute inset-0 rounded-md outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <span className="sr-only">{tab.thread.displayTitle}</span>
          </a>
          <span className={SLOT_CLASS}>
            <span className={SLOT_GLYPH_CLASS}>
              <ProviderGlyph
                providerId={tab.thread.providerId}
                provider={providerInfoById.get(tab.thread.providerId)}
                className="size-3"
                interactive={false}
              />
            </span>
            {onTogglePin === undefined ? null : (
              <button
                type="button"
                aria-label={`${tab.thread.isPinned ? "Unpin" : "Pin"} ${tab.thread.displayTitle}`}
                title={tab.thread.isPinned ? "Unpin" : "Pin"}
                className={SLOT_ACTION_CLASS}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onTogglePin(tab);
                }}
              >
                <Icon
                  name={tab.thread.isPinned ? "PinOff" : "Pin"}
                  className="size-3"
                />
              </button>
            )}
          </span>
          <span className="pointer-events-none min-w-0 truncate">
            <ThreadTitle threadId={tab.thread.id} />
          </span>
          {tab.childCount === 0 ? null : (
            <span
              className={CHILD_BADGE_CLASS}
              title={`${tab.childCount} ${tab.childCount === 1 ? "child thread" : "child threads"}`}
            >
              {tab.childCount}
            </span>
          )}
          <span className={TRAILING_SLOT_CLASS}>
            <span
              className={
                closeable
                  ? `${TRAILING_STATUS_CLASS} group-hover/tab:opacity-0 group-focus-within/tab:opacity-0`
                  : TRAILING_STATUS_CLASS
              }
            >
              {familyStatusNeedsIcon(tab.status) ? (
                <FamilyStatusIcon
                  status={tab.status}
                  variant="icon"
                  className="size-4"
                />
              ) : (
                <StatusDot status={tab.status} className="size-1.5" />
              )}
            </span>
            {closeable && onCloseTab !== undefined ? (
              <button
                type="button"
                aria-label={`Close ${tab.thread.displayTitle}`}
                className={CLOSE_CLASS}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onCloseTab(tab);
                }}
              >
                <Icon name="X" className="size-3" />
              </button>
            ) : null}
          </span>
        </div>
      </RowMenu>
    );
  };

  const switcher =
    onOpenTab === undefined ? null : (
      <AllConversationsMenu
        tabs={tabs}
        currentThreadId={activeThreadId}
        currentTitle={untitled ? "Untitled" : undefined}
        compact={compact}
        onOpen={(threadId) => {
          const tab = tabs.find((entry) => entry.thread.id === threadId);
          if (tab !== undefined) onOpenTab(tab);
        }}
        onSettle={
          onCloseTab === undefined
            ? undefined
            : (threadId) => {
                const tab = tabs.find((entry) => entry.thread.id === threadId);
                if (tab !== undefined) onCloseTab(tab);
              }
        }
        onSnooze={
          onSnooze === undefined
            ? undefined
            : (threadId) => {
                const tab = tabs.find((entry) => entry.thread.id === threadId);
                if (tab !== undefined) onSnooze(tab);
              }
        }
        onTogglePin={onTogglePin}
      />
    );

  if (compact) {
    return (
      <div
        data-harbor-workspace-tabs=""
        className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border-hairline px-2"
      >
        <button
          type="button"
          aria-label={newChatLabel}
          title={newChatLabel}
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-md text-subtle-foreground active:bg-state-hover"
          onClick={onNewChat}
        >
          <Icon name="Plus" className="size-5" />
        </button>
        {switcher}
        {trailing === undefined ? null : (
          <div className="flex shrink-0 items-center gap-0.5">{trailing}</div>
        )}
      </div>
    );
  }

  return (
    <div
      data-harbor-workspace-tabs=""
      className="flex h-9 shrink-0 items-center gap-1 border-b border-border-hairline px-2 [@media(pointer:coarse)]:h-10"
    >
      <button
        type="button"
        aria-label={newChatLabel}
        title={newChatLabel}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-subtle-foreground hover:bg-state-hover hover:text-foreground"
        onClick={onNewChat}
      >
        <Icon name="Plus" className="size-3.5" />
      </button>
      <div
        role="tablist"
        aria-label="Conversations in this workspace"
        className="flex min-w-0 flex-1 items-center gap-0.5"
      >
        {pinnedTabs.length === 0 ? null : (
          <>
            <div className="flex shrink-0 items-center gap-0.5">
              {pinnedTabs.map(renderTab)}
            </div>
            {scrollingTabs.length === 0 ? null : (
              <span
                aria-hidden="true"
                className="mx-0.5 h-4 w-px shrink-0 bg-sidebar-border"
              />
            )}
          </>
        )}
        {/*
         * The new conversation leads the strip: it is the tab the user just
         * asked for, and the one they are about to type into. Behind the
         * existing conversations, and behind the pinned ones, it read as the
         * end of a queue.
         */}
        {untitled ? (
          <div className={cn(TAB_CLASS, ACTIVE_TAB_CLASS, "shrink-0")}>
            <span
              role="tab"
              tabIndex={0}
              aria-selected={true}
              className="min-w-0 truncate outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              Untitled
            </span>
            {closable && onCloseUntitled !== undefined ? (
              <button
                type="button"
                aria-label="Close Untitled"
                className={CLOSE_CLASS}
                onClick={onCloseUntitled}
              >
                <Icon name="X" className="size-3" />
              </button>
            ) : null}
          </div>
        ) : null}
        <ScrollStrip className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {scrollingTabs.map(renderTab)}
        </ScrollStrip>
      </div>
      {trailing === undefined && switcher === null ? null : (
        <div className="flex shrink-0 items-center gap-0.5">
          {switcher}
          {trailing}
        </div>
      )}
    </div>
  );
}
