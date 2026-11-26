import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import type { PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { BulkDeleteDialog } from "@/components/inbox/bulk-delete-dialog";
import { FeatureDialogs, useFeatureDialogs } from "@/components/inbox/feature-dialogs";
import { FlatThreadFallback } from "@/components/inbox/flat-thread-fallback";
import { GroupManagerDialog } from "@/components/inbox/group-manager-dialog";
import { InboxChrome } from "@/components/inbox/inbox-chrome";
import { TREE_SCROLL_CLASS } from "@/components/inbox/inbox-layout";
import { InboxTreePanel } from "@/components/inbox/inbox-tree-panel";
import { NewThreadDialog } from "@/components/inbox/new-thread-dialog";
import { SegmentedBar } from "@/components/inbox/segmented-bar";
import {
  TreeActionsProvider,
  TreeLiveStateProvider,
} from "@/components/inbox/tree-row-handlers-context";
import { HarborTooltipProvider } from "@/components/ui/tooltip";
import { HarborViewStateProvider } from "@/components/inbox/view-state-context";
import { useFeatureSurface } from "@/hooks/use-feature-surface";
import { useInboxActions } from "@/hooks/use-inbox-actions";
import { useInboxBulkDelete } from "@/hooks/use-inbox-bulk-delete";
import { useInboxPalette } from "@/hooks/use-inbox-palette";
import { useInboxSources } from "@/hooks/use-inbox-sources";
import { useInboxTreeContexts } from "@/hooks/use-inbox-tree-contexts";
import { useInboxTreeModel } from "@/hooks/use-inbox-tree-model";
import { useMinuteClock } from "@/hooks/use-minute-clock";
import { usePagedRows } from "@/hooks/use-paged-rows";
import { useReorder } from "@/hooks/use-reorder";
import { WorkingSinceContext } from "@/hooks/use-working-since";
import { groupScopeKey } from "@/lib/domain/groups";
import { SIDEBAR_MODE_LABELS, type SidebarMode } from "@/lib/domain/organization";
import { harborPreferenceStyle } from "@/lib/domain/preferences";

export function ThreadInbox({
  activeThreadId,
  onNavigate,
  searchQuery,
}: PluginThreadListProps) {
  const now = useMinuteClock();
  const sources = useInboxSources({ now, onNavigate });
  const {
    view, status, recovering, recoveryError, recover, viewNotice,
    projects, preferences, projectColorOverrides, projectIcons, groupsApi,
    paths, viewStateStore, viewState, viewStateApi, sidebarActions,
    threads, workingSince, newThread, lifecycle, order, viewPreferences,
  } = sources;
  const patchViewState = viewStateStore.patch;
  const [groupManagerOpen, setGroupManagerOpen] = useState(false);
  const featureDialogs = useFeatureDialogs();
  const projectPaths = new Map(
    projects.map((project) => [project.id, paths.projects[project.id]?.sourcePath ?? null]),
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
  const showSnoozed = viewState.snoozedOpen;
  const showSettled = viewState.settledOpen;
  const filterPreset = viewState.filter;
  const [reorderAnnouncement, setReorderAnnouncement] = useState("");
  const [selectedRootIds, setSelectedRootIds] = useState<Set<string>>(() => new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [showFlatFallback, setShowFlatFallback] = useState(false);

  useInboxPalette({ lifecycle, threads, patchViewState });

  useEffect(() => {
    if (viewPreferences.sidebarMode === "workspaces" || viewState.surface === "features") {
      setSelectionMode(false);
    }
  }, [viewPreferences.sidebarMode, viewState.surface]);

  const treeModel = useInboxTreeModel({
    sources, activeThreadId, now, searchQuery, selectionMode, selectedRootIds,
  });
  const {
    activeScopeKey, archivedFeatures, featureNodes, firstLevel, groupTabs,
    nothingToShow, orderedPinnedFamilies, parkedFeatures, pendingSettled, pinnedOrder,
    rootTitleById, searching, selectableVisibleRootIds, settled, showParkedShelves,
    snoozed, treeNodes, unfilteredProjectGroups, visibleRootCount, visibleRootOrderKey,
  } = treeModel;

  const settledPaged = usePagedRows({
    total: settled.length, pageSize: preferences.pageSize, searching,
  });
  const bulkDelete = useInboxBulkDelete({
    activeThreadId, inboxRef, selectableVisibleRootIds, unfilteredProjectGroups,
    visibleRootOrderKey, filterPreset, searchQuery, selectionMode, setSelectionMode,
    selectedRootIds, setSelectedRootIds,
  });
  const reorder = useReorder({
    selectionMode, filterPreset, searching, viewPreferences, order,
    unfilteredProjectGroups, workspaceIndex: treeModel.workspaceIndex,
    setReorderAnnouncement, viewStateApi, rootTitleById, groupsApi,
  });
  const featureIds = sources.featuresApi.features.map((feature) => feature.id);
  const inboxActions = useInboxActions({
    rpc: sources.rpc, groupsApi, viewPreferences, unfilteredProjectGroups,
    machineSectionKeys: treeModel.machineSectionKeys, featureIds,
    patchViewState, announce: setReorderAnnouncement,
  });
  const { sidebarAnnouncement, projectReorder, treeActions, treeLiveState } = useInboxTreeContexts({
    sources, treeModel, featureSurface, reorder, inboxActions,
    selectionMode, selectedRootIds, selectionHintId,
    onToggleRoot: bulkDelete.changeSelectedRoot, onNavigate, activeThreadId, now,
  });

  if (showFlatFallback) {
    return (
      <div className={TREE_SCROLL_CLASS} data-harbor-scroll="">
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
    <HarborTooltipProvider>
      <WorkingSinceContext.Provider value={workingSince}>
      <HarborViewStateProvider value={viewStateApi}>
        <TreeActionsProvider value={treeActions}>
          <TreeLiveStateProvider value={treeLiveState}>
            <div
              ref={inboxRef}
              data-harbor-palette={preferences.palettePreset}
              data-harbor-density={preferences.rowDensity}
              style={harborPreferenceStyle(preferences) as CSSProperties}
              className="flex min-h-0 flex-1 flex-col"
            >
              <InboxChrome
                announcement={reorderAnnouncement || sidebarAnnouncement}
                firstLevel={firstLevel}
                surface={viewState.surface}
                onSurfaceChange={(surface) => patchViewState({ surface })}
                features={{
                  ...treeModel.featureSummary,
                  filter: viewState.featureFilter,
                  onFilterChange: (featureFilter) => patchViewState({ featureFilter }),
                  onCreate: featureSurface.onCreate,
                }}
                pinned={{
                  pinned: orderedPinnedFamilies,
                  reorderEnabled: reorder.pinnedReorderEnabled,
                  reorderDisabledReason: reorder.pinnedReorderDisabledReason,
                  onReorder: pinnedOrder.move,
                }}
                tabs={{
                  items: groupTabs,
                  activeKey: activeScopeKey,
                  panelId: treePanelId,
                  onSelect: (scope) => patchViewState({ scope: groupScopeKey(scope) }),
                  onManage: () => setGroupManagerOpen(true),
                }}
                view={{
                  preferences: viewPreferences,
                  hostCount: treeModel.hostCount,
                  filter: filterPreset,
                  onFilterChange: (filter) => patchViewState({ filter }),
                  groupByRepository: preferences.groupByRepository,
                  onGroupByRepositoryChange: inboxActions.setGroupByRepository,
                  showUnregisteredWorktrees: preferences.showUnregisteredWorktrees,
                  onShowUnregisteredWorktreesChange: inboxActions.setShowUnregisteredWorktrees,
                  onCollapseAll: inboxActions.collapseAll,
                  onReset: inboxActions.resetView,
                }}
                selection={{
                  active: selectionMode,
                  selectedCount: selectedRootIds.size,
                  selectableCount: selectableVisibleRootIds.length,
                  visibleCount: visibleRootCount,
                  busy: bulkDelete.bulkBusy,
                  hintId: selectionHintId,
                  message: bulkDelete.bulkMessage,
                  outcomes: bulkDelete.bulkOutcomes,
                  rootTitleById,
                  onBegin: bulkDelete.beginSelection,
                  onSelectAll: bulkDelete.selectAllVisible,
                  onClear: bulkDelete.clearSelection,
                  onRequestDelete: () => void bulkDelete.previewSelectedDeletion(),
                  onCancel: bulkDelete.cancelSelection,
                }}
              />
              <InboxTreePanel
                panelId={treePanelId}
                surface={viewState.surface}
                activeScopeKey={activeScopeKey}
                notice={{
                  text: viewNotice, source: view.source, status,
                  recovering, error: recoveryError, onRetry: recover,
                  onUseOriginal: () => setShowFlatFallback(true),
                }}
                ordering={{ changedElsewhere: order.changedElsewhere, reload: order.reload }}
                empty={{
                  lifecycleReady: lifecycle.shelvesReady, nothingToShow, searching,
                  filter: filterPreset, projectCount: projects.length,
                }}
                features={{
                  nodes: featureNodes, actions: featureSurface.rowActions,
                  onCreate: featureSurface.onCreate, showWhenEmpty: treeModel.showEmptyFeatures,
                  parked: parkedFeatures, parkedOpen: viewState.parkedFeaturesOpen,
                  onToggleParked: () => patchViewState({ parkedFeaturesOpen: !viewState.parkedFeaturesOpen }),
                  archived: archivedFeatures, onUnpark: featureSurface.onUnpark, onReopen: featureSurface.onReopen,
                }}
                tree={{
                  nodes: treeNodes, groups: groupsApi.groups,
                  organizationMode: viewPreferences.organizationMode,
                  groupAssignment: groupsApi.assignment, assignGroup: inboxActions.assignGroup,
                  seedFromProject: newThread.seedFromProject, seedNewWorktree: newThread.seedNewWorktree,
                  projectColorOverrides, projectIcons, projectReorder,
                }}
                shelves={{
                  shown: showParkedShelves, snoozed, settled, pendingSettled,
                  showSnoozed, showSettled, activeThreadId, lifecycle, navigate: onNavigate,
                  now, settledLimit: settledPaged.visibleCount, settledPageSize: preferences.pageSize,
                  searching, settledPages: settledPaged.page,
                  toggleSnoozed: () => patchViewState({ snoozedOpen: !showSnoozed }),
                  toggleSettled: () => patchViewState({ settledOpen: !showSettled }),
                  loadMoreSettled: settledPaged.nextPage, showLessSettled: settledPaged.showLess,
                }}
              />
              <SegmentedBar<SidebarMode>
                ariaLabel="Organize the sidebar by"
                className="border-t border-sidebar-border/70"
                value={viewPreferences.sidebarMode}
                onChange={viewPreferences.setSidebarMode}
                items={[
                  { value: "threads", label: "Threads", icon: "Layers", title: SIDEBAR_MODE_LABELS.threads },
                  { value: "workspaces", label: "Workspaces", icon: "FolderGit", title: SIDEBAR_MODE_LABELS.workspaces },
                ]}
              />
              <BulkDeleteDialog
                open={bulkDelete.bulkPreview !== null}
                preview={bulkDelete.bulkPreview}
                busy={bulkDelete.bulkBusy}
                onCancel={bulkDelete.closePreview}
                onConfirm={() => void bulkDelete.confirmSelectedDeletion()}
              />
              <GroupManagerDialog
                open={groupManagerOpen}
                groups={groupsApi.groups}
                onClose={() => setGroupManagerOpen(false)}
              />
              <NewThreadDialog
                seed={newThread.seed}
                onClose={newThread.close}
                onCreated={newThread.created}
              />
              <FeatureDialogs
                state={featureDialogs.state}
                api={sources.featuresApi}
                projects={featureSurface.repositoryProjects}
                onClose={featureDialogs.close}
                onCreated={featureSurface.onCreated}
              />
            </div>
          </TreeLiveStateProvider>
        </TreeActionsProvider>
      </HarborViewStateProvider>
    </WorkingSinceContext.Provider>
    </HarborTooltipProvider>
  );
}
