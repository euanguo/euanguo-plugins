import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { useInboxPalette } from "@/hooks/use-inbox-palette";
import { useInboxActions } from "@/hooks/use-inbox-actions";
import { useInboxSources } from "@/hooks/use-inbox-sources";
import { useInboxTreeModel } from "@/hooks/use-inbox-tree-model";
import { useMinuteClock } from "@/hooks/use-minute-clock";
import { useReorder } from "@/hooks/use-reorder";
import { FlatThreadFallback } from "@/components/inbox/flat-thread-fallback";
import { InboxChrome } from "@/components/inbox/inbox-chrome";
import { FeatureDialogs, useFeatureDialogs } from "@/components/inbox/feature-dialogs";
import { useFeatureSurface } from "@/hooks/use-feature-surface";
import { OrganizationSwitch } from "@/components/inbox/organization-switch";
import { InboxOverlays } from "@/components/inbox/inbox-overlays";
import { InboxTreePanel } from "@/components/inbox/inbox-tree-panel";
import { TREE_SCROLL_CLASS } from "@/components/inbox/inbox-layout";
import { useInboxBulkDelete } from "@/hooks/use-inbox-bulk-delete";
import { WorkingSinceContext } from "@/hooks/use-working-since";
import { nestPreferenceStyle } from "@/lib/preferences";
import { NestViewStateProvider } from "@/components/inbox/view-state-context";
import { SIDEBAR_ANNOUNCEMENT_EVENT } from "@/lib/clipboard";

import { groupScopeKey } from "@/lib/groups";
import type { TreeRowHandlers } from "@/components/inbox/tree-rows";

/**
 * A project-first inbox. Project sections stay put; roots keep their creation
 * order; active root/child families expand in place instead of jumping around.
 */
