import {
  type ExperimentalThreadHeaderRowProps,
  experimental_useAppPanel as useAppPanel,
  useBbNavigate,
  experimental_usePanelTabs as usePanelTabs,
  useRpc,
  experimental_useSidebarThreads as useSidebarThreads,
} from "@get-bb/plugin-sdk/app";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { NEW_CHAT_PANEL_PATH } from "@/app/new-chat/route";
import {
  FEATURE_HUB_TAB_REF,
  hubDirectoryForWorkspace,
} from "@/components/feature-hub/hub-tab-ref";
import { useParkConversation } from "@/components/header/use-park-conversation";
import { useThreadShelves } from "@/hooks/use-lifecycle";
import type { harborRpcContract } from "@/server/contract";
import { WorkspaceMenu } from "@/components/header/WorkspaceMenu";
import { WorkspaceTabStrip } from "@/components/header/WorkspaceTabStrip";
import { RemoveWorktreeDialog } from "@/components/inbox/remove-worktree-dialog";
import { Icon } from "@/components/ui/icon";
import { useMinuteClock } from "@/hooks/use-minute-clock";
import { useSidebarMode } from "@/hooks/use-sidebar-mode";
import { useThreadActions } from "@/hooks/use-thread-actions";
import { useWorkspaceIndex } from "@/hooks/use-workspace-index";
import { formatLineCount } from "@/lib/domain/workspace";
import {
  deferSettleUntilOpen,
  findDiffTabKey,
  tabAfterBulkClose,
  tabAfterClose,
  takePendingSettle,
  workspaceTabs,
} from "@/lib/domain/workspace-tabs";
import { recordLastActive } from "@/lib/ui/last-active";
import { useWorkspaceChanges } from "@/lib/ui/workspace-change-counts";

