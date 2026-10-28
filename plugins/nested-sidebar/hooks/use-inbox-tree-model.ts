import { useMemo } from "react";

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
import { pendingSettledCount } from "@/lib/settled-threads";
import { selectableRootIds } from "@/lib/thread-management";
import {
  ALL_SCOPE_KEY,
  UNGROUPED_SCOPE_KEY,
  resolveGroupScope,
} from "@/lib/view-state";

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
        unseenWorkspaces,
        mergeRepos: preferences.groupByRepository,
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
      workspaceOwnership,
    ],
  );

  useInboxViewSync({
    activeThreadId,
    treeNodes: viewModel.treeNodes,
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
    ? viewModel.snoozed.length + viewModel.settled.length + pendingSettled
    : 0;
  const searching = searchQuery.trim().length > 0;
  const nothingToShow =
    viewModel.treeNodes.length === 0 && parkedTotal === 0;
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
  const activeScopeKey =
    groupScope.kind === "all"
      ? ALL_SCOPE_KEY
      : groupScope.kind === "ungrouped"
        ? UNGROUPED_SCOPE_KEY
        : groupScope.groupId;

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
    showParkedShelves,
    visibleRootCount,
    visibleRootOrderKey,
  };
}
