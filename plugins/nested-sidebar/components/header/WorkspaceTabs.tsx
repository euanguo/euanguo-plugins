import { useEffect, useMemo, useState } from "react";
import {
  experimental_useAppPanel as useAppPanel,
  experimental_usePanelTabs as usePanelTabs,
  experimental_useSidebarThreads as useSidebarThreads,
  useBbNavigate,
  useSdk,
  type ExperimentalThreadHeaderRowProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";

import { runWorkspaceScript } from "@/app/scripts/run";
import { NEW_CHAT_PANEL_PATH } from "@/app/new-chat/route";
import { Icon } from "@/components/ui/icon";
import { RemoveWorktreeDialog } from "@/components/inbox/remove-worktree-dialog";
import { AllConversationsMenu } from "@/components/header/AllConversationsMenu";
import { WorkspaceMenu } from "@/components/header/WorkspaceMenu";
import { WorkspaceTabStrip } from "@/components/header/WorkspaceTabStrip";
import { useParkConversation } from "@/components/header/use-park-conversation";
import { useMinuteClock } from "@/hooks/use-minute-clock";
import { useThreadActions } from "@/hooks/use-thread-actions";
import { useSidebarMode } from "@/hooks/use-sidebar-mode";
import { useWorkspaceIndex } from "@/hooks/use-workspace-index";
import { recordLastActive } from "@/lib/last-active";
import { formatLineCount } from "@/lib/workspace";
import { useWorkspaceChanges } from "@/lib/workspace-changes";
import {
  deferSettleUntilOpen,
  findDiffTabKey,
  tabAfterClose,
  takePendingSettle,
  workspaceTabs,
} from "@/lib/workspace-tabs";

/**
 * The conversations in this workspace, above the timeline.
 *
 * One tab per visible top-level conversation — pinned ones first, then the
 * rest oldest first — plus the thread the pane is showing when it is a
 * subagent or a side chat. A tab carries the agent that runs it, the family's
 * state and its child count, and pins and unpins without leaving the strip. Closing a tab settles its conversation:
 * it lands on Nest's Settled shelf, not in bb's archive, and closing the active
 * tab moves to its neighbour first so the pane never points at a thread that
 * is gone.
 *
 * Only the Workspaces mode draws the strip; Threads mode leaves the header to
 * bb. The last-active record is written in both, because the workspace row's
 * click target is the same conversation in either.
 */
export function WorkspaceTabs({
  threadId,
  environment,
}: ExperimentalThreadHeaderRowProps) {
  const index = useWorkspaceIndex();
  const mode = useSidebarMode();
  const sdk = useSdk();
  const [running, setRunning] = useState(false);
  const [removing, setRemoving] = useState(false);
  const { threads } = useSidebarThreads();
  const actions = useThreadActions();
  const { settle, snoozeUntilTomorrow } = useParkConversation();
  const navigate = useBbNavigate();
  const panel = useAppPanel();
  const panelTabs = usePanelTabs();
  const now = useMinuteClock();
  const environmentId = environment?.id ?? null;
  const key =
    environmentId === null ? undefined : index.byEnvironmentId.get(environmentId);
  const workspace = key === undefined ? undefined : index.byKey.get(key);
  const workspaceKey = workspace?.key ?? null;
  const changes = useWorkspaceChanges(
    workspace?.canonicalEnvironmentId ?? environmentId,
  );

  useEffect(() => {
    if (workspaceKey !== null) recordLastActive(workspaceKey, threadId);
  }, [threadId, workspaceKey]);

  const tabs = useMemo(
    () =>
      workspaceKey === null
        ? []
        : workspaceTabs(threads, workspaceKey, threadId, index, now),
    [index, now, threadId, threads, workspaceKey],
  );

  // The neighbour is open now, so the conversation the close named can go.
  useEffect(() => {
    for (const tab of tabs) {
      if (takePendingSettle(tab.thread.id, threadId)) settle(tab.thread.id);
    }
  }, [settle, tabs, threadId]);

  if (mode === "threads" || workspace === undefined) return null;
  if (tabs.length === 0) return null;

  const chats = tabs.map((tab) => tab.thread);
  const diffTabKey = findDiffTabKey(panelTabs.tabs);
  const targetEnvironmentId =
    workspace.canonicalEnvironmentId ?? environmentId;
  const togglePin = (tab: (typeof tabs)[number]) => {
    void actions.setPinned(tab.thread.id, !tab.thread.isPinned).catch(() =>
      toast.error("Could not change the pin."),
    );
  };
  const closeTab = (tab: (typeof tabs)[number]) => {
    const next = tabAfterClose(chats, tab.thread.id);
    if (tab.thread.id === threadId && next !== null) {
      deferSettleUntilOpen(tab.thread.id, next.id);
      navigate.toThread(next.id);
      return;
    }
    settle(tab.thread.id);
  };

  return (
    <>
      <WorkspaceTabStrip
        tabs={tabs}
        activeThreadId={threadId}
        untitled={false}
        onNewChat={() =>
          navigate.toPluginPanel(NEW_CHAT_PANEL_PATH, {
            subPath: targetEnvironmentId ?? "",
          })
        }
        onCloseTab={closeTab}
        onTogglePin={togglePin}
        onSnooze={(tab) => snoozeUntilTomorrow(tab.thread.id)}
        trailing={
          <>
            <AllConversationsMenu
              tabs={tabs}
              currentThreadId={threadId}
              onOpen={(id) => navigate.toThread(id)}
              onSettle={settle}
              onSnooze={snoozeUntilTomorrow}
              onTogglePin={togglePin}
            />
            {diffTabKey === null ? null : (
              <button
                type="button"
                title="All changes"
                className="inline-flex h-7 shrink-0 items-center gap-1.5 self-center rounded-md px-2 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground"
                onClick={() => panel.selectTab(diffTabKey)}
              >
                <Icon name="GitBranch" className="size-3.5" />
                {changes === null ||
                (changes.insertions === 0 && changes.deletions === 0) ? (
                  "Changes"
                ) : (
                  <span className="tabular-nums">
                    <span className="text-success-foreground">
                      +{formatLineCount(changes.insertions)}
                    </span>{" "}
                    <span className="text-destructive">
                      -{formatLineCount(changes.deletions)}
                    </span>
                  </span>
                )}
              </button>
            )}
            <button
              type="button"
              title={running ? "Starting…" : "Run"}
              aria-label={
                running ? "Starting the workspace script" : "Run the workspace script"
              }
              disabled={running}
              className="inline-flex h-7 shrink-0 items-center gap-1.5 self-center rounded-md px-2 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground disabled:opacity-50"
              onClick={() => {
                if (running) return;
                setRunning(true);
                void runWorkspaceScript(
                  sdk,
                  navigate,
                  threadId,
                  chats.map((chat) => chat.id),
                )
                  .catch((error: unknown) =>
                    toast.error(
                      error instanceof Error
                        ? `Could not run the workspace script: ${error.message}`
                        : "Could not run the workspace script.",
                    ),
                  )
                  .finally(() => setRunning(false));
              }}
            >
              <Icon name="Play" className="size-3.5" />
              Run
            </button>
            <WorkspaceMenu
              workspace={workspace}
              environmentId={environmentId}
              onRemoveWorktree={() => setRemoving(true)}
            />
          </>
        }
      />
      <RemoveWorktreeDialog
        open={removing}
        environmentId={targetEnvironmentId}
        label={workspace.label}
        onClose={() => setRemoving(false)}
      />
    </>
  );
}
