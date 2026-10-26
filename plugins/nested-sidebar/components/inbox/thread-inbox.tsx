import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  experimental_useProviders as useProviders,
  useRpc,
  useSettings,
  type PluginSidebarThread,
  type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { useThreadActions } from "@/hooks/use-thread-actions";
import { useInboxViewState } from "@/hooks/use-inbox-view-state";
import { useNewThread } from "@/hooks/use-new-thread";
import { useReorder } from "@/hooks/use-reorder";
import type { nestRpcContract } from "@/server";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { GroupSection } from "@/components/inbox/group-section";
import type { ProviderGlyphInfo } from "@/components/inbox/provider-glyph";
import { SlimRow } from "@/components/inbox/slim-row";
import { PageControls } from "@/components/inbox/page-controls";
import { ViewMenu } from "@/components/inbox/view-menu";
import {
  BulkDeleteDialog,
  type BulkDeletePreviewView,
} from "@/components/inbox/bulk-delete-dialog";
import { useLifecycle } from "@/hooks/use-lifecycle";
import { useThreadView } from "@/hooks/use-thread-view";
import { useProjectArchivedThreads } from "@/hooks/use-project-archived-threads";
import { usePinnedOrder } from "@/hooks/use-pinned-order";
import {
  orderPinnedFamilies,
  pinnedRootIds,
  splitPinnedFamilies,
} from "@/lib/pinned";
import {
  DEFAULT_ORGANIZATION_MODE,
  fallbackSectionIcon,
  hostNamesFrom,
  machineSections,
  organizationFor,
} from "@/lib/organization";
import { PinnedSection } from "@/components/inbox/pinned-section";
import { resolveSnoozePresets } from "@/lib/lifecycle";
import {
  forgetNestActions,
  publishNestActions,
  type PublishedNestActions,
} from "@/lib/palette-bridge";
import {
  OrderChangedNotice,
  ThreadLoadFailure,
  ThreadViewNotice,
} from "@/components/inbox/thread-view-status";
import { threadViewNotice } from "@/lib/thread-snapshot";
import { useListAutoAnimate } from "@/hooks/use-list-auto-animate";
import {
  useWorkingSince,
  WorkingSinceContext,
} from "@/hooks/use-working-since";
import { useSettledThreads } from "@/hooks/use-settled-threads";
import { useProjectColors } from "@/hooks/use-project-colors";
import { useProjectIcons } from "@/hooks/use-project-icons";
import { useSidebarScrollOwner } from "@/hooks/use-sidebar-scroll-owner";
import {
  mergeSettledThreads,
  pendingSettledCount,
} from "@/lib/settled-threads";
import {
  hasMoreRows,
  nextPageSize,
  visibleRows,
} from "@/lib/paging";
import { TRAILING_GLYPH_BOX_CLASS } from "@/components/inbox/status-slot";
import {
  buildProjectGroups,
  searchProjectThreadGroups,
  searchThreadsByTitle,
  sortByCreatedAtDescending,
  threadDisplayTitle,
  visibleInboxThreads,
} from "@/lib/inbox";
import { familyStatus } from "@/lib/family-status";
import { worstKind } from "@/lib/rollup";
import {
  applyRootSelection,
  filterProjectThreadGroups,
  includeSelectedFamilies,
  pruneSelectedRootIds,
  selectableRootIds,
  type RootSelectionIntent,
} from "@/lib/thread-management";
import {
  nestPreferenceStyle,
  resolveNestPreferences,
} from "@/lib/preferences";
import {
  keyboardFamilyMove,
  moveProjectFamily,
  type FamilyMoveResult,
} from "@/lib/family-order";
import {
  keyboardProjectMove,
  moveProject,
  type ProjectMoveResult,
} from "@/lib/project-order";
import {
  orderFamilies,
  orderProjectGroups,
  orderedProjectIds,
  projectOrderScope,
} from "@/lib/ordering";
import { useNestOrder } from "@/hooks/use-nest-order";
import { useViewPreferences } from "@/hooks/use-view-preferences";
import { GroupTabs, type GroupTab } from "@/components/inbox/group-tabs";
import {
  NestViewStateProvider,
  type NestViewStateApi,
} from "@/components/inbox/view-state-context";
import {
  ALL_SCOPE_KEY,
  UNGROUPED_SCOPE_KEY,
  readViewState,
  resolveGroupScope,
  withId,
  foldWorkspaceExpansion,
  writeViewState,
  type NestViewState,
} from "@/lib/view-state";
import {
  announceToSidebar,
  SIDEBAR_ANNOUNCEMENT_EVENT,
} from "@/lib/clipboard";

import { GroupManagerDialog } from "@/components/inbox/group-manager-dialog";
import {
  NewThreadDialog,
  type NewThreadSeed,
} from "@/components/inbox/new-thread-dialog";
import { useGroups } from "@/hooks/use-groups";
import { useAppearance } from "@/hooks/use-appearance";
import { useWorkspacePaths } from "@/hooks/use-workspace-paths";
import { useRepoFacts } from "@/hooks/use-repo-facts";
import {
  groupScopeKey,
  projectInScope,
  shouldShowUngroupedTab,
  type GroupScope,
} from "@/lib/groups";
import {
  buildTree,
  projectWorkspaceRefs,
  searchTree,
  threadAncestors,
} from "@/lib/tree";
import {
  keyboardWorkspaceMove,
  moveProjectWorkspace,
  orderWorkspaces,
  type WorkspaceMoveResult,
} from "@/lib/workspace-order";
import type { WorkspaceLaunch, TreeRowHandlers } from "@/components/inbox/tree-rows";

const EMPTY_STATE_CLASS = "px-2 py-6 text-center text-xs text-muted-foreground";

/**
 * How long a freshly spawned thread is awaited in the sidebar's own view before
 * the plugin stops trying to open it. Long enough for a create to round-trip
 * through the host's cache, short enough that a thread this client will never
 * be handed does not sit pending for the rest of the session.
 */
const PENDING_OPEN_TIMEOUT_MS = 15_000;

/**
 * How many archived threads one project's shelf shows.
 *
 * Deliberately not a setting. A shelf is for recognising a thread you remember,
 * not for browsing the archive — bb has its own archived view for that — and a
 * number the user has to choose would make the surface look like a second
 * archive rather than a way back to one thread.
 */
const ARCHIVED_SHELF_LIMIT = 10;

