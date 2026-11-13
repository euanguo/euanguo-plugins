import { useEffect, useMemo } from "react";

import type { InboxSources } from "@/hooks/use-inbox-sources";
import { useInboxViewSync } from "@/hooks/use-inbox-view-sync";
import { usePinnedOrder } from "@/hooks/use-pinned-order";
import { useProjectArchivedThreads } from "@/hooks/use-project-archived-threads";
import {
  orderPinnedFamilies,
  pinnedRootIds,
} from "@/lib/pinned";
import {
  hostNamesFrom,
  machineSections,
  organizationFor,
} from "@/lib/organization";
import { buildInboxView } from "@/lib/inbox-view";
import { buildWorkspaceIndex } from "@/lib/workspace-index";
import { useWorkspaceChangeCounts } from "@/lib/workspace-change-counts";
import {
  publishSidebarMode,
  publishWorkspaceIndex,
} from "@/lib/workspace-index-store";
import { pendingSettledCount } from "@/lib/settled-threads";
import { selectableRootIds } from "@/lib/thread-management";
import { groupScopeKey } from "@/lib/groups";
import { resolveGroupScope } from "@/lib/view-state";

const ARCHIVED_SHELF_LIMIT = 10;

export function useInboxTreeModel(input: {
  readonly sources: InboxSources;
  readonly activeThreadId: string | null;
  readonly now: number;
  readonly searchQuery: string;
  readonly selectionMode: boolean;
  readonly selectedRootIds: ReadonlySet<string>;
}) {
  const { sources, activeThreadId, now, searchQuery } = input;
  const {
    view,
    projects,
    groupsApi,
    paths,
    repoFacts,
    workspaceOwnership,
    unseenWorkspaces,
    viewState,
    viewStateStore,
    lifecycle,
    order,
    preferences,
    viewPreferences,
    threads,
  } = sources;

  const workspaceIndex = useMemo(
    () =>
      buildWorkspaceIndex({
        environments: paths.environments,
        projects: paths.projects,
        ownership: workspaceOwnership,
        repos: repoFacts.repos,
        unseenWorkspaces,
        features: sources.featuresApi.features,
        adoptions: sources.featuresApi.adoptions,
      }),
    [
      paths.environments,
      paths.projects,
      repoFacts.repos,
      sources.featuresApi.adoptions,
      sources.featuresApi.features,
      unseenWorkspaces,
      workspaceOwnership,
    ],
  );
  // The headers outside this tree read this derivation instead of rebuilding
  // it per pane. Unmounting is what tells them the sidebar is gone, so the
  // clear belongs to the empty-deps cleanup rather than to a value change.
  useEffect(() => {
    publishWorkspaceIndex(workspaceIndex);
    publishSidebarMode(viewPreferences.sidebarMode);
  }, [viewPreferences.sidebarMode, workspaceIndex]);

  useEffect(
    () => () => {
      publishWorkspaceIndex(null);
      publishSidebarMode(null);
    },
    [],
  );

  /**
   * One read of the uncommitted line counts for every workspace row. The
   * header's own read is for its single environment; this one lets a list of
   * rows show `+12 −3` without a request each.
   */
  const environmentIds = useMemo(
    () => [
      ...new Set(workspaceIndex.list.flatMap((workspace) => workspace.environmentIds)),
    ],
    [workspaceIndex],
  );
  // The thread view draws no workspace rows, so it has nothing to show the
  // counts on and asks for none.
  const workspaceChanges = useWorkspaceChangeCounts(
    viewPreferences.sidebarMode === "workspaces" ? environmentIds : [],
  );
  const activeWorkspaceKey = useMemo(() => {
    if (activeThreadId === null) return null;
    const thread = threads.find((candidate) => candidate.id === activeThreadId);
    if (thread === undefined) return null;
    return workspaceIndex.workspaceOfThread(thread)?.key ?? null;
  }, [activeThreadId, threads, workspaceIndex]);

  const machine = useMemo(
    () =>
      machineSections({
        projects,
        paths,
        hostNames: hostNamesFrom(view.threads),
      }),
    [paths, projects, view.threads],
  );
  const organization = useMemo(
    () =>
      organizationFor({
        mode: viewPreferences.organizationMode,
        groupAssignment: groupsApi.assignment,
        groupSections: groupsApi.groups.map((group) => ({
          id: group.id,
          name: group.name,
          icon: group.icon,
        })),
        machine,
      }),
    [
      groupsApi.assignment,
      groupsApi.groups,
      machine,
      viewPreferences.organizationMode,
    ],
  );
  const organizationIds = useMemo(
    () => new Set(organization.sections.map((section) => section.id)),
    [organization.sections],
  );
  const groupScope = useMemo(
    () => resolveGroupScope(viewState.scope, organizationIds),
    [organizationIds, viewState.scope],
  );
  const filterPreset = viewState.filter;
  const viewModel = useMemo(
    () =>
      buildInboxView({
        threads,
        projects,
        parkedThreadIds: lifecycle.parkedThreadIds,
        shelfFor: lifecycle.shelfFor,
        wakeAtFor: lifecycle.wakeAtFor,
        now,
        filterPreset,
        searchQuery,
        selectedRootIds: input.selectedRootIds,
        selectionMode: input.selectionMode,
        groupScope,
        organization,
        organizationIds,
        groups: groupsApi.groups,
        groupAssignment: groupsApi.assignment,
        groupIcons: groupsApi.icons,
        viewPreferences,
        projectOrder: order.projects,
        familyOrder: order.families,
        workspaceOrder: order.workspaces,
        paths,
        repoFacts,
        workspaceOwnership,
        workspaceIndex,
        sidebarMode: viewPreferences.sidebarMode,
        mergeRepos: preferences.groupByRepository,
        features: sources.featuresApi.features,
        featureAdoptions: sources.featuresApi.adoptions,
        featureMembers: sources.featuresApi.members,
        featureMeta: sources.featuresApi.meta,
        featureProjectIds: sources.featuresApi.featureProjectIds,
        hiddenFeatureIds: viewState.hiddenFeatureIds,
      }),
    [
      filterPreset,
      groupScope,
      groupsApi.assignment,
      groupsApi.groups,
      groupsApi.icons,
      lifecycle,
      now,
      order.families,
      order.projects,
      order.workspaces,
      organization,
      organizationIds,
      paths,
      preferences.groupByRepository,
      projects,
      repoFacts,
      searchQuery,
      input.selectedRootIds,
      input.selectionMode,
      threads,
      unseenWorkspaces,
      viewPreferences,
      viewPreferences.sidebarMode,
      workspaceIndex,
      workspaceOwnership,
      sources.featuresApi.features,
      sources.featuresApi.adoptions,
      sources.featuresApi.featureProjectIds,
      sources.featuresApi.members,
      sources.featuresApi.meta,
      viewState.hiddenFeatureIds,
    ],
  );

  useInboxViewSync({
    activeThreadId,
    treeNodes: viewModel.treeNodes,
    featureNodes: viewModel.featureNodes,
    groupTabs: viewModel.groupTabs,
    groupScope,
    groups: groupsApi.groups,
    groupAssignment: groupsApi.assignment,
    patchViewStateWith: viewStateStore.patchWith,
  });

  const pinnedIdsKey = useMemo(
    () => [...pinnedRootIds(viewModel.pinnedFamilies)].sort().join("\u0000"),
    [viewModel.pinnedFamilies],
  );
  const pinnedOrder = usePinnedOrder(pinnedIdsKey);
  const orderedPinnedFamilies = useMemo(
    () => orderPinnedFamilies(viewModel.pinnedFamilies, pinnedOrder.order),
    [pinnedOrder.order, viewModel.pinnedFamilies],
  );
  const archived = useProjectArchivedThreads({
    projectIds: viewState.archivedProjects,
    environments: paths.environments,
    ownership: workspaceOwnership,
    limit: ARCHIVED_SHELF_LIMIT,
  });
  const pendingSettled = useMemo(() => {
    if (
      filterPreset !== "all" ||
      input.selectionMode ||
      !sources.settledRowsPending ||
      searchQuery.trim().length > 0
    ) {
      return 0;
    }
    return pendingSettledCount(
      lifecycle.parkedRows.values(),
      new Set(threads.map((thread) => thread.id)),
      now,
    );
  }, [
    filterPreset,
    input.selectionMode,
    lifecycle.parkedRows,
    now,
    searchQuery,
    sources.settledRowsPending,
    threads,
  ]);
  const showParkedShelves = filterPreset === "all" && !input.selectionMode;
  const parkedTotal = showParkedShelves
    ? viewModel.snoozed.length +
      viewModel.settled.length +
      pendingSettled +
      viewModel.archivedFeatures.length
    : 0;
  const searching = searchQuery.trim().length > 0;
  /**
   * The Features tab always has something to draw: its header is where the
   * first feature is made.
   */
  const nothingToShow =
    groupScope.kind !== "features" &&
    viewModel.treeNodes.length === 0 &&
    viewModel.featureNodes.length === 0 &&
    parkedTotal === 0;
  /** All and Features draw the section's header even empty: it is where a feature starts. */
  const showEmptyFeatures =
    (groupScope.kind === "all" || groupScope.kind === "features") &&
    !searching &&
    filterPreset === "all";
  const selectableVisibleRootIds = useMemo(
    () => selectableRootIds(viewModel.projectGroups, activeThreadId),
    [activeThreadId, viewModel.projectGroups],
  );
  const visibleRootCount = viewModel.projectGroups.reduce(
    (total, group) => total + group.families.length,
    0,
  );
  const visibleRootOrderKey = viewModel.projectGroups
    .flatMap((group) => group.families.map((family) => family.root.id))
    .join("\u001f");
  const rootTitleById = useMemo(
    () =>
      new Map(
        viewModel.unfilteredProjectGroups.flatMap((group) =>
          group.families.map((family) => [
            family.root.id,
            family.root.title?.trim() ||
              family.root.titleFallback?.trim() ||
              "Untitled thread",
          ] as const),
        ),
      ),
    [viewModel.unfilteredProjectGroups],
  );
  const activeScopeKey = groupScopeKey(groupScope);

  const reorderPinnedByKeyboard = (rootId: string, direction: -1 | 1) => {
    const ids = pinnedRootIds(orderedPinnedFamilies);
    const index = ids.indexOf(rootId);
    if (index < 0) return;
    const targetId = ids[index + direction];
    if (targetId === undefined) return;
    pinnedOrder.move({
      sourceId: rootId,
      targetId,
      position: direction === -1 ? "before" : "after",
    });
  };

  return {
    ...viewModel,
    activeScopeKey,
    activeWorkspaceKey,
    workspaceChanges,
    workspaceIndex,
    archived,
    filterPreset,
    groupScope,
    nothingToShow,
    orderedPinnedFamilies,
    pendingSettled,
    pinnedOrder,
    reorderPinnedByKeyboard,
    rootTitleById,
    searching,
    selectableVisibleRootIds,
    showEmptyFeatures,
    showParkedShelves,
    visibleRootCount,
    visibleRootOrderKey,
  };
}
