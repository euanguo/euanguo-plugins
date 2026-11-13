import { useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  ThreadTitle,
  experimental_useProviders as useProviders,
} from "@get-bb/plugin-sdk/app";

import { Icon } from "@/components/ui/icon";
import { ScrollStrip } from "@/components/ui/scroll-strip";
import {
  FamilyStatusIcon,
  familyStatusNeedsIcon,
  StatusDot,
} from "@/components/inbox/family-status";
import {
  ProviderGlyph,
  type ProviderGlyphInfo,
} from "@/components/inbox/provider-glyph";
import { cn } from "@/lib/utils";
import type { WorkspaceTab } from "@/lib/workspace-tabs";

const TAB_CLASS =
  "group/tab relative flex h-7 max-w-56 min-w-0 shrink-0 items-center gap-1 rounded-md px-2 text-xs";
const ACTIVE_TAB_CLASS = "text-foreground bg-sidebar-accent";
const IDLE_TAB_CLASS =
  "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50";
const CLOSE_CLASS =
  "relative z-10 inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-subtle-foreground opacity-0 hover:bg-state-hover hover:text-foreground group-hover/tab:opacity-100 focus-visible:opacity-100";
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
 * it. Pinned
 * conversations lead the strip, and the pin that put one there is toggled from
 * the agent's own slot on hover — the close on the right is the only other
 * control. The strip scrolls sideways, and a vertical wheel drives it, so a
 * workspace with forty conversations is reachable with an ordinary mouse.
 */
export function WorkspaceTabStrip({
  tabs,
  activeThreadId,
  untitled,
  newChatLabel = "New conversation in this workspace",
  onNewChat,
  onCloseTab,
  onCloseUntitled,
  onTogglePin,
  trailing,
}: {
  tabs: readonly WorkspaceTab[];
  /** The conversation the pane is showing; null on the Untitled page. */
  activeThreadId: string | null;
  /** Draw an active Untitled tab, for the new-conversation page. */
  untitled: boolean;
  newChatLabel?: string;
  onNewChat(): void;
  onCloseTab?(tab: WorkspaceTab): void;
  onCloseUntitled?(): void;
  onTogglePin?(tab: WorkspaceTab): void;
  trailing?: ReactNode;
}) {
  const closable = tabs.length + (untitled ? 1 : 0) > 1;
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

  return (
    <div
      data-nest-workspace-tabs=""
      className="flex h-9 shrink-0 items-center gap-1 border-b border-border-hairline px-2"
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
      <ScrollStrip
        role="tablist"
        aria-label="Conversations in this workspace"
        className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
      >
        {tabs.map((tab) => {
          const active = tab.thread.id === activeThreadId;
          return (
            <div
              key={tab.thread.id}
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
              />
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
                    closable && onCloseTab !== undefined
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
                {closable && onCloseTab !== undefined ? (
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
          );
        })}
        {untitled ? (
          <div className={cn(TAB_CLASS, ACTIVE_TAB_CLASS)}>
            <span role="tab" aria-selected={true} className="min-w-0 truncate">
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
      </ScrollStrip>
      {trailing === undefined ? null : (
        <div className="flex shrink-0 items-center gap-0.5">{trailing}</div>
      )}
    </div>
  );
}
