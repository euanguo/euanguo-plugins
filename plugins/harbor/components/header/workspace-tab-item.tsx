import { ThreadTitle } from "@get-bb/plugin-sdk/app";
import type { Ref } from "react";

import {
  FamilyStatusIcon,
  familyStatusNeedsIcon,
  StatusDot,
} from "@/components/inbox/family-status";
import { ProviderGlyph, type ProviderGlyphInfo } from "@/components/inbox/provider-glyph";
import { RowMenu, type RowMenuItem } from "@/components/inbox/row-context-menu";
import { Icon } from "@bb-ui/icon";
import { threadLinkUrl } from "@/lib/domain/thread-link";
import { tabsToClose, type WorkspaceTab } from "@/lib/domain/workspace-tabs";
import { copyWithAnnouncement } from "@/lib/ui/clipboard";
import { cn } from "@/lib/ui/utils";

export const TAB_CLASS =
  "group/tab relative flex h-7 max-w-56 min-w-0 shrink-0 items-center gap-1 rounded-md px-2 text-xs [@media(pointer:coarse)]:h-9";
export const ACTIVE_TAB_CLASS = "text-foreground bg-sidebar-accent";
const IDLE_TAB_CLASS =
  "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50";
export const CLOSE_CLASS =
  "relative z-10 inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-subtle-foreground opacity-0 hover:bg-state-hover hover:text-foreground group-hover/tab:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:size-6 [@media(pointer:coarse)]:opacity-100";
const CHILD_BADGE_CLASS =
  "shrink-0 rounded-full bg-current/10 px-1 text-[10px] leading-4 tabular-nums text-muted-foreground";
const TRAILING_SLOT_CLASS = "relative flex size-4 shrink-0 items-center justify-center";
const TRAILING_STATUS_CLASS =
  "pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity duration-150 motion-reduce:transition-none";
const SLOT_CLASS = "relative flex size-4 shrink-0 items-center justify-center";
const SLOT_GLYPH_CLASS =
  "pointer-events-none absolute inset-0 flex items-center justify-center opacity-75 group-hover/tab:opacity-0 group-focus-within/tab:opacity-0";
const SLOT_ACTION_CLASS =
  "absolute inset-0 z-10 flex items-center justify-center rounded-sm text-subtle-foreground opacity-0 hover:bg-state-hover hover:text-foreground group-hover/tab:opacity-100 group-focus-within/tab:opacity-100 focus-visible:opacity-100";

function buildTabMenuItems({
  tab,
  tabs,
  closable,
  canParkTab,
  onTogglePin,
  onCloseTab,
  onSnooze,
  onCloseTabs,
}: {
  tab: WorkspaceTab;
  tabs: readonly WorkspaceTab[];
  closable: boolean;
  canParkTab?: (tab: WorkspaceTab) => boolean;
  onTogglePin?: (tab: WorkspaceTab) => void;
  onCloseTab?: (tab: WorkspaceTab) => void;
  onSnooze?: (tab: WorkspaceTab) => void;
  onCloseTabs?: (tabs: readonly WorkspaceTab[]) => void;
}): RowMenuItem[] {
  const parkable = canParkTab ? canParkTab(tab) : true;
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
      disabled: !closable || tab.thread.isPinned || !parkable,
      hint: tab.thread.isPinned
        ? "Pinned conversations stay open"
        : !parkable
          ? "Cannot settle while working or waiting"
          : !closable
            ? "Keep at least one conversation open"
            : undefined,
      onSelect: () => {
        if (closable && !tab.thread.isPinned && parkable) onCloseTab(tab);
      },
    });
  }
  if (onSnooze !== undefined) {
    items.push({
      key: "snooze",
      icon: "Clock",
      label: "Snooze until tomorrow",
      disabled: !parkable,
      hint: !parkable ? "Cannot snooze while working or waiting" : undefined,
      onSelect: () => {
        if (parkable) onSnooze(tab);
      },
    });
  }
  if (onCloseTabs !== undefined) {
    const byId = new Map(tabs.map((entry) => [entry.thread.id, entry]));
    const parkableSet = new Set(
      tabs.filter((entry) => !canParkTab || canParkTab(entry)).map((entry) => entry.thread.id),
    );
    const closing = (direction: "others" | "left" | "right"): WorkspaceTab[] =>
      tabsToClose(tabs.map((entry) => entry.thread), tab.thread.id, direction, parkableSet).flatMap(
        (thread) => byId.get(thread.id) ?? [],
      );
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
        hint: list.length === 0 ? "Nothing to close on this side" : undefined,
        onSelect: () => {
          if (list.length > 0) onCloseTabs(list);
        },
      });
    }
  }
  items.push({
    key: "copy-link",
    icon: "Link",
    label: "Copy link",
    separatorBefore: true,
    onSelect: () => {
      void copyWithAnnouncement(threadLinkUrl(tab.thread.projectId, tab.thread.id), "Link");
    },
  });
  return items;
}

export function WorkspaceTabItem({
  tab,
  tabs,
  active,
  activeRef,
  closable,
  singleScrollingTab,
  providerInfoById,
  canParkTab,
  onOpenTab,
  onCloseTab,
  onTogglePin,
  onSnooze,
  onCloseTabs,
}: {
  tab: WorkspaceTab;
  tabs: readonly WorkspaceTab[];
  active: boolean;
  activeRef?: Ref<HTMLDivElement>;
  closable: boolean;
  singleScrollingTab: boolean;
  providerInfoById: ReadonlyMap<string, ProviderGlyphInfo>;
  canParkTab?: (tab: WorkspaceTab) => boolean;
  onOpenTab?: (tab: WorkspaceTab) => void;
  onCloseTab?: (tab: WorkspaceTab) => void;
  onTogglePin?: (tab: WorkspaceTab) => void;
  onSnooze?: (tab: WorkspaceTab) => void;
  onCloseTabs?: (tabs: readonly WorkspaceTab[]) => void;
}) {
  const parkable = canParkTab ? canParkTab(tab) : true;
  const closeable = closable && onCloseTab !== undefined && !tab.thread.isPinned && parkable;

  return (
    <RowMenu
      label={`Actions for ${tab.thread.displayTitle}`}
      items={buildTabMenuItems({
        tab,
        tabs,
        closable,
        canParkTab,
        onTogglePin,
        onCloseTab,
        onSnooze,
        onCloseTabs,
      })}
    >
      <div
        ref={active ? activeRef : undefined}
        data-tab-pill=""
        className={cn(
          TAB_CLASS,
          !tab.thread.isPinned && (singleScrollingTab ? "shrink" : "shrink min-w-40"),
          active ? ACTIVE_TAB_CLASS : IDLE_TAB_CLASS,
        )}
      >
        <a
          role="tab"
          aria-selected={active}
          href={tab.thread.href}
          draggable={false}
          title={tab.thread.displayTitle}
          onClick={(event) => {
            if (
              onOpenTab === undefined ||
              event.defaultPrevented ||
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            ) {
              return;
            }
            event.preventDefault();
            onOpenTab(tab);
          }}
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
              <Icon name={tab.thread.isPinned ? "PinOff" : "Pin"} className="size-3" />
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
              <FamilyStatusIcon status={tab.status} variant="icon" className="size-4" />
            ) : (
              <StatusDot status={tab.status} className="size-1.5" />
            )}
          </span>
          {closeable ? (
            <button
              type="button"
              data-tab-pill-close=""
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
}
