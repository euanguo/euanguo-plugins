import { useEffect, useRef, type ReactNode } from "react";
import { ThreadTitle } from "@get-bb/plugin-sdk/app";

import { Icon } from "@/components/ui/icon";
import { StatusDot } from "@/components/inbox/family-status";
import { cn } from "@/lib/utils";
import { showsTabStatus, type WorkspaceTab } from "@/lib/workspace-tabs";

const TAB_CLASS =
  "group/tab relative flex h-7 max-w-56 min-w-0 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs";
const ACTIVE_TAB_CLASS = "text-foreground bg-sidebar-accent";
const IDLE_TAB_CLASS =
  "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50";
const CLOSE_CLASS =
  "relative z-10 inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-subtle-foreground opacity-0 hover:bg-state-hover hover:text-foreground group-hover/tab:opacity-100 focus-visible:opacity-100";
const CHILD_BADGE_CLASS =
  "shrink-0 rounded-full bg-current/10 px-1 text-[10px] leading-4 tabular-nums text-muted-foreground";

/**
 * The conversations of one workspace, above the timeline.
 *
 * Every workspace surface draws this same strip: the thread pane and the new
 * conversation page. The layout is one tab per visible conversation, oldest
 * first, and the active one is scrolled into view whenever the pane changes.
 * A child count says how many conversations hide behind a tab, and the state
 * dot says the worst state of the whole family.
 */
export function WorkspaceTabStrip({
  tabs,
  activeThreadId,
  untitled,
  newChatLabel = "New conversation in this workspace",
  onNewChat,
  onCloseTab,
  onCloseUntitled,
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
  trailing?: ReactNode;
}) {
  const closable = tabs.length + (untitled ? 1 : 0) > 1;
  const activeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeThreadId]);

  return (
    <div
      data-nest-workspace-tabs=""
      className="flex h-9 shrink-0 items-stretch gap-1 border-b border-border-hairline px-2"
    >
      <div
        role="tablist"
        aria-label="Conversations in this workspace"
        className="flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto [scrollbar-width:none]"
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
                className="absolute inset-0 rounded-md outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              {showsTabStatus(tab.status.kind) ? (
                <StatusDot status={tab.status} className="size-1.5" />
              ) : null}
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
        <button
          type="button"
          aria-label={newChatLabel}
          title={newChatLabel}
          className="my-1 inline-flex w-7 shrink-0 items-center justify-center rounded-md text-subtle-foreground hover:bg-state-hover hover:text-foreground"
          onClick={onNewChat}
        >
          <Icon name="Plus" className="size-3.5" />
        </button>
      </div>
      {trailing === undefined ? null : (
        <div className="flex shrink-0 items-center gap-0.5">{trailing}</div>
      )}
    </div>
  );
}
