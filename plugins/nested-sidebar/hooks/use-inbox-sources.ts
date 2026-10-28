import { useMemo } from "react";
import {
  experimental_useProviders as useProviders,
  useRpc,
  type PluginSidebarProject,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";

import type { nestRpcContract } from "@/server/contract";
import type { ProviderGlyphInfo } from "@/components/inbox/provider-glyph";
import type { NestViewStateApi } from "@/components/inbox/view-state-context";
import { useAppearance } from "@/hooks/use-appearance";
import { useGroups } from "@/hooks/use-groups";
import { useInboxViewState } from "@/hooks/use-inbox-view-state";
import { useLifecycle, type LifecycleApi } from "@/hooks/use-lifecycle";
import { useNestOrder, type NestOrderApi } from "@/hooks/use-nest-order";
import { useNewThread, type NewThreadApi } from "@/hooks/use-new-thread";
import { useProjectColors } from "@/hooks/use-project-colors";
import { useProjectIcons } from "@/hooks/use-project-icons";
import { useRepoFacts } from "@/hooks/use-repo-facts";
import { useSettledThreads } from "@/hooks/use-settled-threads";
import { useThreadActions } from "@/hooks/use-thread-actions";
import { useThreadView } from "@/hooks/use-thread-view";
import { useViewPreferences, type ViewPreferencesApi } from "@/hooks/use-view-preferences";
import { useWorkingSince } from "@/hooks/use-working-since";
import { useWorkspacePaths } from "@/hooks/use-workspace-paths";
import {
  mergeSettledThreads,
} from "@/lib/settled-threads";
import { threadViewNotice } from "@/lib/thread-snapshot";
import type { NestViewState } from "@/lib/view-state";
import type {
  UnseenOwnedWorkspace,
  WorkspaceOwnershipMap,
} from "@/lib/workspace-ownership";
import type { ProjectIcon } from "@/lib/project-icons";
import type { WorkingSince } from "@/lib/working-since";

export interface InboxSources {
  readonly view: ReturnType<typeof useThreadView>["view"];
  readonly status: ReturnType<typeof useThreadView>["status"];
  readonly recovering: boolean;
  readonly recoveryError: string | null;
  readonly recover: () => void;
  readonly viewNotice: string | null;
  readonly hostThreads: readonly PluginSidebarThread[];
  readonly projects: readonly PluginSidebarProject[];
  readonly providers: ReturnType<typeof useProviders>["providers"];
  readonly providerInfoById: ReadonlyMap<string, ProviderGlyphInfo>;
  readonly rpc: ReturnType<typeof useRpc<typeof nestRpcContract>>;
  readonly preferences: ReturnType<typeof useAppearance>["preferences"];
  readonly projectColorOverrides: ReadonlyMap<string, string>;
  readonly projectIcons: ReadonlyMap<string, ProjectIcon>;
  readonly groupsApi: ReturnType<typeof useGroups>;
  readonly paths: ReturnType<typeof useWorkspacePaths>;
  readonly repoFacts: ReturnType<typeof useRepoFacts>;
  readonly workspaceOwnership: WorkspaceOwnershipMap | undefined;
  readonly unseenWorkspaces:
    | Readonly<Record<string, readonly UnseenOwnedWorkspace[]>>
    | undefined;
  readonly viewStateStore: ReturnType<typeof useInboxViewState>;
  readonly viewState: NestViewState;
  readonly viewStateApi: NestViewStateApi;
  readonly sidebarActions: ReturnType<typeof useThreadActions>;
  readonly settledThreads: readonly PluginSidebarThread[];
  readonly settledRowsPending: boolean;
  readonly threads: readonly PluginSidebarThread[];
  readonly workingSince: WorkingSince;
  readonly newThread: NewThreadApi;
  readonly lifecycle: LifecycleApi;
  readonly order: NestOrderApi;
  readonly viewPreferences: ViewPreferencesApi;
}

export function useInboxSources(input: {
  readonly now: number;
  readonly onNavigate: () => void;
}): InboxSources {
  const { view, status, recovering, recoveryError, recover } = useThreadView();
  const hostThreads = view.threads;
  const projects = view.projects;
  const { providers } = useProviders();
  const rpc = useRpc<typeof nestRpcContract>();
  const { preferences } = useAppearance();
  const { overrides: projectColorOverrides } = useProjectColors();
  const projectIds = useMemo(
    () => projects.map((project) => project.id),
    [projects],
  );
  const { icons: projectIcons } = useProjectIcons({
    projectIds,
    enabled: preferences.autoProjectIcons,
  });
  const groupsApi = useGroups();
  const paths = useWorkspacePaths();
  const repoFacts = useRepoFacts();
  const workspaceOwnership =
    preferences.workspaceOwnership === "filesystem"
      ? repoFacts.workspaceOwnership
      : undefined;
  const unseenWorkspaces =
    workspaceOwnership === undefined ||
    !preferences.showUnregisteredWorktrees
      ? undefined
      : repoFacts.unseenWorkspaces;
  const viewStateStore = useInboxViewState();
  const sidebarActions = useThreadActions();
  const { threads: settledThreads, rowsPending: settledRowsPending } =
    useSettledThreads(input.now);
  const threads = useMemo(
    () => mergeSettledThreads(hostThreads, settledThreads),
    [hostThreads, settledThreads],
  );
  const workingSince = useWorkingSince(threads);
  const newThread = useNewThread({
    paths,
    hostThreads,
    openThread: sidebarActions.open,
    onNavigate: input.onNavigate,
  });
  const lifecycle = useLifecycle(threads);
  const order = useNestOrder();
  const viewPreferences = useViewPreferences();
  const providerInfoById = useMemo<
    ReadonlyMap<string, ProviderGlyphInfo>
  >(
    () =>
      new Map(
        providers.map((provider) => [
          provider.id,
          {
            displayName: provider.displayName,
            logoUrl: provider.logoUrl,
          },
        ]),
      ),
    [providers],
  );

  return {
    view,
    status,
    recovering,
    recoveryError,
    recover,
    viewNotice: threadViewNotice(view.source),
    hostThreads,
    projects,
    providers,
    providerInfoById,
    rpc,
    preferences,
    projectColorOverrides,
    projectIcons,
    groupsApi,
    paths,
    repoFacts,
    workspaceOwnership,
    unseenWorkspaces,
    viewStateStore,
    viewState: viewStateStore.state,
    viewStateApi: viewStateStore.api,
    sidebarActions,
    settledThreads,
    settledRowsPending,
    threads,
    workingSince,
    newThread,
    lifecycle,
    order,
    viewPreferences,
  };
}