/**
 * The tree's scroll area — and the same box bb's own list is drawn in.
 *
 * One constant rather than two literals, because the reserved scrollbar lane and
 * the horizontal clip are the contract this sidebar documents, and bb's own list
 * inside a box that lacked them would reintroduce the sideways jump the contract
 * exists to stop. The host draws its own list in exactly this box when a plugin
 * is not the provider, so the two occupants are the same surface.
 */
const TREE_SCROLL_CLASS =
  "min-h-0 flex-1 overflow-y-auto overflow-x-clip pl-1.5 pr-0.5 pb-2 [scrollbar-gutter:stable]";

/**
 * A project-first inbox. Project sections stay put; roots keep their creation
 * order; active root/child families expand in place instead of jumping around.
 */
export function ThreadInbox({
  activeThreadId,
  onNavigate,
  searchQuery,
}: PluginThreadListProps) {
  /**
   * The rows to draw, which is not the same thing as the host's state.
   *
   * `useThreadView` keeps the last good answer so a failed refresh leaves the
   * tree standing rather than blanking it, and can read the live view from bb's
   * own SDK when there is nothing left to fall back on. `status` is the host's
   * state as-is, which the render still needs to tell a first load, which draws
   * nothing, apart from a cold failure, which draws the retry.
   */
  const { view, status, recovering, recoveryError, recover } = useThreadView();
  const hostThreads = view.threads;
  const projects = view.projects;
  /** The one line a degraded view owes the user, or null when it owes none. */
  const viewNotice = threadViewNotice(view.source);
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
  /**
   * Which repository each workspace is really in.
   *
   * Read whether or not the grouping is on, because the row's own badge and the
   * diagnostics panel both want it — and because a preference the user just
   * turned on should not have to wait for a probe to take effect.
   */
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
  /**
   * The remembered view, read once at mount and written on every change.
   *
   * bb restores the route but nothing about the tree's shape, so without this
   * a reload drops the user back on "All" with everything expanded. The whole
   * record is one object on purpose: a single write keeps the scope, the
   * filter, and every collapsed id consistent, so a crash between two writes
   * cannot leave a filter from one session over a scope from another.
   */
  const viewStateStore = useInboxViewState();
  const viewState = viewStateStore.state;
  const patchViewState = viewStateStore.patch;
  const patchViewStateWith = viewStateStore.patchWith;
  const [groupManagerOpen, setGroupManagerOpen] = useState(false);
  /** The group a tab's pencil asked to rename, when the strip is the entry. */
  const sidebarActions = useThreadActions();
  const inboxRef = useRef<HTMLDivElement>(null);
  useSidebarScrollOwner(inboxRef);
  const selectionAnchorRootId = useRef<string | null>(null);
  /** The thread whose ancestors have already been opened for this session. */
  const revealedThreadRef = useRef<string | null>(null);
  const selectionHintId = useId();
  /** Ties the scope strip's tabs to the tree they narrow. */
  const treePanelId = useId();
  const [nowMinute, setNowMinute] = useState(() =>
    Math.floor(Date.now() / 60_000),
  );
  useEffect(() => {
    const timer = setInterval(
      () => setNowMinute(Math.floor(Date.now() / 60_000)),
      60_000,
    );
    return () => clearInterval(timer);
  }, []);
  const now = nowMinute * 60_000;
  const attachTreeAutoAnimateRef = useListAutoAnimate<HTMLDivElement>();
  /**
   * How many pages of settled rows the shelf draws. Counted in pages rather
   * than rows so changing the page size in Settings re-scales what is already
   * on screen, instead of leaving a limit that now means something else.
   *
   * Only settled pages: the shelf is where a day's settles pile up, while a
   * snooze is a timer the user set and expects to see the end of.
   */
  const [settledPages, setSettledPages] = useState(1);
  const settledLimit = settledPages * preferences.pageSize;

  // Settling archives a thread in bb, so the host list alone cannot draw the
  // settled shelf. Merge the plugin's bounded archived read back in first.
  const { threads: settledThreads, rowsPending: settledRowsPending } =
    useSettledThreads(now);
  const threads = useMemo(
    () => mergeSettledThreads(hostThreads, settledThreads),
    [hostThreads, settledThreads],
  );
  /**
   * Fed the merged list rather than the drawn one: a filter or a search must
   * not be able to clear a stamp, because the thread work continues either way.
   */
  const workingSince = useWorkingSince(threads);
  /**
   * Where a new thread starts, and what happens once it exists.
   *
   * The seed and the pending-open wait are one subject: a `+` produces a thread
   * this sidebar cannot see yet, so the two ends of that round trip belong
   * together rather than split across the component.
   */
  const newThread = useNewThread({
    paths,
    hostThreads,
    openThread: sidebarActions.open,
    onNavigate,
  });
  const newThreadSeed = newThread.seed;
  const setNewThreadSeed = newThread.close;
  const seedFromProject = newThread.seedFromProject;
  const seedNewWorktree = newThread.seedNewWorktree;
  const seedFromWorkspace = newThread.seedFromWorkspace;
  const lifecycle = useLifecycle(threads);
  const showSnoozed = viewState.snoozedOpen;
  const showSettled = viewState.settledOpen;
  const filterPreset = viewState.filter;
  const [selectionMode, setSelectionMode] = useState(false);
  /**
   * The manual arrangement and the sort lenses, both server-backed. The
   * arrangement is the user's own data; the lenses decide whether it is read.
   */
  const order = useNestOrder();
  const viewPreferences = useViewPreferences();

  /**
   * The machine every project's checkout lives on, and what each machine is
   * called. The names come from the threads this client holds, because that is
   * the only place a host's name is resolved for a plugin.
   */
  const machine = useMemo(
    () =>
      machineSections({
        projects,
        paths,
        hostNames: hostNamesFrom(view.threads),
      }),
    [projects, paths, view.threads],
  );

  /**
   * What the tree's first level is, for the mode in force.
   *
   * The group mode's answer is the user's own groups; the machine mode's is
   * derived. Both are "an id, a name, and an icon" — which is why the tree
   * builder below needs no branch for either.
   */
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
      viewPreferences.organizationMode,
      groupsApi.assignment,
      groupsApi.groups,
      machine,
    ],
  );

  /**
   * The scope strip's ids, which follow the organization rather than the groups:
   * a strip listing groups while the tree draws machines would be a control that
   * points at nothing.
   *
   * Resolving the stored scope against these is also what makes a mode change
   * safe. A group id is not a machine id, so a scope left on a group degrades to
   * All the moment the tree stops drawing groups.
   */
  const organizationIds = useMemo(
    () => new Set(organization.sections.map((section) => section.id)),
    [organization.sections],
  );
  const groupScope: GroupScope = useMemo(
    () => resolveGroupScope(viewState.scope, organizationIds),
    [organizationIds, viewState.scope],
  );
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
  const [bulkPreview, setBulkPreview] =
    useState<BulkDeletePreviewView | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [bulkOutcomes, setBulkOutcomes] = useState<
    Array<{ id: string; message: string; failed: boolean }>
  >([]);

  /**
   * What the palette's rows reach when they run.
   *
   * Written during render, like the retained thread view, and for the same
   * reason: the dispatcher below is published once and reads through this, so it
   * never needs replacing. Republishing on every render would work but is worse —
   * React runs a cleanup before the next effect, so the slot would blink to null
   * on every render, and the palette's `isAvailable` runs while the palette is
   * open, which is exactly when a blink would hide a row.
   */
  const paletteRef = useRef({ lifecycle, threads, patchViewState });
  paletteRef.current = { lifecycle, threads, patchViewState };

  useEffect(() => {
    /**
     * A thread the list is not drawing cannot be parked from here: the park rules
     * read fields only the drawn rows carry, so a hidden or archived id has no
     * answer to give.
     */
    const canParkFromPalette = (threadId: string): boolean => {
      const { lifecycle: current, threads: currentThreads } =
        paletteRef.current;
      const thread = currentThreads.find(
        (candidate) => candidate.id === threadId,
      );
      return thread !== undefined && current.canPark(thread);
    };

    const actions: PublishedNestActions = {
      settle(threadId) {
        if (!canParkFromPalette(threadId)) return;
        paletteRef.current.lifecycle.settle(threadId);
      },
      snoozeUntilTomorrow(threadId) {
        if (!canParkFromPalette(threadId)) return;
        // The same preset the row's own hover button uses: tomorrow at 09:00.
        const tomorrow = resolveSnoozePresets(new Date()).find(
          (preset) => preset.id === "tomorrow",
        );
        if (tomorrow === undefined) return;
        paletteRef.current.lifecycle.snooze(threadId, tomorrow.snoozedUntil);
      },
      wake(threadId) {
        const row = paletteRef.current.lifecycle.parkedRows.get(threadId);
        if (row === undefined) return;
        // Whichever shelf it is on. A row is on one or the other, never both,
        // so the order here is a reading order rather than a precedence.
        if (row.snoozedUntil !== null) {
          paletteRef.current.lifecycle.unsnooze(threadId);
        } else if (row.settledAt !== null) {
          paletteRef.current.lifecycle.unsettle(threadId);
        }
      },
      canPark: canParkFromPalette,
      isParked(threadId) {
        const row = paletteRef.current.lifecycle.parkedRows.get(threadId);
        return (
          row !== undefined &&
          (row.snoozedUntil !== null || row.settledAt !== null)
        );
      },
      showNeedsYou() {
        paletteRef.current.patchViewState({ filter: "needs-you" });
      },
    };
    publishNestActions(actions);
    return () => forgetNestActions(actions);
    // Published once on purpose; every verb reads the latest values through
    // `paletteRef`. See the note above it.
    // oxlint-disable-next-line react/exhaustive-deps
  }, []);

  const viewStateApi: NestViewStateApi = viewStateStore.api;

  /** The scope key the strip highlights, derived back from the resolved scope. */
  const activeScopeKey =
    groupScope.kind === "all"
      ? ALL_SCOPE_KEY
      : groupScope.kind === "ungrouped"
        ? UNGROUPED_SCOPE_KEY
        : groupScope.groupId;

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

  const {
    unfilteredProjectGroups,
    projectGroups,
    snoozed,
    settled,
    groupTabs,
    treeNodes,
    pinnedFamilies,
  } = useMemo(() => {
    const visible = visibleInboxThreads(threads, lifecycle.parkedThreadIds);
    const active: PluginSidebarThread[] = [];
    const onSnoozeShelf: PluginSidebarThread[] = [];
    const onSettledShelf: PluginSidebarThread[] = [];

    for (const thread of visible) {
      const shelf = lifecycle.shelfFor(thread);
      if (shelf === "snoozed") onSnoozeShelf.push(thread);
      else if (shelf === "settled") onSettledShelf.push(thread);
      else active.push(thread);
    }

    // Projects are ordered per section, then each project's families by the
    // thread lens. Both run before filtering and search, so a hidden row never
    // moves and the visible order is always a slice of the complete one.
    //
    // The section is the organization's, not the groups': the arrangement is
    // bucketed by whatever the tree's first level is, so in machine mode a
    // project sorts inside its machine rather than inside a group the tree is
    // not drawing.
    const unfilteredProjectGroups = orderProjectGroups(
      buildProjectGroups(active, projects, workspaceOwnership),
      {
        assignment: organization.assignment,
        groupOrder: organization.sections.map((section) => section.id),
        manual: order.projects,
        mode: viewPreferences.projectSort,
        now,
      },
    ).map((group) => ({
      ...group,
      families: orderFamilies(group.families, {
        manual: order.families[group.project.id],
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
    /*
     * Pinned roots leave the tree and go to their own section.
     *
     * Taken after search and the filter, so a pinned row obeys both — and before
     * the group scope, which it deliberately ignores: a pin that vanishes because
     * the user is looking at another group is the failure the section exists to
     * fix. Bulk selection is not a concern here, because a pinned thread is never
     * bulk-eligible in the first place.
     */
    const { pinned: pinnedFamilies, rest: unpinnedProjectGroups } =
      splitPinnedFamilies(searchedProjectGroups);
    const scopedProjectGroups = unpinnedProjectGroups.filter((group) =>
      projectInScope(
        groupScope,
        groupsApi.assignment,
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

    // The group strip counts every project in a group, not just the ones that
    // survived search, so the numbers do not shift while the user types.
    const countFor = (scope: GroupScope) =>
      unfilteredProjectGroups.filter((group) =>
        projectInScope(scope, organization.assignment, organizationIds, group.project.id),
      ).length;
    // Each tab shows the worst state anywhere beneath it, folded from the same
    // rollups the tree rows use, so the strip and the tree never disagree about
    // whether a scope has anything running.
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
          group.families.map((family) =>
            familyStatus([family.root, ...family.children], now).kind,
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
        icon: groupsApi.icons.all,
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
    // "Ungrouped" is a real destination, but only once groups exist and only
    // while something is in it. A project filed out of its last group brings
    // the tab straight back.
    //
    // There is no equivalent in machine mode: a project whose machine bb does
    // not know lands in a *named* section of its own, rather than in a bucket
    // called "ungrouped" that would say nothing about why it is there.
    const ungroupedScope: GroupScope = { kind: "ungrouped" };
    const ungroupedCount = countFor(ungroupedScope);
    if (
      viewPreferences.organizationMode === "project" &&
      shouldShowUngroupedTab(
        groupsApi.groups.length,
        ungroupedCount,
        projects.length,
      )
    ) {
      groupTabs.push({
        scope: ungroupedScope,
        label: "Ungrouped",
        count: ungroupedCount,
        icon: groupsApi.icons.ungrouped,
        statusKind: kindFor(ungroupedScope),
      });
    }

    // The tree is built from the filtered projects, then flat-searched once
    // more so a hit three levels down keeps its ancestors and hides the
    // branches it does not touch.
    //
    // `mergeRepos` is the whole of "group by repository": the keying changes
    // and nothing else, so a merged row is the row the leading project already
    // occupied, with the others' families and workspaces on it.
    const treeNodes = searchTree(
      buildTree({
        projectGroups,
        now,
        assignment: organization.assignment,
        groupOrder: organization.sections,
        ungroupedIcon: fallbackSectionIcon(viewPreferences.organizationMode),
        workspaceOrder: order.workspaces,
        worktreeSort: viewPreferences.worktreeSort,
        environments: new Map(Object.entries(paths.environments)),
        projects: new Map(Object.entries(paths.projects)),
        repoKeyByProject: repoFacts.repoKeyByProject,
        workspaceOwnership,
        unseenWorkspaces,
        mergeRepos: preferences.groupByRepository,
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
            (lifecycle.wakeAtFor(left) ?? 0) -
            (lifecycle.wakeAtFor(right) ?? 0),
        ),
        searchQuery,
      ),
      settled: searchThreadsByTitle(
        sortByCreatedAtDescending(onSettledShelf),
        searchQuery,
      ),
    };
  }, [
    filterPreset,
    groupScope,
    groupsApi.assignment,
    groupsApi.groups,
    lifecycle,
    now,
    order.families,
    order.projects,
    organization,
    organizationIds,
    // Both reads feed `buildTree` above and neither was in this list: the tree
    // was built from the paths of the frame before the read landed and stayed
    // that way until something else moved.
    paths,
    preferences.groupByRepository,
    projects,
    repoFacts,
    searchQuery,
    selectedRootIds,
    selectionMode,
    viewPreferences.organizationMode,
    viewPreferences.projectSort,
    viewPreferences.threadSort,
    viewPreferences.worktreeSort,
    unseenWorkspaces,
    workspaceOwnership,
    threads,
  ]);

  /**
   * The pinned section's rows, in bb's own pin order.
   *
   * The read is keyed on the *set* of pinned roots rather than on their order: a
   * reorder writes bb's order and then re-reads, and a key that changed on every
   * reorder would leave those two reads racing each other.
   */
  const pinnedIdsKey = useMemo(
    () => [...pinnedRootIds(pinnedFamilies)].sort().join("\u0000"),
    [pinnedFamilies],
  );
  const pinnedOrder = usePinnedOrder(pinnedIdsKey);
  const orderedPinnedFamilies = useMemo(
    () => orderPinnedFamilies(pinnedFamilies, pinnedOrder.order),
    [pinnedFamilies, pinnedOrder.order],
  );

  /**
   * The archived shelf, read only for the projects whose shelf is on.
   *
   * One read for the whole list rather than one per project row: a subscription
   * per row would re-read every open project's archive on every lifecycle
   * publish, which is exactly the read amplification the realtime coalescing
   * exists to avoid.
   */
  const archived = useProjectArchivedThreads({
    projectIds: viewState.archivedProjects,
    environments: paths.environments,
    ownership: workspaceOwnership,
    limit: ARCHIVED_SHELF_LIMIT,
  });

  /**
   * One press, one position.
   *
   * The neighbour is the row the move lands against, so a move up places before
   * it and a move down places after it. The other way round would make one of the
   * two keys look like it did nothing.
   */
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

  /**
   * Ungrouped leaves the strip when nothing is in it, so a selection sitting on
   * it would point at a tab that is not drawn and scope the tree to a list that
   * can only be empty.
   *
   * The selection is cleared rather than resolved away on every read, for the
   * same reason `resolveGroupScope` degrades a deleted group instead of
   * remembering it: filing a project back out of a group should not silently
   * re-select Ungrouped later.
   */
  const ungroupedTabVisible = groupTabs.some(
    (tab) => tab.scope.kind === "ungrouped",
  );
  useEffect(() => {
    if (groupScope.kind !== "ungrouped") return;
    if (ungroupedTabVisible) return;
    patchViewStateWith((current) =>
      current.scope === UNGROUPED_SCOPE_KEY
        ? { ...current, scope: ALL_SCOPE_KEY }
        : current,
    );
  }, [groupScope.kind, ungroupedTabVisible, patchViewStateWith]);

  /**
   * Put the user back where they were.
   *
   * bb restores the route, so the open thread is known before this list draws.
   * If that thread sits inside a collapsed group, project, workspace, or family
   * — or under a scope tab that excludes it — the restored route would point at
   * a row the user cannot see. Opening the path back to it is what turns a
   * restored URL into a restored place.
   *
   * The update is idempotent: once every ancestor is open and the scope
   * contains the thread, the functional update returns the same object and
   * React skips the re-render, so this cannot loop against the tree it just
   * changed.
   */
  useEffect(() => {
    if (activeThreadId === null) return;
    // Only when the open thread actually changes. Re-running on every tree
    // change would immediately undo a collapse the user just made on the row
    // they are working in, which is the opposite of remembering their view.
    if (revealedThreadRef.current === activeThreadId) return;
    revealedThreadRef.current = activeThreadId;
    const ancestors = threadAncestors(treeNodes, activeThreadId);
    if (ancestors === null) {
      // The thread is not on screen yet — the host list is still loading, or
      // the thread is filtered out. Leave the marker unset so the reveal runs
      // again once the tree can answer.
      revealedThreadRef.current = null;
      return;
    }
    const groupKey = ancestors.groupId ?? UNGROUPED_SCOPE_KEY;
    patchViewStateWith((current) => {
      const validGroupIds = new Set(groupsApi.groups.map((group) => group.id));
      const scoped = projectInScope(
        resolveGroupScope(current.scope, validGroupIds),
        groupsApi.assignment,
        validGroupIds,
        ancestors.projectId,
      );
      const collapsedGroups = current.collapsedGroups.filter(
        (id) => id !== groupKey,
      );
      const collapsedProjects = current.collapsedProjects.filter(
        (id) => id !== ancestors.projectId,
      );
      const expandedWorkspaces = current.expandedWorkspaces.includes(
        ancestors.workspaceKey,
      )
        ? current.expandedWorkspaces
        : [...current.expandedWorkspaces, ancestors.workspaceKey];
      const collapsedFamilies = current.collapsedFamilies.filter(
        (id) => id !== ancestors.rootId,
      );
      const scope = scoped ? current.scope : groupKey;
      if (
        scope === current.scope &&
        collapsedGroups.length === current.collapsedGroups.length &&
        collapsedProjects.length === current.collapsedProjects.length &&
        expandedWorkspaces.length === current.expandedWorkspaces.length &&
        collapsedFamilies.length === current.collapsedFamilies.length
      ) {
        return current;
      }
      const next = {
        ...current,
        scope,
        collapsedGroups,
        collapsedProjects,
        expandedWorkspaces,
        collapsedFamilies,
      };
      writeViewState(next);
      return next;
    });
  }, [activeThreadId, groupsApi.assignment, groupsApi.groups, treeNodes]);

  useEffect(() => {
    setSelectedRootIds((current) => {
      const next = pruneSelectedRootIds(current, unfilteredProjectGroups);
      return setsEqual(current, next) ? current : next;
    });
  }, [unfilteredProjectGroups]);

  // Lifecycle rows can arrive before the archived thread DTOs they name. Keep
  // the collapsed Settled count truthful during that one round trip.
  const pendingSettled = useMemo(() => {
    if (
      filterPreset !== "all" ||
      selectionMode ||
      !settledRowsPending ||
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
    lifecycle.parkedRows,
    filterPreset,
    now,
    searchQuery,
    selectionMode,
    settledRowsPending,
    threads,
  ]);

  const showParkedShelves = filterPreset === "all" && !selectionMode;
  const parkedTotal = showParkedShelves
    ? snoozed.length + settled.length + pendingSettled
    : 0;
  const searching = searchQuery.trim().length > 0;
  /**
   * Nothing to draw: no project survived the scope, the filter, and the search,
   * and nothing is parked under the tree either. This counts rows rather than
   * threads on purpose — a sidebar whose projects have no threads yet still has
   * something to show.
   */
  const nothingToShow = treeNodes.length === 0 && parkedTotal === 0;
  /**
   * Reordering needs the complete, unfiltered, unsearched list — otherwise a
   * hidden row would move implicitly — and it needs the mode that reads the
   * manual order. A time or name sort has no place to drop a dragged row.
   */
  const selectableVisibleRootIds = useMemo(
    () => selectableRootIds(projectGroups, activeThreadId),
    [activeThreadId, projectGroups],
  );
  const visibleRootCount = projectGroups.reduce(
    (total, group) => total + group.families.length,
    0,
  );
  const visibleRootOrderKey = projectGroups
    .flatMap((group) => group.families.map((family) => family.root.id))
    .join("\u001f");
  const rootTitleById = useMemo(
    () =>
      new Map(
        unfilteredProjectGroups.flatMap((group) =>
          group.families.map((family) => [
            family.root.id,
            family.root.title?.trim() ||
              family.root.titleFallback?.trim() ||
              "Untitled thread",
          ] as const),
        ),
      ),
    [unfilteredProjectGroups],
  );

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

  useEffect(() => {
    selectionAnchorRootId.current = null;
  }, [filterPreset, searchQuery, selectionMode, visibleRootOrderKey]);

  const changeSelectedRoot = (
    threadId: string,
    intent: RootSelectionIntent,
  ) => {
    setBulkMessage(null);
    setBulkOutcomes([]);
    const update = applyRootSelection({
      selectedRootIds,
      visibleEligibleRootIds: renderedSelectableRootIds(inboxRef.current),
      anchorRootId: selectionAnchorRootId.current,
      targetRootId: threadId,
      targetSelected: intent.selected,
      shiftKey: intent.shiftKey,
    });
    selectionAnchorRootId.current = update.anchorRootId;
    setSelectedRootIds(update.selectedRootIds);
  };

  const selectAllVisible = () => {
    selectionAnchorRootId.current = null;
    setBulkMessage(null);
    setBulkOutcomes([]);
    setSelectedRootIds((current) =>
      new Set([...current, ...selectableVisibleRootIds]),
    );
  };

  const cancelSelection = () => {
    selectionAnchorRootId.current = null;
    setSelectedRootIds(new Set());
    setSelectionMode(false);
    setBulkPreview(null);
    setBulkMessage(null);
    setBulkOutcomes([]);
  };

  const previewSelectedDeletion = async () => {
    if (selectedRootIds.size === 0 || bulkBusy) return;
    setBulkBusy(true);
    setBulkMessage(null);
    setBulkOutcomes([]);
    try {
      const preview = await rpc.call("previewBulkDelete", {
        threadIds: [...selectedRootIds],
        protectedThreadId: activeThreadId,
      });
      if (preview.token === null) {
        setBulkMessage(
          `${preview.skipped.length} selected ${preview.skipped.length === 1 ? "family is" : "families are"} protected. Nothing can be deleted.`,
        );
        setBulkOutcomes(
          preview.skipped.map((entry) => ({
            id: entry.id,
            message: entry.message,
            failed: false,
          })),
        );
      } else {
        setBulkPreview(preview);
      }
    } catch (error) {
      setBulkMessage(errorMessage(error));
    } finally {
      setBulkBusy(false);
    }
  };

  const confirmSelectedDeletion = async () => {
    const preview = bulkPreview;
    if (preview?.token == null || bulkBusy) return;
    setBulkBusy(true);
    try {
      const result = await rpc.call("confirmBulkDelete", {
        token: preview.token,
      });
      const remaining = new Set(selectedRootIds);
      for (const threadId of result.deleted) remaining.delete(threadId);
      setSelectedRootIds(remaining);
      selectionAnchorRootId.current = null;
      setBulkPreview(null);
      const skippedCount = preview.skipped.length + result.skipped.length;
      setBulkOutcomes([
        ...preview.skipped.map((entry) => ({
          id: entry.id,
          message: entry.message,
          failed: false,
        })),
        ...result.skipped.map((entry) => ({
          id: entry.id,
          message: entry.message,
          failed: false,
        })),
        ...result.failed.map((entry) => ({
          id: entry.id,
          message: entry.message,
          failed: true,
        })),
      ]);
      const summary = [
        result.deleted.length > 0
          ? `Deleted ${result.deleted.length}.`
          : "Deleted none.",
        skippedCount > 0 ? `${skippedCount} protected.` : "",
        result.failed.length > 0 ? `${result.failed.length} failed.` : "",
      ]
        .filter(Boolean)
        .join(" ");
      setBulkMessage(summary);
      if (remaining.size === 0) setSelectionMode(false);
    } catch (error) {
      setBulkPreview(null);
      setBulkMessage(errorMessage(error));
      setBulkOutcomes([]);
    } finally {
      setBulkBusy(false);
    }
  };

  /**
   * Filing a project is one field, so it has no local echo: the store
   * publishes and the tree re-reads, which keeps a failed write from leaving
   * the sidebar showing a membership the database never took.
   */
  const assignGroup = (projectId: string, groupId: string | null) => {
    void rpc
      .call("assignProjectToGroup", { projectId, groupId })
      .then(() => groupsApi.refresh())
      .catch((error) => setReorderAnnouncement(errorMessage(error)));
  };

  /** Rename a group from its row. The store publishes, the tree re-reads. */
  const renameGroup = (groupId: string, name: string) => {
    void rpc
      .call("renameGroup", { groupId, name })
      .then(() => groupsApi.refresh())
      .catch((error) => setReorderAnnouncement(errorMessage(error)));
  };

  /**
   * Delete a group from its row. bb's own section menu removes without a
   * second dialog because a section is not its contents; a group here releases
   * its projects to Ungrouped rather than deleting them, so the same applies.
   */
  const removeGroup = (groupId: string) => {
    void rpc
      .call("deleteGroup", { groupId })
      .then(() => groupsApi.refresh())
      .catch((error) => setReorderAnnouncement(errorMessage(error)));
  };

  /**
   * Move a group one slot through the explicit order the store persists.
   * `reorderGroups` wants the whole list, so the new order is built here and
   * sent complete rather than as a delta.
   */
  const moveGroup = (groupId: string, delta: -1 | 1) => {
    const ids = groupsApi.groups.map((group) => group.id);
    const from = ids.indexOf(groupId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, groupId);
    void rpc
      .call("reorderGroups", { groupIds: next })
      .then(() => groupsApi.refresh())
      .catch((error) => setReorderAnnouncement(errorMessage(error)));
  };

  /** A project renamed from its row menu; bb owns the name, we forward it. */
  const renameProject = (projectId: string, name: string) => {
    void rpc
      .call("renameProject", { projectId, name })
      .catch((error) => setReorderAnnouncement(errorMessage(error)));
  };

  /** A worktree alias. bb stores it on the environment, so it survives regroups. */
  const renameWorktree = (environmentId: string, name: string) => {
    void rpc
      .call("renameEnvironment", { environmentId, name })
      .catch((error) => setReorderAnnouncement(errorMessage(error)));
  };

  /** Fold every group and project, so the tree collapses to its headers. */
  const collapseAll = () => {
    patchViewState({
      collapsedGroups: [
        ...groupsApi.groups.map((group) => group.id),
        UNGROUPED_SCOPE_KEY,
      ],
      collapsedProjects: unfilteredProjectGroups.map(
        (group) => group.project.id,
      ),
    });
  };

  /**
   * Back to the default view: no filter, every order reading the manual list,
   * and the tree's first level back to the user's own groups.
   */
  const resetView = () => {
    patchViewState({ filter: "all" });
    viewPreferences.setProjectSort("manual");
    viewPreferences.setThreadSort("manual");
    // The worktree lens was the one this forgot, so a user who had switched it
    // to a sort could not get back to their own arrangement from here.
    viewPreferences.setWorktreeSort("manual");
    viewPreferences.setOrganizationMode(DEFAULT_ORGANIZATION_MODE);
  };

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
      {/*
        One live region, not two. Both messages are "what just happened to the
        tree" and a reorder failure and a copy result can land in the same
        breath; two polite regions read the second as a correction of the first.
      */}
      <output className="sr-only" aria-live="polite" aria-atomic="true">
        {reorderAnnouncement || sidebarAnnouncement}
      </output>
      {/*
        Pinned rows are the first band in the sidebar, above the scope strip.

        They sit outside `data-nest-scroll`, so scrolling the project tree does
        not carry them away, and above the strip so they apply across every
        scope rather than looking like a child of the selected one.
      */}
      <div className="shrink-0 pl-1.5 pr-0.5">
        <PinnedSection
          pinned={orderedPinnedFamilies}
          handlers={treeHandlers}
          reorderEnabled={pinnedReorderEnabled}
          reorderDisabledReason={pinnedReorderDisabledReason}
          onReorder={pinnedOrder.move}
        />
      </div>
      <div className="shrink-0">
        <GroupTabs
          tabs={groupTabs}
          activeKey={activeScopeKey}
          panelId={treePanelId}
          onSelect={(scope) =>
            patchViewState({ scope: groupScopeKey(scope) })
          }
          onManage={() => setGroupManagerOpen(true)}
        >
          {selectionMode ? null : (
            <ViewMenu
              organizationMode={viewPreferences.organizationMode}
              onOrganizationModeChange={viewPreferences.setOrganizationMode}
              filter={filterPreset}
              onFilterChange={(filter) => patchViewState({ filter })}
              projectSort={viewPreferences.projectSort}
              onProjectSortChange={viewPreferences.setProjectSort}
              threadSort={viewPreferences.threadSort}
              onThreadSortChange={viewPreferences.setThreadSort}
              worktreeSort={viewPreferences.worktreeSort}
              onWorktreeSortChange={viewPreferences.setWorktreeSort}
              onCollapseAll={collapseAll}
              onResetView={resetView}
            />
          )}
          <button
            type="button"
            aria-label={
              selectionMode ? "Thread selection active" : "Select threads"
            }
            title={selectionMode ? "Thread selection active" : "Select threads"}
            disabled={selectionMode}
            data-bb-icon-button=""
            onClick={() => {
              selectionAnchorRootId.current = null;
              setSelectionMode(true);
              setBulkMessage(null);
              setBulkOutcomes([]);
            }}
            className={cn(
              "flex size-6 items-center justify-center rounded-md text-muted-foreground",
              "hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:bg-sidebar-accent focus-visible:text-foreground disabled:opacity-50",
              selectionMode && "bg-primary/10 text-primary",
            )}
          >
            <Icon name="ListTodo" className="size-3.5" aria-hidden />
          </button>
        </GroupTabs>

        {selectionMode ? (
          <div className="flex h-8 items-center gap-1 border-y border-sidebar-border/70 px-2 text-2xs">
            <span id={selectionHintId} className="sr-only">
              Use Shift+click on another checkbox to select or deselect a range.
            </span>
            <span className="min-w-0 flex-1 truncate font-medium text-foreground">
              {selectedRootIds.size} selected
            </span>
            <button
              type="button"
              disabled={selectableVisibleRootIds.length === 0}
              title={`${Math.max(0, visibleRootCount - selectableVisibleRootIds.length)} visible protected`}
              onClick={selectAllVisible}
              className="h-6 rounded px-1.5 font-medium text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40"
            >
              All
            </button>
            <button
              type="button"
              disabled={selectedRootIds.size === 0}
              onClick={() => {
                selectionAnchorRootId.current = null;
                setSelectedRootIds(new Set());
                setBulkMessage(null);
                setBulkOutcomes([]);
              }}
              className="h-6 rounded px-1.5 font-medium text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40"
            >
              Clear
            </button>
            <button
              type="button"
              aria-label={`Delete ${selectedRootIds.size} selected thread families`}
              title="Delete selected permanently"
              disabled={selectedRootIds.size === 0 || bulkBusy}
              data-bb-icon-button=""
              onClick={() => void previewSelectedDeletion()}
              className="flex size-6 items-center justify-center rounded-md text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40"
            >
              <Icon
                name={bulkBusy ? "Loading" : "Trash2"}
                className={cn(
                  "size-3.5",
                  bulkBusy && "animate-spin motion-reduce:animate-none",
                )}
                aria-hidden
              />
            </button>
            <button
              type="button"
              aria-label="Cancel thread selection"
              title="Cancel selection"
              disabled={bulkBusy}
              data-bb-icon-button=""
              onClick={cancelSelection}
              className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40"
            >
              <Icon name="CircleX" className="size-3.5" aria-hidden />
            </button>
          </div>
        ) : null}

        {bulkMessage || bulkOutcomes.length > 0 ? (
          <div className="border-b border-sidebar-border/70 px-2.5 py-1 text-2xs leading-snug text-muted-foreground">
            {bulkMessage ? (
              <output aria-live="polite">{bulkMessage}</output>
            ) : null}
            {bulkOutcomes.length > 0 ? (
              <ul className="mt-0.5 space-y-0.5" aria-label="Bulk delete outcomes">
                {bulkOutcomes.map((outcome) => (
                  <li
                    key={`${outcome.id}:${outcome.message}`}
                    className={cn(
                      "truncate",
                      outcome.failed && "text-destructive",
                    )}
                    title={`${rootTitleById.get(outcome.id) ?? outcome.id}: ${outcome.message}`}
                  >
                    <span className="font-medium text-foreground/80">
                      {rootTitleById.get(outcome.id) ?? outcome.id}
                    </span>
                    {`: ${outcome.message}`}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      {/*
        The bar's lane is reserved, and the padding is not a stand-in for it.

        A scrollbar is laid out between the padding box and the border, so it
        is taken out of the content box and never out of the padding. Padding
        therefore cannot absorb one: rows are full width, so the moment the bar
        appears every row narrows by the bar's width and everything pinned to a
        row's right edge — the trailing glyphs, the disclosure chevron, the
        menu — jumps left. `scrollbar-gutter: stable` keeps the content box at
        one width whether or not the bar is showing, so nothing moves. What is
        left on the right is the bar's own lane plus a small gap, which is why
        the padding is a token step rather than the roomier inset it used to
        be: with the lane reserved, a wide padding just reads as a dead margin.

        `overflow-y: auto` computes `overflow-x` to `auto`, so a single pixel
        of horizontal overflow used to grow a horizontal bar, which then ate
        its own strip of height and fed back into the vertical one. `overflow-x:
        clip` ends that whole class of failure. Decorations that used to poke
        past the right edge — the status, pull-request and provider tooltips —
        are bounded by the row they hang off instead, which is what those rows'
        `@container` is for.
      */}
      <div
        data-nest-scroll=""
        id={treePanelId}
        role="tabpanel"
        // The selected tab names this panel. Every tab controls the same tree,
        // so the label is the active one rather than a fixed string.
        aria-labelledby={`${treePanelId}-tab-${encodeURIComponent(activeScopeKey)}`}
        tabIndex={-1}
        className={TREE_SCROLL_CLASS}
      >
        {viewNotice === null ? null : <ThreadViewNotice text={viewNotice} />}
        {order.changedElsewhere ? (
          <OrderChangedNotice onReload={order.reload} />
        ) : null}
        {view.source === "none" ? (
          status === "error" ? (
            <ThreadLoadFailure
              recovering={recovering}
              error={recoveryError}
              onRetry={recover}
              onUseOriginal={() => setShowFlatFallback(true)}
            />
          ) : null
        ) : !lifecycle.shelvesReady ? null : nothingToShow ? (
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
          <p role="status" className={EMPTY_STATE_CLASS}>
            {searching
              ? "No threads found"
              : filterPreset === "all" && projects.length === 0
                ? "No projects yet"
                : "No threads match this filter"}
          </p>
        ) : (
          // A classless block, not `flex flex-col`: the group sections carry
          // `mb-1` and a shelf header carries `mt-3`, and as block siblings
          // those margins collapse to the larger of the two. In a flex column
          // they would add up instead, so the tree would gain a step between
          // every pair of rows.
          <div ref={attachTreeAutoAnimateRef}>
            {treeNodes.map((node) => (
              <GroupSection
                key={node.groupId ?? "__ungrouped__"}
                node={node}
                handlers={treeHandlers}
                groups={groupsApi.groups}
                onAssignGroup={assignGroup}
                onNewThreadInProject={seedFromProject}
                onNewWorktree={seedNewWorktree}
                onNewThreadInWorkspace={seedFromWorkspace}
                projectColorOverrides={projectColorOverrides}
                projectIcons={projectIcons}
                projectReorder={{
                  enabled: projectReorderEnabled,
                  next: reorderProjectByKeyboard,
                  drop: reorderProjectDrop,
                }}
              />
            ))}
            {showParkedShelves ? (
              <>
                <ParkedShelf
                  label="Snoozed"
                  threads={snoozed}
                  expanded={showSnoozed}
                  onToggle={() =>
                    patchViewState({ snoozedOpen: !showSnoozed })
                  }
                  shelf="snoozed"
                  activeThreadId={activeThreadId}
                  lifecycle={lifecycle}
                  onNavigate={onNavigate}
                  now={now}
                />
                <ParkedShelf
                  label="Settled"
                  threads={settled}
                  pendingCount={pendingSettled}
                  expanded={showSettled}
                  onToggle={() =>
                    patchViewState({ settledOpen: !showSettled })
                  }
                  shelf="settled"
                  activeThreadId={activeThreadId}
                  lifecycle={lifecycle}
                  onNavigate={onNavigate}
                  now={now}
                  settledLimit={settledLimit}
                  settledPageSize={preferences.pageSize}
                  searching={searching}
                  page={settledPages}
                  onLoadMore={() => setSettledPages((pages) => pages + 1)}
                  onShowLess={() => setSettledPages(1)}
                />
              </>
            ) : null}
          </div>
        )}
      </div>

      <BulkDeleteDialog
        open={bulkPreview !== null}
        preview={bulkPreview}
        busy={bulkBusy}
        onCancel={() => setBulkPreview(null)}
        onConfirm={() => void confirmSelectedDeletion()}
      />

    <GroupManagerDialog
      open={groupManagerOpen}
      groups={groupsApi.groups}
      icons={groupsApi.icons}
      onClose={() => setGroupManagerOpen(false)}
    />

    <NewThreadDialog
      seed={newThreadSeed}
      onClose={newThread.close}
      onCreated={newThread.created}
    />

    </div>
    </NestViewStateProvider>
    </WorkingSinceContext.Provider>
  );
}

/**
 * A minimal flat list for a cold host failure.
 *
 * Current bb no longer hands the built-in list to a sidebar replacement. The
 * recovery read still gives Nest the rows, so this keeps the escape hatch
 * useful without pretending the plugin can mount the host's own component.
 */
function FlatThreadFallback({
  threads,
  onOpen,
}: {
  threads: readonly PluginSidebarThread[];
  onOpen: (id: string) => void;
}) {
  const rows = sortByCreatedAtDescending(
    threads.filter((thread) => !thread.isArchived && !thread.isHidden),
  );
  return (
    <ul className="flex flex-col gap-px p-1.5" aria-label="Threads">
      {rows.map((thread) => (
        <li key={thread.id}>
          <button
            type="button"
            onClick={() => onOpen(thread.id)}
            className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-foreground/90 hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <span className="min-w-0 flex-1 truncate">
              {threadDisplayTitle(thread)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function ParkedShelf({
  label,
  threads,
  pendingCount = 0,
  expanded,
  onToggle,
  shelf,
  activeThreadId,
  lifecycle,
  onNavigate,
  now,
  settledLimit,
  settledPageSize,
  searching,
  onLoadMore,
  onShowLess,
  page,
}: {
  label: string;
  threads: readonly PluginSidebarThread[];
  pendingCount?: number;
  expanded: boolean;
  onToggle: () => void;
  shelf: "snoozed" | "settled";
  activeThreadId: string | null;
  lifecycle: ReturnType<typeof useLifecycle>;
  onNavigate: () => void;
  now: number;
  /** How many rows this shelf draws. Absent means all of them. */
  settledLimit?: number;
  /** How many rows one page holds, for the button's own label. */
  settledPageSize?: number;
  /**
   * A search draws every match. Its results are what the user asked for, and
   * holding some of them behind a Load more the search box cannot explain is
   * the one case where the limit works against the shelf.
   */
  searching?: boolean;
  /** How many pages are drawn, so the shelf can offer to put them away. */
  page?: number;
  onLoadMore?: () => void;
  onShowLess?: () => void;
}) {
  // Before the early return: a shelf that draws nothing still runs its hooks.
  const attachListAutoAnimateRef = useListAutoAnimate<HTMLUListElement>();
  const count = threads.length + pendingCount;
  /**
   * The limit counts the rows this shelf holds, never `count`: a row still
   * being read is not one "Load more" could reveal, and the header already
   * counts it.
   */
  const pages = page ?? 1;
  const paged = shelf === "settled" && !searching;
  const limit = paged ? (settledLimit ?? threads.length) : threads.length;
  const visible = visibleRows(
    threads,
    limit,
    activeThreadId,
    (thread) => thread.id,
  );
  const hasMore = hasMoreRows(threads.length, limit);
  const nextPageCount = nextPageSize(
    threads.length,
    limit,
    settledPageSize ?? limit,
  );
  if (count === 0) return null;
  return (
    <section aria-label={label}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="mt-3 flex w-full cursor-pointer items-center gap-2 px-2.5 pb-1 text-left"
      >
        <span className="text-2xs font-medium text-muted-foreground/70">
          {expanded ? label : `${label} (${count})`}
        </span>
        <span className="h-px flex-1 bg-sidebar-border" />
        <span className={TRAILING_GLYPH_BOX_CLASS}>
          <Icon
            name="ChevronDown"
            className={cn(
              "size-3 text-muted-foreground/70 transition-transform duration-150 ease-out motion-reduce:transition-none",
              expanded && "rotate-180",
            )}
          />
        </span>
      </button>
      {/*
        The list stays mounted and its rows come and go inside it, so opening
        and closing the shelf plays the same per-row entry and exit that
        Load more does — one mechanism, not two.
      */}
      <ul ref={attachListAutoAnimateRef} className="flex flex-col gap-px">
        {expanded
          ? visible.map((thread) => (
              <SlimRow
                key={thread.id}
                thread={thread}
                isActive={thread.id === activeThreadId}
                shelf={shelf}
                wakeAt={lifecycle.wakeAtFor(thread)}
                now={now}
                onNavigate={onNavigate}
                onRestore={() =>
                  shelf === "snoozed"
                    ? lifecycle.unsnooze(thread.id)
                    : lifecycle.unsettle(thread.id)
                }
              />
            ))
          : null}
      </ul>
      {expanded && paged && onLoadMore && onShowLess && (hasMore || pages > 1) ? (
        <PageControls
          hasMore={hasMore}
          remaining={nextPageCount}
          page={pages}
          onLoadMore={onLoadMore}
          onShowLess={onShowLess}
          className="ml-2.5"
        />
      ) : null}
    </section>
  );
}

function renderedSelectableRootIds(root: HTMLDivElement | null): string[] {
  if (root === null) return [];
  return Array.from(
    root.querySelectorAll<HTMLInputElement>(
      "input[data-nest-select-root]:not(:disabled)",
    ),
  ).flatMap((input) => {
    const rootId = input.dataset.nestSelectRoot;
    return rootId && input.getClientRects().length > 0 ? [rootId] : [];
  });
}

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  if (left.size !== right.size) return false;
  return [...left].every((value) => right.has(value));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "error" in error &&
    typeof error.error === "string" &&
    error.error.trim()
  ) {
    return error.error;
  }
  return "Could not update the selected threads.";
}
