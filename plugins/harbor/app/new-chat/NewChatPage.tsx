import {
  experimental_NewThreadComposer as NewThreadComposer,
  type NewThreadRequest,
  type PluginComposerApi,
  type PluginNavPanelProps,
  type PluginSidebarThread,
  ThreadTitle,
  useBbNavigate,
  useComposers,
  useSdk,
  experimental_useSidebarThreads as useSidebarThreads,
} from "@get-bb/plugin-sdk/app";
import { useMemo, useState } from "react";
import { useParkConversation } from "@/components/header/use-park-conversation";
import { WorkspaceTabStrip } from "@/components/header/WorkspaceTabStrip";
import { Icon } from "@/components/ui/icon";
import { useMinuteClock } from "@/hooks/use-minute-clock";
import { useThreadActions } from "@/hooks/use-thread-actions";
import { useThreadShelves } from "@/hooks/use-lifecycle";
import { useWorkspaceIndex } from "@/hooks/use-workspace-index";
import {
  untitledCloseTarget,
  workspaceTabs,
} from "@/lib/domain/workspace-tabs";
import { lastActiveFor } from "@/lib/ui/last-active";
import {
  draftKeyFor,
  environmentIdFromSubPath,
} from "./route.js";

function findComposer(
  composers: readonly PluginComposerApi[],
  draftKey: string,
): PluginComposerApi | null {
  const fresh = composers.filter(
    (composer) => composer.scope.kind === "new-thread",
  );
  return (
    fresh.find((composer) => composer.key.includes(draftKey)) ??
    fresh.at(-1) ??
    null
  );
}

function TranscriptChips({
  chats,
  draftKey,
}: {
  chats: readonly PluginSidebarThread[];
  draftKey: string;
}) {
  const composers = useComposers();
  const add = (chat: PluginSidebarThread) => {
    const composer = findComposer(composers, draftKey);
    if (composer === null) return;
    composer.insert([
      {
        from: 0,
        to: 0,
        kind: "thread",
        threadId: chat.id,
        projectId: chat.projectId,
        label: chat.displayTitle,
      },
      " ",
    ]);
    composer.focus();
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {chats.map((chat) => (
        <button
          key={chat.id}
          type="button"
          className="inline-flex h-7 max-w-64 min-w-0 items-center gap-1.5 rounded-md border border-border-hairline px-2 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground"
          onClick={() => add(chat)}
        >
          <Icon name="MessageSquare" className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">
            <ThreadTitle threadId={chat.id} />
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * A new conversation bound to one workspace.
 *
 * The composer reuses the workspace's environment, so the thread starts in the
 * same worktree the strip belongs to. The chips add another conversation's
 * transcript as a mention, which is how a new chat inherits context without a
 * message being sent for it.
 */
export function NewChatPage({ subPath }: PluginNavPanelProps) {
  const environmentId = environmentIdFromSubPath(subPath);
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const index = useWorkspaceIndex();
  const shelves = useThreadShelves();
  const { threads, projects } = useSidebarThreads();
  const { settle } = useParkConversation();
  const actions = useThreadActions();
  const now = useMinuteClock();
  const [focusRequest, setFocusRequest] = useState(1);

  const workspace = useMemo(() => {
    if (environmentId === null) return null;
    const key = index.byEnvironmentId.get(environmentId);
    return key === undefined ? null : (index.byKey?.get(key) ?? null);
  }, [environmentId, index]);

  const tabs = useMemo(() => {
    if (workspace === null) return [];
    return workspaceTabs(threads, workspace.key, "", index, now).filter(
      (tab) => shelves.shelfFor(tab.thread) === "active",
    );
  }, [index, now, shelves, threads, workspace]);
  const chats = useMemo(() => tabs.map((tab) => tab.thread), [tabs]);

  if (environmentId === null || workspace === null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        This workspace has no conversations.
      </div>
    );
  }

  const closeUntitled = () => {
    const target = untitledCloseTarget(
      workspace,
      threads,
      index,
      lastActiveFor(workspace.key),
    );
    if (target !== null) navigate.toThread(target);
  };

  const contextLabel = workspace.featureId
    ? (index.featureNames?.get(workspace.featureId) ?? null)
    : (projects.find((project) => project.id === workspace.projectId)?.name ?? null);
  const destinationLabel =
    contextLabel && contextLabel !== workspace.label
      ? `${contextLabel} / ${workspace.label}`
      : workspace.label;

  return (
    <div
      data-harbor-new-chat={environmentId}
      className="flex h-full min-h-0 flex-col"
    >
      <WorkspaceTabStrip
        tabs={tabs}
        activeThreadId={null}
        untitled
        newChatLabel="New conversation in this workspace"
        onNewChat={() => setFocusRequest((value) => value + 1)}
        onOpenTab={(tab) => navigate.toThread(tab.thread.id)}
        onCloseTab={(tab) => settle(tab.thread.id)}
        onTogglePin={(tab) => {
          void actions.setPinned(tab.thread.id, !tab.thread.isPinned);
        }}
        onCloseTabs={(list) => {
          for (const tab of list) settle(tab.thread.id);
        }}
        onCloseUntitled={closeUntitled}
      />
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-3 overflow-y-auto px-6 py-5 text-sm text-muted-foreground">
        <p>
          New conversation in{" "}
          <code className="font-mono text-foreground">{destinationLabel}</code>.
        </p>
        {chats.length === 0 ? null : (
          <div className="flex flex-col gap-2">
            <p>Add a conversation&apos;s transcript:</p>
            <TranscriptChips chats={chats} draftKey={draftKeyFor(environmentId)} />
          </div>
        )}
      </div>
      <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-5">
        <NewThreadComposer
          key={environmentId}
          // The composer is pinned to the bottom of this page, so its slash and
          // mention menus must open upward; the SDK picks the menu side from
          // `layout`, and `document` would open them down past the window edge.
          layout="contained"
          draftKey={draftKeyFor(environmentId)}
          defaultProjectId={workspace.projectId}
          defaultEnvironment={{ type: "reuse", environmentId }}
          focusRequest={focusRequest}
          placeholder="Ask to make changes, @mention files, run /commands"
          onSubmit={async (request: NewThreadRequest) => {
            const thread = await sdk.threads.spawn(request);
            navigate.toThread(thread.id);
          }}
        />
      </div>
    </div>
  );
}
