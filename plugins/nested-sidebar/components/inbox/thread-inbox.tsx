import {
  useEffect,
  useId,
  useMemo,
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
import { FeatureTreePanel } from "@/components/inbox/feature-tree-panel";
import {
  FeatureDialogs,
  useFeatureDialogs,
} from "@/components/inbox/feature-dialogs";
import { OrganizationSwitch } from "@/components/inbox/organization-switch";
import { InboxOverlays } from "@/components/inbox/inbox-overlays";
import { InboxTreePanel } from "@/components/inbox/inbox-tree-panel";
import { TREE_SCROLL_CLASS } from "@/components/inbox/inbox-layout";
import { useInboxBulkDelete } from "@/hooks/use-inbox-bulk-delete";
import { WorkingSinceContext } from "@/hooks/use-working-since";
import { useSidebarScrollOwner } from "@/hooks/use-sidebar-scroll-owner";
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
    providerInfoById,
    rpc,
    preferences,
    projectColorOverrides,
    projectIcons,
    groupsApi,
    paths,
    workspaceOwnership,
    unseenWorkspaces,
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
  const inboxRef = useRef<HTMLDivElement>(null);
  useSidebarScrollOwner(inboxRef);
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
  const [selectionMode, setSelectionMode] = useState(false);

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
    featureNodes,
    firstLevel,
    groupScope,
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
    paths,
    workspaceOwnership,
    unseenWorkspaces,
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

  /**
   * Feature ids to names, for the badge on a worktree row.
   *
   * A row carries only the label, which is an id. Resolving it once here keeps
   * the row from holding a copy of the feature list it would have to keep in
   * step with.
   */
  const featureNameById = useMemo(
    () =>
      new Map(
        sources.featuresApi.features.map((feature) => [
          feature.id,
          feature.name,
        ]),
      ),
    [sources.featuresApi.features],
  );

  const treeHandlers: TreeRowHandlers = {
    providerInfoById,
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
    featureLabels: sources.featuresApi.labels,
    featureNameById: featureNameById,
    features: sources.featuresApi.features,
    onAssignFeature: (environmentId, featureId) => {
      void sources.featuresApi.label(environmentId, featureId);
    },
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
      <div className={TREE_SCROLL_CLASS}>
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
          {firstLevel === "feature" ? (
            <div className={TREE_SCROLL_CLASS} id={treePanelId} role="tabpanel">
              <FeatureTreePanel
                nodes={featureNodes}
                empty={{
                  ready: sources.featuresApi.ready,
                  searching,
                  filter: filterPreset,
                }}
                onOpenWorkspace={(workspace) => {
                  const thread = workspace.families[0]?.root;
                  if (thread === undefined) return;
                  sidebarActions.open(thread.id);
                  onNavigate();
                }}
                onManage={() => featureDialogs.openManager()}
                onAddRepository={(featureId) =>
                  featureDialogs.openMaterialize(featureId)
                }
              />
            </div>
          ) : (
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
          )}
          <OrganizationSwitch
            mode={viewPreferences.organizationMode}
            onChange={viewPreferences.setOrganizationMode}
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
            features={sources.featuresApi}
            groups={groupsApi.groups}
            projects={projects}
            defaultGroupId={
              groupScope.kind === "group" ? groupScope.groupId : null
            }
            onClose={featureDialogs.close}
            onCreate={sources.featuresApi.create}
            onRename={sources.featuresApi.rename}
            onSetGroup={sources.featuresApi.setGroup}
            onDelete={sources.featuresApi.remove}
            onPlan={sources.featuresApi.planWorkspace}
            onCreateWorkspace={sources.featuresApi.materializeWorkspace}
          />
        </div>
    </NestViewStateProvider>
    </WorkingSinceContext.Provider>
  );
}
