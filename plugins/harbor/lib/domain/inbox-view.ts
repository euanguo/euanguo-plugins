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
  type FamilyStatusKind,
} from "./family-status.ts";
import {
  buildProjectGroups,
  searchThreadsByTitle,
  sortByCreatedAtDescending,
  threadDisplayTitle,
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
  inActiveFeature,
  ownedFeatureIds,
  rollupFeatureFamilies,
  type FeatureFilterPreset,
  type FeatureNode,
} from "./feature-view.ts";
import type { FeatureMetaSummary } from "./feature-meta.ts";
import {
  sortFeatures,
  type Feature,
  type FeatureAssignment,
  type FeatureMember,
} from "./features.ts";
import {
  ownerProjectIdForThread,
  type UnseenOwnedWorkspace,
  type WorkspaceOwnershipMap,
} from "./workspace-ownership.ts";
import type { WorkspacePaths } from "./workspace.ts";
import type { WorkspaceIndex } from "./workspace-index.ts";
import type { SidebarMode } from "./organization.ts";

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
  readonly groupIcons: ScopeIcons;
  readonly viewPreferences: InboxViewPreferences;
  readonly projectOrder: ManualOrderMap;
  readonly familyOrder: ManualOrderMap;
  readonly workspaceOrder: ManualOrderMap;
  readonly paths: WorkspacePaths;
  readonly repoFacts: Pick<RepoFacts, "repoKeyByProject">;
  readonly workspaceOwnership: WorkspaceOwnershipMap | undefined;
  /**
   * The one workspace derivation, built by the caller.
   *
   * Required: this module no longer builds a second index from `paths`, which
   * meant two constructors drifting apart. Every surface that has an
   * `InboxViewInput` already holds the index it publishes.
   */
  readonly workspaceIndex: WorkspaceIndex;
  readonly sidebarMode: SidebarMode;
  /** Workspace key currently opened in the main viewport. */
  readonly activeWorkspaceKey?: string | null;
  /** Workspace keys with open or draft PRs, always kept in primary tier. */
  readonly openPullRequestWorkspaceKeys?: ReadonlySet<string>;
  /** Optional latest activity override per workspace key. */
  readonly lastActiveByKey?: ReadonlyMap<string, number>;
  /** Which top-level surface is rendered ("features" | "projects"). */
  readonly surface?: "features" | "projects";
  /** Feature status filter applied only when `surface === "features"`. */
  readonly featureFilter?: FeatureFilterPreset;
  /** Uncommitted line counts keyed by environment id, for the Dirty feature filter. */
  readonly workspaceChanges?: ReadonlyMap<
    string,
    { readonly insertions: number; readonly deletions: number }
  >;
  readonly unseenWorkspaces?:
    | Readonly<Record<string, readonly UnseenOwnedWorkspace[]>>
    | undefined;
  readonly mergeRepos: boolean;
  readonly features: readonly Feature[];
  readonly featureAdoptions: FeatureAssignment;
  readonly featureMembers?: readonly FeatureMember[];
  /** featureId -> what the feature has recorded, as counts. */
  readonly featureMeta?: Readonly<Record<string, FeatureMetaSummary>>;
  /**
   * Projects whose workspaces are feature folders, current root and old ones.
   *
   * The Features section draws their conversations. The project rows do not
   * draw them: a project whose rows are all somewhere else would be a second
   * entrance to the same work, with a folder name instead of the feature's.
   */
  readonly featureProjectIds?: readonly string[];
}

export interface InboxView {
  readonly unfilteredProjectGroups: ProjectThreadGroup[];
  readonly projectGroups: ProjectThreadGroup[];
  readonly snoozed: PluginSidebarThread[];
  readonly settled: PluginSidebarThread[];
  readonly groupTabs: GroupTab[];
  /** The two facts the Features switch carries: how many, and how they are doing. */
  readonly featureSummary: {
    readonly count: number;
    readonly statusKind: FamilyStatusKind | null;
  };
  /**
   * Which first level the caller should draw.
   *
   * The view model answers the question once so the component tree never has
   * to branch on a mode it does not own, and so the tabs it returns are always
   * the tabs for the rows beside them.
   */
  readonly firstLevel: "threads" | "workspaces";
  /**
   * Groups, projects and their workspaces, for both modes.
   *
   * The modes draw the same tree and differ only in how far down: Threads opens
   * a workspace onto its conversations, Workspaces stops at the workspace.
   */
  readonly treeNodes: GroupNode[];
  /** Active features in scope, for the Features surface. */
  readonly featureNodes: FeatureNode[];
  /** Parked features awaiting wake conditions or manual restore. */
  readonly parkedFeatures: readonly Feature[];
  /** Finished features, for the shelf at the bottom. */
  readonly archivedFeatures: readonly Feature[];
  /**
   * Pinned root conversations, for the section above the tree.
   *
   * Threads mode on the Projects surface only.
   */
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
    groupIcons,
    viewPreferences,
    projectOrder,
    familyOrder,
    workspaceOrder,
    paths,
    repoFacts,
    workspaceOwnership,
    workspaceIndex,
    mergeRepos,
    features,
    featureMembers = [],
    featureMeta,
    featureProjectIds = [],
    surface = "projects",
    featureFilter = "all",
    workspaceChanges,
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

