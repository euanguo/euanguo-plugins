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
import { FeatureHubModal } from "@/components/feature-hub/feature-hub-modal";
import { useParkConversation } from "@/components/header/use-park-conversation";
import { WorkspaceTabStrip } from "@/components/header/WorkspaceTabStrip";
import { Icon } from "@bb-ui/icon";
import { useFeatures } from "@/hooks/use-features";
import { useThreadShelves } from "@/hooks/use-lifecycle";
import { useMinuteClock } from "@/hooks/use-minute-clock";
import {
  useWorkspaceSpawn,
  type WorkspaceSpawnEnvironment,
} from "@/hooks/use-new-thread";
import { useThreadActions } from "@/hooks/use-thread-actions";
import { useWorkspaceIndex } from "@/hooks/use-workspace-index";
import { isFeatureRoot } from "@/lib/domain/features";
import { featureRootParent, normalizePath } from "@/lib/domain/feature-root";
import {
  untitledCloseTarget,
  workspaceTabs,
} from "@/lib/domain/workspace-tabs";
import { lastActiveFor } from "@/lib/ui/last-active";
import {
  clearActiveNewChat,
  publishActiveNewChat,
  type ActiveNewChatTarget,
} from "@/lib/ui/workspace-index-store";
import {
  draftKeyForTarget,
  parseNewChatSubPath,
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
 * A new conversation bound to one workspace or feature root folder.
 *
 * For an existing environment, reuses the environment directly (including
 * newly created worktrees not yet indexed). For a feature root target, locks
 * both the home Features project and the feature folder so orchestrator
 * conversations always land under the feature even before an environment
 * record exists.
 */
export function NewChatPage({ subPath }: PluginNavPanelProps) {
  const target = parseNewChatSubPath(subPath);
  const environmentId =
    target?.kind === "environment" ? target.environmentId : null;
  const targetFeatureId = target?.kind === "feature" ? target.featureId : null;
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const index = useWorkspaceIndex();
  const featuresApi = useFeatures();
  const shelves = useThreadShelves();
  const { threads, projects } = useSidebarThreads();
  const { settle, snoozeUntilTomorrow } = useParkConversation();
  const actions = useThreadActions();
  const now = useMinuteClock();
  const [hubOpen, setHubOpen] = useState(false);
  type EnvironmentRecord = Awaited<
    ReturnType<ReturnType<typeof useSdk>["environments"]["get"]>
  >;
  const [fetchedEnv, setFetchedEnv] = useState<{
    readonly environmentId: string;
    readonly environment: EnvironmentRecord;
  } | null>(null);

  const feature = useMemo(() => {
    if (targetFeatureId !== null) {
      return featuresApi.byId.get(targetFeatureId) ?? null;
    }
    if (environmentId !== null) {
      const key = index.byEnvironmentId.get(environmentId);
      const envWorkspace = key === undefined ? null : (index.byKey?.get(key) ?? null);
      if (envWorkspace?.featureId) {
        return featuresApi.byId.get(envWorkspace.featureId) ?? null;
      }
    }
    return null;
  }, [environmentId, featuresApi.byId, index, targetFeatureId]);

  const workspace = useMemo(() => {
    if (targetFeatureId !== null) {
      const list = index.byFeature?.get(targetFeatureId) ?? [];
      return (
        list.find((entry) => feature !== null && isFeatureRoot(feature, entry.path)) ??
        null
      );
    }
    if (environmentId === null) return null;
    const key = index.byEnvironmentId.get(environmentId);
    return key === undefined ? null : (index.byKey?.get(key) ?? null);
  }, [environmentId, feature, index, targetFeatureId]);

  useEffect(() => {
    const published: ActiveNewChatTarget | null =
      targetFeatureId !== null
        ? { kind: "feature", featureId: targetFeatureId }
        : environmentId !== null
          ? { kind: "environment", environmentId }
          : null;
    publishActiveNewChat(published);
    return () => {
      if (published !== null) clearActiveNewChat(published);
    };
  }, [environmentId, targetFeatureId]);

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
    environmentId !== null &&
    fetchedEnv !== null &&
    fetchedEnv.environmentId === environmentId
      ? fetchedEnv.environment
      : null;
  const featureHomeProjectId =
    targetFeatureId !== null && feature?.rootPath !== null && feature?.rootPath !== undefined
      ? (featuresApi.homeProjects[normalizePath(featureRootParent(feature.rootPath))] ??
          null)
      : null;
  const resolvedProjectId =
    targetFeatureId !== null
      ? (workspace?.projectId ?? featureHomeProjectId)
      : (workspace?.projectId ?? fallbackEnv?.projectId ?? null);

  const tabs = useMemo(() => {
    if (workspace === null) return [];
    return workspaceTabs(threads, workspace.key, "", index, now).filter(
      (tab) => shelves.shelfFor(tab.thread) === "active",
    );
  }, [index, now, shelves, threads, workspace]);
  const chats = useMemo(() => tabs.map((tab) => tab.thread), [tabs]);

  const environmentSeed = useMemo<WorkspaceSpawnEnvironment | undefined>(() => {
    if (targetFeatureId !== null) {
      if (workspace?.canonicalEnvironmentId != null) {
        return { type: "reuse", environmentId: workspace.canonicalEnvironmentId };
      }
      if (feature !== null && feature.rootPath !== null) {
        return {
          type: "host",
          ...(feature.hostId === null ? {} : { hostId: feature.hostId }),
          workspace: { type: "unmanaged", path: feature.rootPath },
        };
      }
      return undefined;
    }
    if (environmentId === null) return undefined;
    return { type: "reuse", environmentId };
  }, [environmentId, feature, targetFeatureId, workspace]);

  const resolveFallbackProjectId = useCallback(async () => {
    if (environmentId === null) return null;
    const env = await sdk.environments.get({ environmentId }).catch(() => null);
    return env?.projectId ?? null;
  }, [environmentId, sdk]);

  const handleCreated = useCallback(
    (threadId: string) => navigate.toThread(threadId),
    [navigate],
  );
  const composerDraftKey = target === null ? "" : draftKeyForTarget(target);
  const spawn = useWorkspaceSpawn({
    resetKey: composerDraftKey,
    projectId: resolvedProjectId ?? undefined,
    environment: environmentSeed,
    locked: targetFeatureId !== null,
    resolveFallbackProjectId:
      targetFeatureId === null && resolvedProjectId === null
        ? resolveFallbackProjectId
        : undefined,
    onCreated: handleCreated,
  });

  if (target === null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No workspace selected.
      </div>
    );
  }

  const closeUntitled = () => {
    if (workspace === null) return;
    const targetThread = untitledCloseTarget(
      workspace,
      threads,
      index,
      lastActiveFor(workspace.key),
    );
    if (targetThread !== null) navigate.toThread(targetThread);
  };

  const contextLabel = workspace
    ? workspace.featureId
      ? (index.featureNames?.get(workspace.featureId) ?? null)
      : (projects.find((project) => project.id === workspace.projectId)?.name ?? null)
    : (projects.find((project) => project.id === resolvedProjectId)?.name ?? null);
  const workspaceLabel =
    targetFeatureId !== null
      ? (feature?.name ?? "this feature")
      : (workspace?.label ??
        (fallbackEnv?.name?.trim() ||
          fallbackEnv?.branchName?.trim() ||
          basenameOfPath(fallbackEnv?.path ?? null) ||
          "this workspace"));
  const destinationLabel =
    targetFeatureId !== null
      ? workspaceLabel
      : contextLabel && contextLabel !== workspaceLabel
        ? `${contextLabel} / ${workspaceLabel}`
        : workspaceLabel;

  const waitingForFeatureSetup =
    targetFeatureId !== null &&
    (feature === null || resolvedProjectId === null || environmentSeed === undefined);

  return (
    <div
      data-harbor-new-chat={targetFeatureId ?? environmentId ?? ""}
      className="flex h-full min-h-0 flex-col"
    >
      <WorkspaceTabStrip
        tabs={tabs}
        activeThreadId={null}
        untitled
        newChatLabel={
          targetFeatureId !== null
            ? "New conversation in this feature"
            : "New conversation in this workspace"
        }
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
        trailing={
          feature === null ? undefined : (
            <button
              type="button"
              title="Open Feature Hub"
              aria-label="Open Feature Hub"
              className="inline-flex h-7 shrink-0 items-center gap-1 self-center rounded-md px-2 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground [@media(pointer:coarse)]:size-10 [@media(pointer:coarse)]:justify-center [@media(pointer:coarse)]:px-0"
              onClick={() => setHubOpen(true)}
            >
              <Icon name="Layers" className="size-3.5 [@media(pointer:coarse)]:size-5" />
              <span className="hidden lg:inline [@media(pointer:coarse)]:hidden">Hub</span>
            </button>
          )
        }
      />
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-3 overflow-y-auto px-6 py-5 text-sm text-muted-foreground">
        {targetFeatureId !== null && featuresApi.ready && feature === null ? (
          <p className="text-destructive">Feature is no longer available.</p>
        ) : (
          <p>
            New conversation in{" "}
            <code className="font-mono text-foreground">{destinationLabel}</code>
            {targetFeatureId !== null ? (
              <span className="text-xs text-muted-foreground">
                {" "}
                · Feature root (sees all attached repositories)
              </span>
            ) : (
              "."
            )}
          </p>
        )}
        {chats.length === 0 ? null : (
          <div className="flex flex-col gap-2">
            <p>Add a conversation&apos;s transcript:</p>
            <TranscriptChips chats={chats} draftKey={composerDraftKey} />
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
        {waitingForFeatureSetup ? (
          <div className="rounded-lg border border-border/60 bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
            {featuresApi.ready
              ? "Preparing feature workspace…"
              : "Loading feature workspace…"}
          </div>
        ) : (
          <NewThreadComposer
            key={composerDraftKey}
            // The composer is pinned to the bottom of this page, so its slash and
            // mention menus must open upward; the SDK picks the menu side from
            // `layout`, and `document` would open them down past the window edge.
            layout="contained"
            draftKey={composerDraftKey}
            defaultProjectId={resolvedProjectId ?? undefined}
            defaultEnvironment={environmentSeed}
            focusRequest={spawn.focusRequest}
            placeholder={
              targetFeatureId !== null
                ? "Ask across the feature's repositories, @mention files, run /commands"
                : "Ask to make changes, @mention files, run /commands"
            }
            onSubmit={spawn.submit}
          />
        )}
      </div>
      <FeatureHubModal
        open={hubOpen}
        featureId={feature?.id ?? null}
        onClose={() => setHubOpen(false)}
      />
    </div>
  );
}