export function ThreadInbox({
  activeThreadId,
  onNavigate,
  searchQuery,
}: PluginThreadListProps) {
  const now = useMinuteClock();
  const sources = useInboxSources({ now, onNavigate });
  const {
    view,
    status,
    recovering,
    recoveryError,
    recover,
    viewNotice,
    projects,
    providerInfoById, pullRequests,
    rpc, preferences,
    projectColorOverrides,
    projectIcons,
    groupsApi,
    paths,
    viewStateStore,
    viewState,
    viewStateApi,
    sidebarActions,
    threads,
    workingSince,
    newThread,
    lifecycle,
    order,
    viewPreferences,
  } = sources;
  const patchViewState = viewStateStore.patch;
  const [groupManagerOpen, setGroupManagerOpen] = useState(false);
  const featureDialogs = useFeatureDialogs();
  const projectPaths = new Map(
    projects.map((project) => [
      project.id,
      paths.projects[project.id]?.sourcePath ?? null,
    ]),
  );
  const featureSurface = useFeatureSurface({
    api: sources.featuresApi,
    newThread: sources.newThread,
    projects,
    projectPaths,
    patchViewStateWith: viewStateStore.patchWith,
    openDialog: featureDialogs.open,
  });
  const inboxRef = useRef<HTMLDivElement>(null);
  const selectionHintId = useId();
  const treePanelId = useId();
  const [settledPages, setSettledPages] = useState(1);
  const settledLimit = settledPages * preferences.pageSize;
  const seedFromProject = newThread.seedFromProject;
  const seedNewWorktree = newThread.seedNewWorktree;
  const seedFromWorkspace = newThread.seedFromWorkspace;
  const showSnoozed = viewState.snoozedOpen;
  const showSettled = viewState.settledOpen;
  const filterPreset = viewState.filter;

  const [reorderAnnouncement, setReorderAnnouncement] = useState("");
  /**
   * Copy feedback from the row menus, which live too far below this surface to
   * hand a callback through. The live region stays here, where it is announced
   * once for the whole tree.
   */
  const [sidebarAnnouncement, setSidebarAnnouncement] = useState("");
  useEffect(() => {
    const onAnnounce = (event: Event) => {
      if (event instanceof CustomEvent && typeof event.detail === "string") {
        setSidebarAnnouncement(event.detail);
      }
    };
    window.addEventListener(SIDEBAR_ANNOUNCEMENT_EVENT, onAnnounce);
    return () =>
      window.removeEventListener(SIDEBAR_ANNOUNCEMENT_EVENT, onAnnounce);
  }, []);
  const [selectedRootIds, setSelectedRootIds] = useState<Set<string>>(
    () => new Set(),
  );

  useInboxPalette({ lifecycle, threads, patchViewState });

  /**
   * The selection tool is for thread families, and the workspaces view draws
   * none: leaving selection mode is the only honest state to arrive in.
   */
  const [selectionMode, setSelectionMode] = useState(false);
  useEffect(() => {
    if (viewPreferences.sidebarMode === "workspaces") setSelectionMode(false);
  }, [viewPreferences.sidebarMode]);

  const treeModel = useInboxTreeModel({
    sources,
    activeThreadId,
    now,
    searchQuery,
    selectionMode,
    selectedRootIds,
  });

  const {
    activeScopeKey,
    archived,
    archivedFeatures,
    featureNodes,
    firstLevel,
    groupTabs,
    nothingToShow,
    orderedPinnedFamilies,
    pendingSettled,
    pinnedOrder,
    reorderPinnedByKeyboard,
    rootTitleById,
    searching,
    selectableVisibleRootIds,
    settled,
    showParkedShelves,
    snoozed,
    treeNodes,
    unfilteredProjectGroups,
    visibleRootCount,
    visibleRootOrderKey,
  } = treeModel;
  const bulkDelete = useInboxBulkDelete({
    activeThreadId,
    inboxRef,
    selectableVisibleRootIds,
    unfilteredProjectGroups,
    visibleRootOrderKey,
    filterPreset,
    searchQuery,
    selectionMode,
    setSelectionMode,
    selectedRootIds,
    setSelectedRootIds,
  });
  const {
    bulkPreview,
    bulkBusy,
    bulkMessage,
    bulkOutcomes,
    beginSelection,
    cancelSelection,
    clearSelection,
    changeSelectedRoot,
    selectAllVisible,
    previewSelectedDeletion,
    confirmSelectedDeletion,
    closePreview,
  } = bulkDelete;

  /**
   * Every reorder path, and the gates that decide which are offered.
   *
   * The gates are shared — a filter, a search, or a bulk selection disables all
   * four levels at once — which is why they are one hook rather than four.
   */
  const reorder = useReorder({
    selectionMode,
    filterPreset,
    searching,
    viewPreferences,
    order,
    unfilteredProjectGroups,
    workspaceIndex: treeModel.workspaceIndex,
    setReorderAnnouncement,
    viewStateApi,
    rootTitleById,
    groupsApi,
  });
  const {
    reorderEnabled,
    familyReorderDisabledReason,
    workspaceReorderDisabledReason,
    workspaceReorderEnabled,
    projectReorderDisabledReason,
    projectReorderEnabled,
    pinnedReorderDisabledReason,
    pinnedReorderEnabled,
    reorderByDrag,
    reorderByKeyboard,
    reorderWorkspaceByDrag,
    reorderWorkspaceByKeyboard,
    reorderProjectByDrag,
    reorderProjectByKeyboard,
    reorderProjectDrop,
  } = reorder;

  const {
    assignGroup,
    renameGroup,
    removeGroup,
    moveGroup,
    renameProject,
    renameWorktree,
    collapseAll,
    resetView,
  } = useInboxActions({
    rpc,
    groupsApi,
    viewPreferences,
    unfilteredProjectGroups,
    patchViewState,
    announce: setReorderAnnouncement,
  });

  const treeHandlers: TreeRowHandlers = {
    firstLevel,
    providerInfoById,
    workspaceChanges: treeModel.workspaceChanges,
    activeWorkspaceKey: treeModel.activeWorkspaceKey,
    pullRequests,
    paths,
    activeThreadId,
    forceExpanded: searching,
    searching,
    lifecycle,
    onNavigate,
    now,
    selectionMode,
    selectedRootIds,
    selectionHintId,
    onToggleRoot: changeSelectedRoot,
    onNewThreadInWorkspace: seedFromWorkspace,
    preferences,
    reorderEnabled,
    reorderDisabledReason: familyReorderDisabledReason,
    onReorder: reorderByDrag,
    onKeyboardMove: reorderByKeyboard,
    archivedByProject: archived.byProject,
    onUnarchiveArchived: archived.unarchive,
    pinnedReorderEnabled,
    pinnedReorderDisabledReason,
    onPinnedKeyboardMove: reorderPinnedByKeyboard,
    workspaceReorderEnabled,
    workspaceReorderDisabledReason,
    onWorkspaceReorder: reorderWorkspaceByDrag,
    onWorkspaceKeyboardMove: reorderWorkspaceByKeyboard,
    projectReorderEnabled,
    projectReorderDisabledReason,
    onProjectReorder: reorderProjectByDrag,
    onProjectKeyboardMove: reorderProjectByKeyboard,
    onGroupMove: moveGroup,
    onRenameGroup: renameGroup,
    onRemoveGroup: removeGroup,
    onRenameProject: renameProject,
    onRenameWorktree: renameWorktree,
    ...featureSurface.workspaceHandlers,
  };

  /**
   * bb's own list, on request.
   *
   * The host hands its list over for exactly this: a user whose sidebar is not
   * behaving gets a working list without going into Settings, and a replaced
   * sidebar cannot take the list away from them. It is offered where the failure
   * is — the cold-failure state below — rather than behind a setting nobody would
   * find while looking at a sidebar that is not working.
   */
  const [showFlatFallback, setShowFlatFallback] = useState(false);

  if (showFlatFallback) {
    return (
      <div className={TREE_SCROLL_CLASS} data-nest-scroll="">
        <FlatThreadFallback
          threads={view.threads}
          onOpen={(id) => {
            sidebarActions.open(id);
            onNavigate();
          }}
        />
      </div>
    );
  }

  return (
    <WorkingSinceContext.Provider value={workingSince}>
      <NestViewStateProvider value={viewStateApi}>
        <div
          ref={inboxRef}
          data-nest-palette={preferences.palettePreset}
          style={nestPreferenceStyle(preferences) as CSSProperties}
          className="flex min-h-0 flex-1 flex-col"
        >
          <InboxChrome
            announcement={reorderAnnouncement || sidebarAnnouncement}
            firstLevel={firstLevel}
            pinned={{
              pinned: orderedPinnedFamilies,
              handlers: treeHandlers,
              reorderEnabled: pinnedReorderEnabled,
              reorderDisabledReason: pinnedReorderDisabledReason,
              onReorder: pinnedOrder.move,
            }}
            tabs={{
              items: groupTabs,
              activeKey: activeScopeKey,
              panelId: treePanelId,
              onSelect: (scope) =>
                patchViewState({ scope: groupScopeKey(scope) }),
              onManage: () => setGroupManagerOpen(true),
            }}
            view={{
              preferences: viewPreferences,
              filter: filterPreset,
              onFilterChange: (filter) => patchViewState({ filter }),
              onCollapseAll: collapseAll,
              onReset: resetView,
            }}
            selection={{
              active: selectionMode,
              selectedCount: selectedRootIds.size,
              selectableCount: selectableVisibleRootIds.length,
              visibleCount: visibleRootCount,
              busy: bulkBusy,
              hintId: selectionHintId,
              message: bulkMessage,
              outcomes: bulkOutcomes,
              rootTitleById,
              onBegin: beginSelection,
              onSelectAll: selectAllVisible,
              onClear: clearSelection,
              onRequestDelete: () => void previewSelectedDeletion(),
              onCancel: cancelSelection,
            }}
          />
          <InboxTreePanel
            panelId={treePanelId}
            activeScopeKey={activeScopeKey}
            notice={{
              text: viewNotice,
              source: view.source,
              status,
              recovering,
              error: recoveryError,
              onRetry: recover,
              onUseOriginal: () => setShowFlatFallback(true),
            }}
            ordering={{
              changedElsewhere: order.changedElsewhere,
              reload: order.reload,
            }}
            empty={{
              lifecycleReady: lifecycle.shelvesReady,
              nothingToShow,
              searching,
              filter: filterPreset,
              projectCount: projects.length,
            }}
            features={{
              nodes: featureNodes,
              features: sources.featuresApi.features,
              actions: featureSurface.rowActions,
              onCreate: featureSurface.onCreate,
              showWhenEmpty: treeModel.showEmptyFeatures,
              archived: archivedFeatures,
              onReopen: featureSurface.onReopen,
            }}
            tree={{
              nodes: treeNodes,
              handlers: treeHandlers,
              groups: groupsApi.groups,
              assignGroup,
              seedFromProject,
              seedNewWorktree,
              seedFromWorkspace,
              projectColorOverrides,
              projectIcons,
              projectReorder: {
                enabled: projectReorderEnabled,
                next: reorderProjectByKeyboard,
                drop: reorderProjectDrop,
              },
            }}
            shelves={{
              shown: showParkedShelves,
              snoozed,
              settled,
              pendingSettled,
              showSnoozed,
              showSettled,
              activeThreadId,
              lifecycle,
              navigate: onNavigate,
              now,
              settledLimit,
              settledPageSize: preferences.pageSize,
              searching,
              settledPages,
              toggleSnoozed: () =>
                patchViewState({ snoozedOpen: !showSnoozed }),
              toggleSettled: () =>
                patchViewState({ settledOpen: !showSettled }),
              loadMoreSettled: () =>
                setSettledPages((pages) => pages + 1),
              showLessSettled: () => setSettledPages(1),
            }}
          />
          <OrganizationSwitch
            projectSignals={treeModel.projectStatusSignals}
            workspaceSignals={treeModel.workspaceStatusSignals}
            mode={viewPreferences.sidebarMode}
            onChange={viewPreferences.setSidebarMode}
          />
          <InboxOverlays
            bulkDelete={{
              preview: bulkPreview,
              busy: bulkBusy,
              close: closePreview,
              confirm: () => void confirmSelectedDeletion(),
            }}
            groups={{
              open: groupManagerOpen,
              items: groupsApi.groups,
              icons: groupsApi.icons,
              close: () => setGroupManagerOpen(false),
            }}
            newThread={newThread}
          />
          <FeatureDialogs
            state={featureDialogs.state}
            api={sources.featuresApi}
            projects={featureSurface.repositoryProjects}
            projectPaths={projectPaths}
            onClose={featureDialogs.close}
            onCreated={featureSurface.onCreated}
          />
        </div>
    </NestViewStateProvider>
    </WorkingSinceContext.Provider>
  );
}