  const allProjectGroups = orderProjectGroups(
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
  const containerProjectIds = new Set(featureProjectIds);
  const projectUnfilteredGroups = allProjectGroups.filter(
    (group) => !containerProjectIds.has(group.project.id),
  );

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
  const ownedFeatures = ownedFeatureIds(features);
  const featureOrder = sortFeatures(
    features.filter((feature) => ownedFeatures.has(feature.id)),
  ).map((feature) => feature.id);
  const featureWorkspaceKeys = new Set(
    workspaceIndex.list
      .filter((workspace) => inActiveFeature(workspace, ownedFeatures))
      .map((workspace) => workspace.key),
  );
  const featureKind = rollupFeatureFamilies({
    families: allProjectGroups.flatMap((group) => group.families),
    features,
    workspaceIndex,
    now,
  }).kind;
  const featureSummary = {
    count: featureOrder.length,
    statusKind:
      featureKind === "inactive" || featureKind === "stale" ? null : featureKind,
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

  const threadInActiveOrParkedFeature = (thread: PluginSidebarThread): boolean =>
    inActiveFeature(workspaceIndex.workspaceOfThread(thread), ownedFeatures);

  const threadMatchesSurfaceScope = (thread: PluginSidebarThread): boolean => {
    if (surface === "features") {
      return threadInActiveOrParkedFeature(thread);
    }
    if (threadInActiveOrParkedFeature(thread)) return false;
    const projectId = ownerProjectIdForThread(thread, workspaceOwnership);
    if (containerProjectIds.has(projectId)) return false;
    return projectInScope(
      groupScope,
      organization.assignment,
      organizationIds,
      projectId,
    );
  };

  const snoozed = searchThreadsByTitle(
    onSnoozeShelf
      .filter(threadMatchesSurfaceScope)
      .sort((left, right) => (wakeAtFor(left) ?? 0) - (wakeAtFor(right) ?? 0)),
    searchQuery,
  );
  const settled = searchThreadsByTitle(
    sortByCreatedAtDescending(onSettledShelf.filter(threadMatchesSurfaceScope)),
    searchQuery,
  );

  if (surface === "features") {
    const featureView = buildFeatureView({
      families: allProjectGroups.flatMap((group) => group.families),
      features,
      members: featureMembers,
      ...(featureMeta === undefined ? {} : { meta: featureMeta }),
      ...(workspaceChanges === undefined ? {} : { workspaceChanges }),
      filter: featureFilter,
      showEmpty: featureFilter === "all" && searchQuery.trim().length === 0,
      searchQuery,
      projectNames: new Map(
        projects.map((project) => [project.id, project.name]),
      ),
      workspaceIndex,
      now,
    });
    return {
      firstLevel: input.sidebarMode === "workspaces" ? "workspaces" : "threads",
      unfilteredProjectGroups: projectUnfilteredGroups,
      projectGroups: [],
      groupTabs,
      featureSummary,
      treeNodes: [],
      featureNodes: featureView.features,
      parkedFeatures: featureView.parked,
      archivedFeatures: featureView.archived,
      pinnedFamilies: [],
      snoozed,
      settled,
    };
  }

  const filteredGroups = filterProjectThreadGroups(
    allProjectGroups,
    filterPreset,
    now,
  );
  /**
   * Pins come from every project, the feature containers included: a pinned
   * root conversation is the user's own shortcut, wherever it runs.
   */
  const { pinned: rawPinnedFamilies, rest: unpinnedGroups } =
    input.sidebarMode === "threads"
      ? splitPinnedFamilies(filteredGroups)
      : { pinned: [] as PinnedFamily[], rest: filteredGroups };

  const sectionNameById = new Map(
    organization.sections.map((section) => [section.id, section.name]),
  );
  const pinnedFamilies = filterPinnedFamilies(
    rawPinnedFamilies,
    searchQuery,
    organization.assignment,
    sectionNameById,
    workspaceIndex,
  );

  const inScopeUnfilteredGroups = projectUnfilteredGroups.filter((group) =>
    projectInScope(
      groupScope,
      organization.assignment,
      organizationIds,
      group.project.id,
    ),
  );
  const scopedProjectGroups = unpinnedGroups.filter(
    (group) =>
      !containerProjectIds.has(group.project.id) &&
      projectInScope(
        groupScope,
        organization.assignment,
        organizationIds,
        group.project.id,
      ),
  );
  const preSearchProjectGroups = selectionMode
    ? includeSelectedFamilies(
        scopedProjectGroups,
        inScopeUnfilteredGroups,
        selectedRootIds,
      )
    : scopedProjectGroups;

  const builtTree = buildTree({
    projectGroups: preSearchProjectGroups,
    now,
    assignment: organization.assignment,
    groupOrder: organization.sections,
    ungroupedIcon: fallbackSectionIcon(viewPreferences.organizationMode),
    workspaceOrder,
    worktreeSort: viewPreferences.worktreeSort,
    environments: new Map(Object.entries(paths.environments)),
    repoKeyByProject: repoFacts.repoKeyByProject,
    workspaceOwnership,
    workspaceIndex,
    mergeRepos,
    drawnElsewhere: featureWorkspaceKeys,
    featureOrder,
    filterActive: filterPreset !== "all",
    activeWorkspaceKey: input.activeWorkspaceKey ?? null,
    openPullRequestWorkspaceKeys: input.openPullRequestWorkspaceKeys,
    lastActiveByKey: input.lastActiveByKey,
  });

  const preservedSelectionIds = selectionMode
    ? selectedRootIds
    : EMPTY_SELECTION;
  const treeNodes = searchTree(builtTree, searchQuery, preservedSelectionIds);

  const projectGroups =
    searchQuery.trim().length === 0
      ? preSearchProjectGroups
      : projectGroupsMatchingTree(preSearchProjectGroups, treeNodes);

  return {
    firstLevel: input.sidebarMode === "workspaces" ? "workspaces" : "threads",
    unfilteredProjectGroups: projectUnfilteredGroups,
    projectGroups,
    groupTabs,
    featureSummary,
    treeNodes,
    featureNodes: [],
    parkedFeatures: [],
    archivedFeatures: [],
    pinnedFamilies,
    snoozed,
    settled,
  };
}

const EMPTY_SELECTION: ReadonlySet<string> = new Set();

function filterPinnedFamilies(
  pinned: readonly PinnedFamily[],
  searchQuery: string,
  assignment: Readonly<Record<string, string>>,
  sectionNameById: ReadonlyMap<string, string>,
  workspaceIndex: WorkspaceIndex,
): PinnedFamily[] {
  const normalized = searchQuery.trim().toLowerCase();
  if (normalized.length === 0) return [...pinned];
  const matches = (value: string | null | undefined) =>
    typeof value === "string" && value.toLowerCase().includes(normalized);
  return pinned.filter((entry) => {
    if (matches(entry.projectName)) return true;
    const groupId = assignment[entry.projectId];
    const groupName =
      groupId === undefined ? "Ungrouped" : sectionNameById.get(groupId);
    if (matches(groupName)) return true;
    const workspace = workspaceIndex.workspaceOfThread(entry.family.root);
    if (matches(workspace?.label) || matches(workspace?.branch)) return true;
    if (matches(threadDisplayTitle(entry.family.root))) return true;
    return entry.family.children.some((child) =>
      matches(threadDisplayTitle(child)),
    );
  });
}

function projectGroupsMatchingTree(
  projectGroups: readonly ProjectThreadGroup[],
  treeNodes: readonly GroupNode[],
): ProjectThreadGroup[] {
  const survivingProjectIds = new Set(
    treeNodes.flatMap((group) =>
      group.projects.flatMap((project) => project.mergedProjectIds),
    ),
  );
  const treeFamilyByRootId = new Map(
    treeNodes.flatMap((group) =>
      group.projects.flatMap((project) =>
        project.families.map((family) => [family.root.id, family] as const),
      ),
    ),
  );
  return projectGroups.flatMap((group) => {
    if (!survivingProjectIds.has(group.project.id)) return [];
    const families = group.families.flatMap((family) => {
      const kept = treeFamilyByRootId.get(family.root.id);
      return kept === undefined ? [] : [kept];
    });
    return [{ ...group, families }];
  });
}
