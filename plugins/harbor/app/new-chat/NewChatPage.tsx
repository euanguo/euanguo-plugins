import {
  experimental_NewThreadComposer as NewThreadComposer,
  type PluginComposerApi,
  type PluginNavPanelProps,
  type PluginSidebarThread,
  ThreadTitle,
  useBbNavigate,
  useComposers,
  useSdk,
  experimental_useSidebarThreads as useSidebarThreads,
} from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useParkConversation } from "@/components/header/use-park-conversation";
import { WorkspaceTabStrip } from "@/components/header/WorkspaceTabStrip";
import { Icon } from "@/components/ui/icon";
import { useThreadShelves } from "@/hooks/use-lifecycle";
import { useMinuteClock } from "@/hooks/use-minute-clock";
import {
  useWorkspaceSpawn,
  type WorkspaceSpawnEnvironment,
} from "@/hooks/use-new-thread";
import { useThreadActions } from "@/hooks/use-thread-actions";
import { useWorkspaceIndex } from "@/hooks/use-workspace-index";
import {
  untitledCloseTarget,
  workspaceTabs,
} from "@/lib/domain/workspace-tabs";
import { lastActiveFor } from "@/lib/ui/last-active";
import { draftKeyFor, environmentIdFromSubPath } from "./route.js";

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

function basenameOfPath(path: string | null): string | null {
  if (path === null) return null;
  const trimmed = path.replace(/\/+$/u, "");
  const slash = trimmed.lastIndexOf("/");
  const base = slash === -1 ? trimmed : trimmed.slice(slash + 1);
  return base.length > 0 ? base : null;
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
 * same worktree the strip belongs to — including newly created or empty
 * worktrees that have not yet appeared in `workspaceIndex`.
 */
export function NewChatPage({ subPath }: PluginNavPanelProps) {
  const environmentId = environmentIdFromSubPath(subPath);
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const index = useWorkspaceIndex();
  const shelves = useThreadShelves();
  const { threads, projects } = useSidebarThreads();
  const { settle, snoozeUntilTomorrow } = useParkConversation();
  const actions = useThreadActions();
  const now = useMinuteClock();
  type EnvironmentRecord = Awaited<
    ReturnType<ReturnType<typeof useSdk>["environments"]["get"]>
  >;
  const [fetchedEnv, setFetchedEnv] = useState<{
    readonly environmentId: string;
    readonly environment: EnvironmentRecord;
  } | null>(null);

  const workspace = useMemo(() => {
    if (environmentId === null) return null;
    const key = index.byEnvironmentId.get(environmentId);
    return key === undefined ? null : (index.byKey?.get(key) ?? null);
  }, [environmentId, index]);

  useEffect(() => {
    if (environmentId === null || workspace !== null) return;
    let cancelled = false;
    void sdk.environments
      .get({ environmentId })
      .then((environment) => {
        if (!cancelled) setFetchedEnv({ environmentId, environment });
      })
      .catch(() => {
        // An unindexed or unreachable lookup must never lock the composer out.
      });
    return () => {
      cancelled = true;
    };
  }, [environmentId, sdk, workspace]);

  const fallbackEnv =
    fetchedEnv !== null && fetchedEnv.environmentId === environmentId
      ? fetchedEnv.environment
      : null;
  const resolvedProjectId = workspace?.projectId ?? fallbackEnv?.projectId ?? null;

  const tabs = useMemo(() => {
    if (workspace === null) return [];
    return workspaceTabs(threads, workspace.key, "", index, now).filter(
      (tab) => shelves.shelfFor(tab.thread) === "active",
    );
  }, [index, now, shelves, threads, workspace]);
  const chats = useMemo(() => tabs.map((tab) => tab.thread), [tabs]);

  const environmentSeed = useMemo<WorkspaceSpawnEnvironment | undefined>(
    () =>
      environmentId === null
        ? undefined
        : { type: "reuse", environmentId },
    [environmentId],
  );
  const resolveFallbackProjectId = useCallback(async () => {
    if (environmentId === null) return null;
    const env = await sdk.environments.get({ environmentId }).catch(() => null);
    return env?.projectId ?? null;
  }, [environmentId, sdk]);
  const handleCreated = useCallback(
    (threadId: string) => navigate.toThread(threadId),
    [navigate],
  );
  const spawn = useWorkspaceSpawn({
    resetKey: environmentId ?? "",
    projectId: resolvedProjectId ?? undefined,
    environment: environmentSeed,
    resolveFallbackProjectId:
      resolvedProjectId === null ? resolveFallbackProjectId : undefined,
    onCreated: handleCreated,
  });

  if (environmentId === null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No workspace selected.
      </div>
    );
  }

  const closeUntitled = () => {
    if (workspace === null) return;
    const target = untitledCloseTarget(
      workspace,
      threads,
      index,
      lastActiveFor(workspace.key),
    );
    if (target !== null) navigate.toThread(target);
  };

  const contextLabel = workspace
    ? workspace.featureId
      ? (index.featureNames?.get(workspace.featureId) ?? null)
      : (projects.find((project) => project.id === workspace.projectId)?.name ?? null)
    : (projects.find((project) => project.id === resolvedProjectId)?.name ?? null);
  const workspaceLabel =
    workspace?.label ??
    (fallbackEnv?.name?.trim() ||
      fallbackEnv?.branchName?.trim() ||
      basenameOfPath(fallbackEnv?.path ?? null) ||
      "this workspace");
  const destinationLabel =
    contextLabel && contextLabel !== workspaceLabel
      ? `${contextLabel} / ${workspaceLabel}`
      : workspaceLabel;

  return (
    <div
      data-harbor-new-chat={environmentId}
      className="flex h-full min-h-0 flex-col"
    >
      <WorkspaceTabStrip
        tabs={tabs}
        activeThreadId={null}
        untitled
        canParkTab={(tab) => shelves.canPark(tab.thread)}
        newChatLabel="New conversation in this workspace"
        onNewChat={spawn.requestFocus}
        onOpenTab={(tab) => navigate.toThread(tab.thread.id)}
        onCloseTab={(tab) => {
          if (!tab.thread.isPinned && shelves.canPark(tab.thread)) {
            settle(tab.thread.id);
          }
        }}
        onTogglePin={(tab) => {
          void actions.setPinned(tab.thread.id, !tab.thread.isPinned).catch(() =>
            toast.error("Could not change the pin."),
          );
        }}
        onSnooze={(tab) => snoozeUntilTomorrow(tab.thread.id)}
        onCloseTabs={(list) => {
          for (const tab of list) {
            if (!tab.thread.isPinned && shelves.canPark(tab.thread)) {
              settle(tab.thread.id);
            }
          }
        }}
        onCloseUntitled={workspace === null ? undefined : closeUntitled}
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
        {spawn.error === null ? null : (
          <p
            role="alert"
            className="mb-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {spawn.error}
          </p>
        )}
        <NewThreadComposer
          key={environmentId}
          // The composer is pinned to the bottom of this page, so its slash and
          // mention menus must open upward; the SDK picks the menu side from
          // `layout`, and `document` would open them down past the window edge.
          layout="contained"
          draftKey={draftKeyFor(environmentId)}
          defaultProjectId={resolvedProjectId ?? undefined}
          defaultEnvironment={environmentSeed}
          focusRequest={spawn.focusRequest}
          placeholder="Ask to make changes, @mention files, run /commands"
          onSubmit={spawn.submit}
        />
      </div>
    </div>
  );
}
