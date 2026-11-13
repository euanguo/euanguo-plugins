import { useEffect, useState } from "react";
import {
  ThreadTitle,
  experimental_useAppPanel as useAppPanel,
  experimental_usePanelTabs as usePanelTabs,
  experimental_useSidebarThreads as useSidebarThreads,
  useBbNavigate,
  useSdk,
  type ExperimentalThreadHeaderRowProps,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";

import { runWorkspaceScript } from "@/app/scripts/run";

import { Icon } from "@/components/ui/icon";
import { StatusGlyph } from "@/components/inbox/status-glyph";
import { useSidebarMode } from "@/hooks/use-sidebar-mode";
import { useThreadActions } from "@/hooks/use-thread-actions";
import { useWorkspaceIndex } from "@/hooks/use-workspace-index";
import { cn } from "@/lib/utils";
import { NEW_CHAT_PANEL_PATH } from "@/app/new-chat/route";
import { recordLastActive } from "@/lib/last-active";
import { formatLineCount } from "@/lib/workspace";
import { useWorkspaceChanges } from "@/lib/workspace-changes";
import {
  findDiffTabKey,
  tabAfterClose,
  workspaceChats,
} from "@/lib/workspace-tabs";

const TAB_CLASS =
  "group/tab relative flex h-7 max-w-56 min-w-0 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs";
const ACTIVE_TAB_CLASS = "text-foreground bg-sidebar-accent";
const IDLE_TAB_CLASS = "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50";
const CLOSE_CLASS =
  "relative z-10 inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-subtle-foreground opacity-0 hover:bg-state-hover hover:text-foreground group-hover/tab:opacity-100 focus-visible:opacity-100";

function showsStatus(thread: PluginSidebarThread): boolean {
  return (
    thread.indicator === "runtime" ||
    thread.indicator === "workflow" ||
    thread.indicator === "background-agent" ||
    thread.indicator === "background-command" ||
    thread.indicator === "plan-mode" ||
    thread.indicator === "waiting-for-input"
  );
}

/**
 * The conversations in this workspace, above the timeline.
 *
 * One tab per visible top-level conversation, oldest first, plus the thread the
 * pane is showing when it is a subagent or a side chat. Closing a tab archives
 * the thread, and an active tab moves to its neighbor before it goes.
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
  const { threads } = useSidebarThreads();
  const actions = useThreadActions();
  const navigate = useBbNavigate();
  const panel = useAppPanel();
  const panelTabs = usePanelTabs();
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

  if (mode === "threads" || workspace === undefined) return null;
  const chats = workspaceChats(threads, workspace.key, threadId, index);
  if (chats.length === 0) return null;
  const diffTabKey = findDiffTabKey(panelTabs.tabs);

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
        {chats.map((chat) => {
          const active = chat.id === threadId;
          const next = tabAfterClose(chats, chat.id);
          return (
            <div
              key={chat.id}
              className={cn(
                TAB_CLASS,
                active ? ACTIVE_TAB_CLASS : IDLE_TAB_CLASS,
              )}
            >
              <a
                role="tab"
                aria-selected={active}
                href={chat.href}
                draggable={false}
                className="absolute inset-0 rounded-md outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              {showsStatus(chat) ? (
                <StatusGlyph
                  indicator={chat.indicator}
                  label={chat.indicatorLabel}
                  className="shrink-0"
                />
              ) : null}
              <span className="pointer-events-none min-w-0 truncate">
                <ThreadTitle threadId={chat.id} />
              </span>
              <button
                type="button"
                aria-label={`Close ${chat.displayTitle}`}
                className={CLOSE_CLASS}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (active && next !== null) {
                    navigate.toThread(next.id);
                    window.setTimeout(() => actions.archive(chat.id), 0);
                    return;
                  }
                  actions.archive(chat.id);
                }}
              >
                <Icon name="X" className="size-3" />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          aria-label="New conversation in this workspace"
          title="New conversation in this workspace"
          className="my-1 inline-flex w-7 shrink-0 items-center justify-center rounded-md text-subtle-foreground hover:bg-state-hover hover:text-foreground"
          onClick={() =>
            navigate.toPluginPanel(NEW_CHAT_PANEL_PATH, {
              subPath: environmentId ?? "",
            })
          }
        >
          <Icon name="Plus" className="size-3.5" />
        </button>
      </div>
      <button
        type="button"
        title={running ? "Starting…" : "Run"}
        aria-label={running ? "Starting the workspace script" : "Run the workspace script"}
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
    </div>
  );
}
