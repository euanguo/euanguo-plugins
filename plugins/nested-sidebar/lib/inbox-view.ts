import type {
  PluginSidebarProject,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";

import {
  projectInScope,
  shouldShowUngroupedTab,
  type GroupScope,
  type ProjectGroup,
  type GroupTab,
} from "./groups.ts";
import type { ScopeIcons } from "./group-scope-icons.ts";
import type { ThreadShelf } from "./lifecycle.ts";
import type { ManualOrderMap } from "./manual-order.ts";
import {
  fallbackSectionIcon,
  type OrganizationMode,
  type OrganizationSections,
} from "./organization.ts";
import {
  orderFamilies,
  orderProjectGroups,
} from "./ordering.ts";
import type { PinnedFamily } from "./pinned.ts";
import { splitPinnedFamilies } from "./pinned.ts";
import type { RepoFacts } from "./repo-identity.ts";
import { worstKind } from "./rollup.ts";
import type {
  ProjectSortMode,
  ThreadSortMode,
  WorktreeSortMode,
} from "./sort-modes.ts";
import {
  familyStatus,
} from "./family-status.ts";
import {
  buildProjectGroups,
  searchProjectThreadGroups,
  searchThreadsByTitle,
  sortByCreatedAtDescending,
  visibleInboxThreads,
  type ProjectThreadGroup,
} from "./inbox.ts";
import {
  filterProjectThreadGroups,
  includeSelectedFamilies,
  type ThreadFilterPreset,
} from "./thread-management.ts";
import {
  buildTree,
  searchTree,
  type GroupNode,
} from "./tree.ts";
import type {
  UnseenOwnedWorkspace,
  WorkspaceOwnershipMap,
} from "./workspace-ownership.ts";
import type { WorkspacePaths } from "./workspace.ts";

export interface InboxViewPreferences {
  readonly organizationMode: OrganizationMode;
  readonly projectSort: ProjectSortMode;
  readonly threadSort: ThreadSortMode;
  readonly worktreeSort: WorktreeSortMode;
}

export interface InboxViewInput {
  readonly threads: readonly PluginSidebarThread[];
  readonly projects: readonly PluginSidebarProject[];
  readonly parkedThreadIds: ReadonlySet<string>;
  readonly shelfFor: (thread: PluginSidebarThread) => ThreadShelf;
  readonly wakeAtFor: (thread: PluginSidebarThread) => number | null;
  readonly now: number;
  readonly filterPreset: ThreadFilterPreset;
  readonly searchQuery: string;
  readonly selectedRootIds: ReadonlySet<string>;
  readonly selectionMode: boolean;
  readonly groupScope: GroupScope;
  readonly organization: OrganizationSections;
  readonly organizationIds: ReadonlySet<string>;
  readonly groups: readonly ProjectGroup[];
  readonly groupAssignment: Readonly<Record<string, string>>;
  readonly groupIcons: ScopeIcons;
  readonly viewPreferences: InboxViewPreferences;
  readonly projectOrder: ManualOrderMap;
  readonly familyOrder: ManualOrderMap;
  readonly workspaceOrder: ManualOrderMap;
  readonly paths: WorkspacePaths;
  readonly repoFacts: Pick<RepoFacts, "repoKeyByProject">;
  readonly workspaceOwnership: WorkspaceOwnershipMap | undefined;
  readonly unseenWorkspaces:
    | Readonly<Record<string, readonly UnseenOwnedWorkspace[]>>
    | undefined;
  readonly mergeRepos: boolean;
}

export interface InboxView {
  readonly unfilteredProjectGroups: ProjectThreadGroup[];
  readonly projectGroups: ProjectThreadGroup[];
  readonly snoozed: PluginSidebarThread[];
  readonly settled: PluginSidebarThread[];
  readonly groupTabs: GroupTab[];
  readonly treeNodes: GroupNode[];
  readonly pinnedFamilies: PinnedFamily[];
}

export function buildInboxView(input: InboxViewInput): InboxView {
  const {
    threads,
    projects,
    parkedThreadIds,
    shelfFor,
    wakeAtFor,
    now,
    filterPreset,
    searchQuery,
    selectedRootIds,
    selectionMode,
    groupScope,
    organization,
    organizationIds,
    groups,
    groupAssignment,
    groupIcons,
    viewPreferences,
    projectOrder,
    familyOrder,
    workspaceOrder,
    paths,
    repoFacts,
    workspaceOwnership,
    unseenWorkspaces,
    mergeRepos,
  } = input;

  const visible = visibleInboxThreads(threads, parkedThreadIds);
  const active: PluginSidebarThread[] = [];
  const onSnoozeShelf: PluginSidebarThread[] = [];
  const onSettledShelf: PluginSidebarThread[] = [];

  for (const thread of visible) {
    const shelf = shelfFor(thread);
    if (shelf === "snoozed") onSnoozeShelf.push(thread);
    else if (shelf === "settled") onSettledShelf.push(thread);
    else active.push(thread);
  }

  const unfilteredProjectGroups = orderProjectGroups(
    buildProjectGroups(active, projects, workspaceOwnership),
    {
      assignment: organization.assignment,
      groupOrder: organization.sections.map((section) => section.id),
      manual: projectOrder,
      mode: viewPreferences.projectSort,
      now,
    },
  ).map((group) => ({
    ...group,
    families: orderFamilies(group.families, {
      manual: familyOrder[group.project.id],
      mode: viewPreferences.threadSort,
      now,
    }),
  }));
  const filteredProjectGroups = filterProjectThreadGroups(
    unfilteredProjectGroups,
    filterPreset,
    now,
  );
  const searchedProjectGroups = searchProjectThreadGroups(
    filteredProjectGroups,
    searchQuery,
  );
  const { pinned: pinnedFamilies, rest: unpinnedProjectGroups } =
    splitPinnedFamilies(searchedProjectGroups);
  const scopedProjectGroups = unpinnedProjectGroups.filter((group) =>
    projectInScope(
      groupScope,
      groupAssignment,
      organizationIds,
      group.project.id,
    ),
  );
  const projectGroups = selectionMode
    ? includeSelectedFamilies(
        scopedProjectGroups,
        unfilteredProjectGroups,
        selectedRootIds,
      )
    : scopedProjectGroups;

  const countFor = (scope: GroupScope) =>
    unfilteredProjectGroups.filter((group) =>
      projectInScope(
        scope,
        organization.assignment,
        organizationIds,
        group.project.id,
      ),
    ).length;
  const kindFor = (scope: GroupScope) => {
    const scoped = unfilteredProjectGroups.filter((group) =>
      projectInScope(
        scope,
        organization.assignment,
        organizationIds,
        group.project.id,
      ),
    );
    if (scoped.length === 0) return null;
    const kind = worstKind(
      scoped.flatMap((group) =>
        group.families.map(
          (family) => familyStatus([family.root, ...family.children], now).kind,
        ),
      ),
    );
    return kind === "inactive" || kind === "stale" ? null : kind;
  };
  const groupTabs: GroupTab[] = [
    {
      scope: { kind: "all" },
      label: "All",
      count: countFor({ kind: "all" }),
      icon: groupIcons.all,
      statusKind: kindFor({ kind: "all" }),
    },
    ...organization.sections.map((section) => {
      const scope: GroupScope = { kind: "group", groupId: section.id };
      return {
        scope,
        label: section.name,
        count: countFor(scope),
        icon: section.icon,
        statusKind: kindFor(scope),
      };
    }),
  ];
  const ungroupedScope: GroupScope = { kind: "ungrouped" };
  const ungroupedCount = countFor(ungroupedScope);
  if (
    viewPreferences.organizationMode === "project" &&
    shouldShowUngroupedTab(groups.length, ungroupedCount, projects.length)
  ) {
    groupTabs.push({
      scope: ungroupedScope,
      label: "Ungrouped",
      count: ungroupedCount,
      icon: groupIcons.ungrouped,
      statusKind: kindFor(ungroupedScope),
    });
  }

  const treeNodes = searchTree(
    buildTree({
      projectGroups,
      now,
      assignment: organization.assignment,
      groupOrder: organization.sections,
      ungroupedIcon: fallbackSectionIcon(viewPreferences.organizationMode),
      workspaceOrder,
      worktreeSort: viewPreferences.worktreeSort,
      environments: new Map(Object.entries(paths.environments)),
      projects: new Map(Object.entries(paths.projects)),
      repoKeyByProject: repoFacts.repoKeyByProject,
      workspaceOwnership,
      unseenWorkspaces,
      mergeRepos,
    }),
    searchQuery,
  );

  return {
    unfilteredProjectGroups,
    projectGroups,
    groupTabs,
    treeNodes,
    pinnedFamilies,
    snoozed: searchThreadsByTitle(
      [...onSnoozeShelf].sort(
        (left, right) =>
          (wakeAtFor(left) ?? 0) - (wakeAtFor(right) ?? 0),
      ),
      searchQuery,
    ),
    settled: searchThreadsByTitle(
      sortByCreatedAtDescending(onSettledShelf),
      searchQuery,
    ),
  };
}