/**
 * The conversations in this workspace, above the timeline.
 *
 * One tab per visible top-level conversation — pinned ones first, then the
 * rest oldest first — plus the thread the pane is showing when it is a
 * subagent or a side chat. A tab carries the agent that runs it, the family's
 * state and its child count, and pins and unpins without leaving the strip. Closing a tab settles its conversation:
 * it lands on Harbor's Settled shelf, not in bb's archive, and closing the active
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
  const rpc = useRpc<typeof harborRpcContract>();
  const [removing, setRemoving] = useState(false);
  const { threads } = useSidebarThreads();
  const shelves = useThreadShelves();
  const actions = useThreadActions();
  const { settle, snoozeUntilTomorrow } = useParkConversation();
  const navigate = useBbNavigate();
  const panel = useAppPanel();
  const panelTabs = usePanelTabs();
  const now = useMinuteClock();
  const thread = threads.find((entry) => entry.id === threadId);
  // The host may omit the environment prop; the thread row still carries it.
  const environmentId = environment?.id ?? thread?.environment?.id ?? null;
  const key =
    environmentId === null ? undefined : index.byEnvironmentId.get(environmentId);
  const workspace = key === undefined ? undefined : index.byKey?.get(key);
  const workspaceKey = workspace?.key ?? null;
  const changes = useWorkspaceChanges(
    workspace?.canonicalEnvironmentId ?? environmentId,
  );

  useEffect(() => {
    if (workspaceKey !== null) recordLastActive(workspaceKey, threadId);
  }, [threadId, workspaceKey]);

  const rawTabs = useMemo(
    () =>
      workspaceKey === null
        ? []
        : workspaceTabs(threads, workspaceKey, threadId, index, now),
    [index, now, threadId, threads, workspaceKey],
  );
  const tabs = useMemo(
    () =>
      rawTabs.filter(
        (tab) => tab.thread.id === threadId || shelves.shelfFor(tab.thread) === "active",
      ),
    [rawTabs, shelves, threadId],
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
  const hubDirectory = hubDirectoryForWorkspace({
    featureId: workspace.featureId,
    featureName:
      workspace.featureId === null
        ? null
        : (index.featureNames?.get(workspace.featureId) ?? null),
    parentKey: workspace.parentKey,
    kind: workspace.kind,
    label: workspace.label,
    path: workspace.path,
  });
  /**
   * Settle a run of conversations at once.
   *
   * Only the open one needs the neighbour-first handoff the single close uses;
   * the rest can settle straight away, because no pane is pointing at them.
   */
  const closeTabs = (list: readonly (typeof tabs)[number][]) => {
    const allowed = list.filter((tab) => !tab.thread.isPinned && shelves.canPark(tab.thread));
    if (allowed.length === 0 || allowed.length >= tabs.length) return;
    const closingIds = new Set(allowed.map((tab) => tab.thread.id));
    const next = tabAfterBulkClose(chats, closingIds, threadId);
    if (next !== null) {
      deferSettleUntilOpen(threadId, next.id);
      navigate.toThread(next.id);
    }
    for (const tab of allowed) {
      if (next !== null && tab.thread.id === threadId) continue;
      settle(tab.thread.id);
    }
  };
  const togglePin = (tab: (typeof tabs)[number]) => {
    void actions.setPinned(tab.thread.id, !tab.thread.isPinned).catch(() =>
      toast.error("Could not change the pin."),
    );
  };
  const closeTab = (tab: (typeof tabs)[number]) => {
    if (tab.thread.isPinned || !shelves.canPark(tab.thread) || tabs.length <= 1) {
      return;
    }
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
        canParkTab={(tab) => shelves.canPark(tab.thread)}
        onNewChat={() =>
          navigate.toPluginPanel(NEW_CHAT_PANEL_PATH, {
            subPath: targetEnvironmentId ?? "",
          })
        }
        onCloseTab={closeTab}
        onOpenTab={(tab) => navigate.toThread(tab.thread.id)}
        onTogglePin={togglePin}
        onSnooze={(tab) => snoozeUntilTomorrow(tab.thread.id)}
        onCloseTabs={closeTabs}
        onBatchSettleIdle={(threadIds) => {
          void rpc
            .call("batchSettleIdleThreads", { threadIds: [...threadIds] })
            .then((result) => {
              if (result.settled.length > 0) {
                toast.success(`Settled ${result.settled.length} idle conversations.`);
              }
              if (result.failed.length > 0) {
                toast.error(`Could not settle ${result.failed.length} conversations.`);
              }
            })
            .catch(() => toast.error("Could not batch settle idle conversations."));
        }}
        trailing={
          <>
            {workspace.featureId !== null ? (
              <button
                type="button"
                title="Open Feature Hub"
                aria-label="Open Feature Hub"
                className="inline-flex h-7 shrink-0 items-center gap-1 self-center rounded-md px-2 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground [@media(pointer:coarse)]:size-10 [@media(pointer:coarse)]:justify-center [@media(pointer:coarse)]:px-0"
                onClick={() =>
                  panel.openTab({
                    tab: FEATURE_HUB_TAB_REF,
                    target: { section: "overview", directory: hubDirectory },
                  })
                }
              >
                <Icon name="Layers" className="size-3.5 [@media(pointer:coarse)]:size-5" />
                <span className="hidden lg:inline [@media(pointer:coarse)]:hidden">Hub</span>
              </button>
            ) : null}
            {diffTabKey === null ? null : (
              <button
                type="button"
                title="All changes"
                aria-label="All changes"
                className="inline-flex h-7 shrink-0 items-center gap-1.5 self-center rounded-md px-2 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground [@media(pointer:coarse)]:size-10 [@media(pointer:coarse)]:justify-center [@media(pointer:coarse)]:px-0"
                onClick={() => panel.selectTab(diffTabKey)}
              >
                <Icon name="GitBranch" className="size-3.5 [@media(pointer:coarse)]:size-5" />
                {/* A phone row spends its width on the conversation chip, so
                    the counts go and the icon keeps the meaning. */}
                <span className="[@media(pointer:coarse)]:hidden">
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
                </span>
              </button>
            )}
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
