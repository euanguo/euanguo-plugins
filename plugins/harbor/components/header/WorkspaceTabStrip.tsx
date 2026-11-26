import { experimental_useProviders as useProviders } from "@get-bb/plugin-sdk/app";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  WorkspaceCompactTabBar,
  WorkspaceTabSwitcher,
} from "@/components/header/workspace-compact-tab-chip";
import {
  ACTIVE_TAB_CLASS,
  CLOSE_CLASS,
  TAB_CLASS,
  WorkspaceTabItem,
} from "@/components/header/workspace-tab-item";
import type { ProviderGlyphInfo } from "@/components/inbox/provider-glyph";
import { useMediaQuery } from "@bb-ui/hooks/use-media-query";
import { Icon } from "@bb-ui/icon";
import { ScrollStrip } from "@/components/ui/scroll-strip";
import type { WorkspaceTab } from "@/lib/domain/workspace-tabs";
import { cn } from "@/lib/ui/utils";

/**
 * The conversations of one workspace, above the timeline.
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
  onBatchSettleIdle,
  canParkTab,
  trailing,
}: {
  tabs: readonly WorkspaceTab[];
  activeThreadId: string | null;
  untitled: boolean;
  newChatLabel?: string;
  onNewChat(): void;
  onOpenTab?(tab: WorkspaceTab): void;
  onCloseTab?(tab: WorkspaceTab): void;
  onCloseUntitled?(): void;
  onTogglePin?(tab: WorkspaceTab): void;
  onSnooze?(tab: WorkspaceTab): void;
  onCloseTabs?(tabs: readonly WorkspaceTab[]): void;
  onBatchSettleIdle?(threadIds: readonly string[]): void;
  canParkTab?(tab: WorkspaceTab): boolean;
  trailing?: ReactNode;
}) {
  const closable = tabs.length + (untitled ? 1 : 0) > 1;
  const compactViewport = useMediaQuery("(width <= 767px)");
  const [narrowPane, setNarrowPane] = useState(false);
  const compact = compactViewport || narrowPane;
  const stripRef = useRef<HTMLDivElement | null>(null);
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
  }, [activeThreadId, compact]);

  useEffect(() => {
    const element = stripRef.current;
    if (element === null || typeof ResizeObserver === "undefined") return;
    const update = (width: number) => {
      if (width <= 0) return;
      setNarrowPane((prev) => (prev ? width < 560 : width < 520));
    };
    update(element.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) update(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const pinnedTabs = tabs.filter((tab) => tab.thread.isPinned);
  const scrollingTabs = tabs.filter((tab) => !tab.thread.isPinned);
  const singleScrollingTab =
    !untitled && pinnedTabs.length === 0 && scrollingTabs.length === 1;

  const switcher =
    onOpenTab === undefined ? null : (
      <WorkspaceTabSwitcher
        tabs={tabs}
        activeThreadId={activeThreadId}
        untitled={untitled}
        compact={compact}
        closable={closable}
        canParkTab={canParkTab}
        onOpenTab={onOpenTab}
        onCloseTab={onCloseTab}
        onSnooze={onSnooze}
        onTogglePin={onTogglePin}
        onBatchSettleIdle={onBatchSettleIdle}
      />
    );

  if (compact) {
    return (
      <WorkspaceCompactTabBar
        stripRef={stripRef}
        newChatLabel={newChatLabel}
        switcher={switcher}
        trailing={trailing}
        onNewChat={onNewChat}
      />
    );
  }

  const renderTab = (tab: WorkspaceTab) => (
    <WorkspaceTabItem
      key={tab.thread.id}
      tab={tab}
      tabs={tabs}
      active={tab.thread.id === activeThreadId}
      activeRef={activeRef}
      closable={closable}
      singleScrollingTab={singleScrollingTab}
      providerInfoById={providerInfoById}
      canParkTab={canParkTab}
      onOpenTab={onOpenTab}
      onCloseTab={onCloseTab}
      onTogglePin={onTogglePin}
      onSnooze={onSnooze}
      onCloseTabs={onCloseTabs}
    />
  );

  return (
    <div
      ref={stripRef}
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
              <span aria-hidden="true" className="mx-0.5 h-4 w-px shrink-0 bg-sidebar-border" />
            )}
          </>
        )}
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
