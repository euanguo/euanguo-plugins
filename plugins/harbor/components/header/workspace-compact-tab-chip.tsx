import type { ReactNode } from "react";

import { AllConversationsMenu } from "@/components/header/AllConversationsMenu";
import { Icon } from "@bb-ui/icon";
import type { WorkspaceTab } from "@/lib/domain/workspace-tabs";

export function WorkspaceTabSwitcher({
  tabs,
  activeThreadId,
  untitled,
  compact,
  touchSized,
  closable,
  canParkTab,
  onOpenTab,
  onCloseTab,
  onSnooze,
  onTogglePin,
  onBatchSettleIdle,
}: {
  tabs: readonly WorkspaceTab[];
  activeThreadId: string | null;
  untitled: boolean;
  compact: boolean;
  touchSized?: boolean;
  closable: boolean;
  canParkTab?: (tab: WorkspaceTab) => boolean;
  onOpenTab: (tab: WorkspaceTab) => void;
  onCloseTab?: (tab: WorkspaceTab) => void;
  onSnooze?: (tab: WorkspaceTab) => void;
  onTogglePin?: (tab: WorkspaceTab) => void;
  onBatchSettleIdle?: (threadIds: readonly string[]) => void;
}) {
  return (
    <AllConversationsMenu
      tabs={tabs}
      currentThreadId={activeThreadId}
      currentTitle={untitled ? "Untitled" : undefined}
      compact={compact}
      touchSized={touchSized}
      canSettleTab={(tab) => closable && !tab.thread.isPinned && (!canParkTab || canParkTab(tab))}
      canSnoozeTab={(tab) => !canParkTab || canParkTab(tab)}
      onOpen={(threadId) => {
        const tab = tabs.find((entry) => entry.thread.id === threadId);
        if (tab !== undefined) onOpenTab(tab);
      }}
      onSettle={
        onCloseTab === undefined
          ? undefined
          : (threadId) => {
              const tab = tabs.find((entry) => entry.thread.id === threadId);
              if (tab !== undefined && closable && !tab.thread.isPinned && (!canParkTab || canParkTab(tab))) {
                onCloseTab(tab);
              }
            }
      }
      onSnooze={
        onSnooze === undefined
          ? undefined
          : (threadId) => {
              const tab = tabs.find((entry) => entry.thread.id === threadId);
              if (tab !== undefined && (!canParkTab || canParkTab(tab))) {
                onSnooze(tab);
              }
            }
      }
      onTogglePin={onTogglePin}
      onBatchSettleIdle={onBatchSettleIdle}
    />
  );
}

export function WorkspaceCompactTabBar({
  newChatLabel,
  switcher,
  trailing,
  touchSized = false,
  onNewChat,
}: {
  newChatLabel: string;
  switcher: ReactNode;
  trailing?: ReactNode;
  touchSized?: boolean;
  onNewChat: () => void;
}) {
  return (
    <>
      <button
        type="button"
        aria-label={newChatLabel}
        title={newChatLabel}
        className={
          touchSized
            ? "inline-flex size-10 shrink-0 items-center justify-center rounded-md text-subtle-foreground active:bg-state-hover"
            : "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-subtle-foreground hover:bg-state-hover hover:text-foreground"
        }
        onClick={onNewChat}
      >
        <Icon name="Plus" className={touchSized ? "size-5" : "size-3.5"} />
      </button>
      {switcher}
      {trailing === undefined ? null : (
        <div className="flex shrink-0 items-center gap-0.5">{trailing}</div>
      )}
    </>
  );
}
