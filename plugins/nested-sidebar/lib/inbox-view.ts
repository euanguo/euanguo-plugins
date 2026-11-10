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
import { rollupThreads, statusSignals, worstKind, type StatusSignal } from "./rollup.ts";
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
import {
  buildFeatureView,
  rollupFeatureFamilies,
  type FeatureNode,
} from "./feature-view.ts";
import type { Feature, FeatureAssignment, FeatureMember } from "./features.ts";
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
  readonly features: readonly Feature[];
  readonly featureAdoptions: FeatureAssignment;
  readonly featureMembers: readonly FeatureMember[];
  /**
   * Projects whose workspaces are feature folders, current root and old ones.
   *
   * Their conversations are the ones the feature view draws. The project view
   * does not draw them: a project whose rows are all somewhere else would be a
   * second entrance to the same work, with a folder name instead of the
   * feature's.
   */
  readonly featureProjectIds?: readonly string[];
  /** Features unchecked in the feature selector, hidden from that view. */
  readonly hiddenFeatureIds?: readonly string[];
}

export interface InboxView {
  readonly unfilteredProjectGroups: ProjectThreadGroup[];
  readonly projectGroups: ProjectThreadGroup[];
  readonly snoozed: PluginSidebarThread[];
  readonly settled: PluginSidebarThread[];
  readonly groupTabs: GroupTab[];
  /**
   * Which first level the caller should draw.
   *
   * The view model answers the question once so the component tree never has
   * to branch on a mode it does not own, and so the tabs it returns are always
   * the tabs for the rows beside them.
   */
  readonly firstLevel: "project" | "feature";
  readonly treeNodes: GroupNode[];
  readonly featureNodes: FeatureNode[];
  /** Finished features in scope, for the shelf at the bottom of the feature view. */
  readonly archivedFeatures: readonly Feature[];
  /**
   * What each view's whole queue is doing, for the dots on the bottom switch.
   *
   * Read before the tab scope, search and status filter: the switch is a
   * navigation hint about the list behind it, not about what is currently
   * filtered out of it.
   */
  readonly projectStatusSignals: readonly StatusSignal[];
  readonly featureStatusSignals: readonly StatusSignal[];
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
    features,
    featureAdoptions,
    featureMembers,
    featureProjectIds = [],
    hiddenFeatureIds = [],
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
  /**
   * The feature view sees every project, including the Features one: a feature's
   * root conversation runs there, and a project view that hid it must not hide
   * the conversation from the view it belongs to.
   */
  const { rest: featureFamilies } = splitPinnedFamilies(searchedProjectGroups);
  const hiddenProjectIds = new Set(featureProjectIds);
  const projectSearchedGroups = searchedProjectGroups.filter(
    (group) => !hiddenProjectIds.has(group.project.id),
  );
  const projectUnfilteredGroups = unfilteredProjectGroups.filter(
    (group) => !hiddenProjectIds.has(group.project.id),
  );
  const { pinned: pinnedFamilies, rest: unpinnedProjectGroups } =
    splitPinnedFamilies(projectSearchedGroups);
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
        projectUnfilteredGroups,
        selectedRootIds,
      )
    : scopedProjectGroups;

  const countFor = (scope: GroupScope) =>
    projectUnfilteredGroups.filter((group) =>
      projectInScope(
        scope,
        organization.assignment,
        organizationIds,
        group.project.id,
      ),
    ).length;
  const kindFor = (scope: GroupScope) => {
    const scoped = projectUnfilteredGroups.filter((group) =>
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

  /**
   * The same families, bucketed by the feature their workspace is in.
   *
   * Taken after filter, search and pinning, from every project, so a root
   * conversation in the Features project is drawn here even though the project
   * view does not draw that project.
   */
  const featureView = buildFeatureView({
    families: featureFamilies.flatMap((group) => group.families),
    features,
    hiddenFeatureIds,
    adoptions: featureAdoptions,
    members: featureMembers,
    showEmpty: filterPreset === "all" && searchQuery.trim().length === 0,
    searchQuery,
    environments: new Map(Object.entries(paths.environments)),
    projects: new Map(Object.entries(paths.projects)),
    projectNames: new Map(projects.map((project) => [project.id, project.name])),
    workspaceOwnership: workspaceOwnership ?? {},
    now,
  });

  /**
   * The signals the bottom switch shows.
   *
   * Project signals come from the projects the project view actually draws —
   * the hidden feature containers are not part of that queue. Feature signals
   * come from every family that resolves to a checked feature, including the
   * root conversations that run in a container project.
   */
  const projectFamilies = projectUnfilteredGroups.flatMap((group) => group.families);
  const allFamilies = unfilteredProjectGroups.flatMap((group) => group.families);
  const projectStatusSignals = statusSignals(
    rollupThreads(
      projectFamilies.flatMap((family) => [family.root, ...family.children]),
      now,
    ),
  );
  const featureStatusSignals = statusSignals(
    rollupFeatureFamilies({
      families: allFamilies,
      features,
      hiddenFeatureIds,
      adoptions: featureAdoptions,
      environments: new Map(Object.entries(paths.environments)),
      projects: new Map(Object.entries(paths.projects)),
      workspaceOwnership: workspaceOwnership ?? {},
      now,
    }),
  );

  const featureFirst = viewPreferences.organizationMode === "feature";

  return {
    firstLevel: featureFirst ? "feature" : "project",
    unfilteredProjectGroups: projectUnfilteredGroups,
    projectGroups,
    /**
     * The feature view has no strip: its first level is the work itself, and
     * there is nothing above it to scope by.
     */
    groupTabs: featureFirst ? [] : groupTabs,
    treeNodes,
    featureNodes: featureView.features,
    archivedFeatures: featureView.archived,
    projectStatusSignals,
    featureStatusSignals,
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
