import type {
  PluginSidebarProject,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import {
  sortByCreatedAtDescending,
  type ThreadFamily,
} from "./inbox.ts";
import { rollupThreads, mergeRollups, type StatusRollup } from "./rollup.ts";
import { disambiguateWorkspaceLabels, mergeWorkspaceRefs, shouldShowWorkspaces, workspaceRefOf, workspaceRefOfEnvironment, type WorkspaceEnvironmentDescriptor, type WorkspaceProjectDescriptor, type WorkspaceRef } from "./workspace.ts";
import { orderWorkspaces, workspaceSortFacts } from "./workspace-order.ts";
import type { WorktreeSortMode } from "./sort-modes.ts";
import type { ManualOrderMap } from "./manual-order.ts";
import type { GroupIconName } from "./groups.ts";
import type {
  UnseenOwnedWorkspace,
  WorkspaceOwnershipMap,
} from "./workspace-ownership.ts";

/** One workspace inside a project — a worktree, the checkout, or nothing. */
export interface WorkspaceNode {
  readonly ref: WorkspaceRef;
  readonly families: ThreadFamily[];
  readonly rollup: StatusRollup;
}

export interface ProjectNode {
  readonly project: PluginSidebarProject;
  readonly families: ThreadFamily[];
  readonly workspaces: WorkspaceNode[];
  /** False when the project's threads occupy a single workspace. */
  readonly showWorkspaces: boolean;
  readonly rollup: StatusRollup;
  /**
   * The repository this row's workspaces belong to, when it was resolved.
   *
   * Null means nobody asked, or the machine holding the paths did not answer.
   * It is not "this project has no repository": a plain directory is a
   * repository of one, and that has a key.
   */
  readonly repoKey: string | null;
  /**
   * Every bb project drawn under this row, in the order they arrived.
   *
   * More than one means bb filed one repository under several projects — the
   * shape an agent makes when it creates a project for a worktree instead of an
   * environment in the existing one. The first is the row's identity: its name,
   * its group, its colour, its icon and its position. The rest keep their own
   * records untouched, so nothing had to be migrated to merge them and nothing
   * has to be migrated to un-merge them.
   */
  readonly mergedProjectIds: readonly string[];
  /**
   * Projects that claim an environment drawn under this row's owner.
   *
   * These are safe to diagnose but not safe to delete through the display
   * project's recursive project action.
   */
  readonly foreignClaimProjectIds: readonly string[];
}

export interface GroupNode {
  /** Null for the implicit Ungrouped bucket. */
  readonly groupId: string | null;
  readonly name: string;
  readonly icon: GroupIconName;
  readonly projects: ProjectNode[];
  readonly rollup: StatusRollup;
}

/**
 * Build the whole tree in one pass.
 *
 * The workspace level is computed per project and omitted when it would not
 * distinguish anything (`showWorkspaces === false`), which is what keeps the
 * common single-checkout project flat. Rollups are folded bottom-up, so every
 * level reports the same truth about what is running underneath it.
 */
export function buildTree(input: {
  /**
   * Projects already resolved into families and ordered by the caller. Taking
   * them this way means every existing rule — lifecycle shelves, filtering,
   * manual project and family order — keeps working untouched, and this module
   * only adds the workspace and group levels on top.
   */
  projectGroups: readonly { project: PluginSidebarProject; families: ThreadFamily[] }[];
  now: number;
  /** projectId -> groupId, already validated against existing groups. */
  assignment: Readonly<Record<string, string>>;
  /** Rendered in this order; an id with no projects is dropped. */
  groupOrder: readonly { id: string; name: string; icon: GroupIconName }[];
  /** Project id -> worktree keys, the arrangement the user made. */
  workspaceOrder: ManualOrderMap;
  /**
   * The lens over the worktree level. `manual` — the default — reads the
   * arrangement above; every other mode ranks the worktrees by a fact about
   * them and leaves that arrangement on disk untouched. The checkout leads
   * either way.
   */
  worktreeSort?: WorktreeSortMode;
  /** The icon the implicit Ungrouped section carries, chosen by the user. */
  ungroupedIcon: GroupIconName;
  environments?: ReadonlyMap<string, WorkspaceEnvironmentDescriptor>;
  projects?: ReadonlyMap<string, WorkspaceProjectDescriptor>;
  /**
   * projectId -> repoKey, from the physical read. Absent means nobody asked, and
   * the tree is then exactly what it was before the repository axis existed.
   */
  repoKeyByProject?: Readonly<Record<string, string>>;
  /** Derived physical owner for every environment id. */
  workspaceOwnership?: WorkspaceOwnershipMap;
  /** Worktrees the repository records, grouped under their derived project. */
  unseenWorkspaces?: Readonly<Record<string, readonly UnseenOwnedWorkspace[]>>;
  /**
   * Whether one repository is drawn as one row.
   *
   * Off by default, and deliberately a decision rather than a consequence of
   * the read succeeding: merging two projects into one row is the tree
   * disagreeing with bb's own list, and a user who filed them apart on purpose
   * must be able to see bb's answer instead.
   */
  mergeRepos?: boolean;
}): GroupNode[] {
  const { projectGroups, now, assignment, groupOrder, ungroupedIcon } = input;
  const { workspaceOrder } = input;
  const worktreeSort = input.worktreeSort ?? "manual";
  const environments = input.environments ?? new Map<string, WorkspaceEnvironmentDescriptor>();
  const projects = input.projects ?? new Map<string, WorkspaceProjectDescriptor>();
  const repoKeyByProject = input.repoKeyByProject ?? {};
  const workspaceOwnership = input.workspaceOwnership ?? {};
  const unseenWorkspaces = input.unseenWorkspaces ?? {};

  // The repository axis, when it was asked for and answered. Everything below
  // this line is the same code either way: a merged row is a row with more than
  // one project id on it.
  const rows = input.mergeRepos === true
    ? mergeProjectsByRepo(projectGroups, repoKeyByProject)
    : projectGroups.map((group) => ({
        ...group,
        repoKey: repoKeyByProject[group.project.id] ?? null,
        mergedProjectIds: [group.project.id],
      }));

  const projectsByGroup = new Map<string, ProjectNode[]>();
  for (const row of rows) {
    const node = buildProjectNode({
      ...row,
      now,
      // One arrangement per repository, taken from the project that leads the
      // row: two projects that share a repository have two stored arrangements
      // and the leading one is the one the user sees named on the row.
      storedWorkspaceKeys: workspaceOrder[row.project.id],
      worktreeSort,
      environments,
      projects,
      workspaceOwnership,
      unseenWorkspaces,
    });
    const groupId = assignment[row.project.id] ?? "__ungrouped__";
    const bucket = projectsByGroup.get(groupId) ?? [];
    bucket.push(node);
    projectsByGroup.set(groupId, bucket);
  }

  // Projects keep the order they arrived in. That order is already the user's
  // arrangement (or the chosen sort mode) computed per group before this call,
  // so re-sorting here would silently discard the sidebar's manual ordering.
  const nodes: GroupNode[] = [];
  for (const group of groupOrder) {
    const bucket = projectsByGroup.get(group.id);
    if (bucket === undefined || bucket.length === 0) continue;
    nodes.push(
      makeGroupNode(group.id, group.name, group.icon, [...bucket]),
    );
  }

  const ungrouped = projectsByGroup.get("__ungrouped__");
  if (ungrouped !== undefined && ungrouped.length > 0) {
    nodes.push(
      makeGroupNode(null, "Ungrouped", ungroupedIcon, [...ungrouped]),
    );
  }

  // A project whose group id no longer exists in groupOrder would otherwise
  // vanish. Park it in Ungrouped rather than losing it from the sidebar.
  const known = new Set(groupOrder.map((group) => group.id));
  const orphans = [...projectsByGroup.entries()]
    .filter(([groupId]) =>
      groupId !== "__ungrouped__" && !known.has(groupId),
    )
    .flatMap(([, bucket]) => bucket);
  if (orphans.length > 0) {
    const existing = nodes.find((node) => node.groupId === null);
    const combined = [...(existing?.projects ?? []), ...orphans];
    const replacement = makeGroupNode(null, "Ungrouped", ungroupedIcon, combined);
    if (existing === undefined) nodes.push(replacement);
    else nodes[nodes.indexOf(existing)] = replacement;
  }

  return nodes;
}

function makeGroupNode(
  groupId: string | null,
  name: string,
  icon: GroupIconName,
  projects: ProjectNode[],
): GroupNode {
  return {
    groupId,
    name,
    icon,
    projects,
    rollup: mergeRollups(projects.map((project) => project.rollup)),
  };
}

/**
 * One row of the tree's project level, before its workspaces are worked out.
 *
 * A named type rather than a tuple because the two id-bearing fields are both
 * strings: `project.id` and `mergedProjectIds` swapped by position would merge
 * nothing and look like a project with a strange name.
 */
interface ProjectRow {
  readonly project: PluginSidebarProject;
  readonly mergedProjectIds: readonly string[];
  readonly repoKey: string | null;
  readonly families: ThreadFamily[];
}

/**
 * Projects that are one repository, drawn as one row.
 *
 * The first project in the incoming order leads, because that order is already
 * the user's arrangement — a manual order, or the chosen sort mode — and
 * re-sorting here would silently discard it.
 *
 * A project whose repository was not resolved is left exactly as it was. An
 * unobserved directory is not evidence that two projects are the same one, and
 * merging on a guess would join two unrelated checkouts into a row the user
 * cannot take apart.
 */
function mergeProjectsByRepo(
  groups: readonly { project: PluginSidebarProject; families: ThreadFamily[] }[],
  repoKeyByProject: Readonly<Record<string, string>>,
): readonly ProjectRow[] {
  const rowByRepo = new Map<string, number>();
  const rows: ProjectRow[] = [];

  for (const group of groups) {
    const repoKey = repoKeyByProject[group.project.id] ?? null;
    const at = repoKey === null ? undefined : rowByRepo.get(repoKey);
    const existing = at === undefined ? undefined : rows[at];
    if (at === undefined || existing === undefined) {
      if (repoKey !== null) rowByRepo.set(repoKey, rows.length);
      rows.push({
        project: group.project,
        families: group.families,
        repoKey,
        mergedProjectIds: [group.project.id],
      });
      continue;
    }
    rows[at] = {
      ...existing,
      families: [...existing.families, ...group.families],
      mergedProjectIds: [...existing.mergedProjectIds, group.project.id],
    };
  }

  return rows;
}

function buildProjectNode(input: ProjectRow & {
  readonly now: number;
  readonly storedWorkspaceKeys: readonly string[] | undefined;
  readonly worktreeSort: WorktreeSortMode;
  readonly environments: ReadonlyMap<string, WorkspaceEnvironmentDescriptor>;
  readonly projects: ReadonlyMap<string, WorkspaceProjectDescriptor>;
  readonly workspaceOwnership: WorkspaceOwnershipMap;
  readonly unseenWorkspaces: Readonly<Record<string, readonly UnseenOwnedWorkspace[]>>;
}): ProjectNode {
  const {
    project,
    mergedProjectIds,
    repoKey,
    families,
    now,
    storedWorkspaceKeys,
    worktreeSort,
    environments,
    projects,
    workspaceOwnership,
    unseenWorkspaces,
  } = input;
  const allThreads = families.flatMap((family) => [
    family.root,
    ...family.children,
  ]);

  // Group families by the workspace of their ROOT: a child agent runs where
  // its parent does, and splitting a family across nodes would break it apart.
  const familiesByKey = new Map<string, ThreadFamily[]>();
  for (const family of families) {
    const key = workspaceRefOf(
      family.root,
      environments,
      projects,
      workspaceOwnership,
    ).key;
    const bucket = familiesByKey.get(key) ?? [];
    bucket.push(family);
    familiesByKey.set(key, bucket);
  }

  // Every project the row stands for, because a merged row has to list the
  // workspaces of all of them: an environment with no thread in it belongs to
  // the project that owns it, and asking only the leading project would drop
  // the other's `+` rows off the sidebar.
  const refsByKey = new Map<string, WorkspaceRef>();
  for (const projectId of mergedProjectIds) {
    for (const [key, ref] of projectWorkspaceRefs(
      projectId,
      families,
      environments,
      projects,
      workspaceOwnership,
      unseenWorkspaces[projectId] ?? [],
    )) {
      const existing = refsByKey.get(key);
      refsByKey.set(key, existing === undefined ? ref : mergeWorkspaceRefs(existing, ref));
    }
  }

  const refs = disambiguateWorkspaceLabels([...refsByKey.values()]);
  const workspaces: WorkspaceNode[] = orderWorkspaces(
    refs.map((ref) => {
      const inWorkspace = familiesByKey.get(ref.key) ?? [];
      return {
        ref,
        families: inWorkspace,
        rollup: rollupThreads(
          inWorkspace.flatMap((family) => [family.root, ...family.children]),
          now,
        ),
      };
    }),
    storedWorkspaceKeys,
    // The lens is the whole of "not manual": `manual` reads the arrangement,
    // and every other mode needs the numbers the rows were just rolled up with.
    worktreeSort === "manual"
      ? undefined
      : { mode: worktreeSort, facts: workspaceSortFacts },
  );

  return {
    project,
    families: [...families],
    workspaces,
    showWorkspaces: shouldShowWorkspaces(
      workspaces.map((node) => node.ref),
      allThreads.length,
    ),
    rollup: rollupThreads(allThreads, now),
    repoKey,
    mergedProjectIds,
    foreignClaimProjectIds: foreignClaimsForProject(
      project,
      mergedProjectIds,
      environments,
      workspaceOwnership,
    ),
  };
}

/**
 * Every workspace a project has, keyed the way the tree groups them.
 *
 * Not only the ones its threads happen to occupy. An environment outlives the
 * conversations in it: once the last thread in a worktree is settled its family
 * leaves the tree, and a worktree that never held a thread never had one to
 * leave — yet both are still places to start work, and dropping either would
 * take the row, and with it the `+` that is the only way back in, off the
 * sidebar. Merging here keeps such a row identical to the one its threads built,
 * which matters because the key is what the tree groups by.
 *
 * Exported because the worktree arrangement has to name the same rows: an order
 * written from the occupied workspaces alone would omit the rest and then
 * refuse to move them.
 */
export function projectWorkspaceRefs(
  projectId: string,
  families: readonly ThreadFamily[],
  environments: ReadonlyMap<string, WorkspaceEnvironmentDescriptor>,
  projects: ReadonlyMap<string, WorkspaceProjectDescriptor>,
  workspaceOwnership: WorkspaceOwnershipMap = {},
  unseenWorkspaces: readonly UnseenOwnedWorkspace[] = [],
): Map<string, WorkspaceRef> {
  const refs = new Map<string, WorkspaceRef>();
  const remember = (ref: WorkspaceRef) => {
    const existing = refs.get(ref.key);
    refs.set(ref.key, existing === undefined ? ref : mergeWorkspaceRefs(existing, ref));
  };

  for (const family of families) {
    const environmentId = family.root.environment?.id ?? null;
    const ownerProjectId =
      environmentId === null
        ? family.root.projectId
        : workspaceOwnership[environmentId]?.ownerProjectId ??
          family.root.projectId;
    if (ownerProjectId !== projectId) continue;
    remember(
      workspaceRefOf(
        family.root,
        environments,
        projects,
        workspaceOwnership,
      ),
    );
  }
  for (const descriptor of environments.values()) {
    const ownerProjectId =
      workspaceOwnership[descriptor.id]?.ownerProjectId ??
      descriptor.projectId;
    if (ownerProjectId !== projectId) continue;
    const ref = workspaceRefOfEnvironment(
      descriptor,
      projects,
      workspaceOwnership,
    );
    if (ref !== null) remember(ref);
  }
  for (const workspace of unseenWorkspaces) {
    if (workspace.projectId !== projectId) continue;
    remember(unseenWorkspaceRef(workspace, projectId));
  }
  return refs;
}

function unseenWorkspaceRef(
  workspace: UnseenOwnedWorkspace,
  projectId: string,
): WorkspaceRef {
  const path = workspace.path.replaceAll("\\", "/").replace(/\/+$/, "");
  const name = path.split("/").filter(Boolean).at(-1) ?? "Git worktree";
  return {
    kind: "git-worktree",
    key: `unseen:${projectId}:${workspace.hostId}:${path}`,
    label: workspace.branch ?? (workspace.detached ? "Detached HEAD" : name),
    alias: null,
    branch: workspace.branch,
    environmentId: null,
    environmentIds: [],
    path: workspace.path,
    hostId: workspace.hostId,
    diagnostic:
      "This worktree exists on disk but has no bb environment yet. Starting a thread here adopts it.",
  };
}

function foreignClaimsForProject(
  project: PluginSidebarProject,
  mergedProjectIds: readonly string[],
  environments: ReadonlyMap<string, WorkspaceEnvironmentDescriptor>,
  ownership: WorkspaceOwnershipMap,
): string[] {
  if (mergedProjectIds.length > 1) {
    return mergedProjectIds.filter((id) => id !== project.id);
  }
  const claims = new Set<string>();
  for (const environment of environments.values()) {
    if (ownership[environment.id]?.ownerProjectId !== project.id) continue;
    if (environment.projectId !== project.id) claims.add(environment.projectId);
  }
  return [...claims].sort();
}

/**
 * Search that keeps hierarchy. A match on a group keeps its whole subtree; a
 * match on a project keeps every workspace under it; deeper matches keep only
 * the branches that lead to them, so the tree collapses onto the hits.
 */
export function searchTree(
  nodes: readonly GroupNode[],
  query: string,
): GroupNode[] {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) return [...nodes];
  const matches = (value: string) => value.toLowerCase().includes(normalized);

  return nodes.flatMap((node) => {
    if (matches(node.name)) return [node];
    const projects = node.projects.flatMap((project) => {
      if (matches(project.project.name)) return [project];
      const workspaces = project.workspaces.flatMap((workspace) => {
        if (matches(workspace.ref.label)) return [workspace];
        const families = workspace.families.flatMap((family) => {
          const rootMatches = matches(threadTitle(family.root));
          if (rootMatches) return [family];
          const children = family.children.filter((thread) =>
            matches(threadTitle(thread)),
          );
          return children.length > 0 ? [{ ...family, children }] : [];
        });
        return families.length > 0 ? [{ ...workspace, families }] : [];
      });
      if (workspaces.length === 0) return [];
      const families = workspaces.flatMap((workspace) => workspace.families);
      return [{ ...project, workspaces, families }];
    });
    return projects.length > 0 ? [{ ...node, projects }] : [];
  });
}

function threadTitle(thread: PluginSidebarThread): string {
  return thread.title?.trim() || thread.titleFallback?.trim() || "";
}

/** Where one thread sits, in the keys each level's disclosure is stored under. */
export interface ThreadAncestors {
  /** Null for the implicit Ungrouped bucket. */
  readonly groupId: string | null;
  readonly projectId: string;
  readonly workspaceKey: string;
  /** The family root this thread belongs to; the thread itself at the root. */
  readonly rootId: string;
}

/**
 * The branch of the tree that leads to one thread, or null when it is not
 * drawn.
 *
 * This is what lets the sidebar put the user back where they were. bb restores
 * the route, but a route naming a thread inside a collapsed project would leave
 * the user staring at a closed row with no sign of the thread they just came
 * from. Revealing the ancestors is the difference between restoring a URL and
 * restoring a place.
 */
export function threadAncestors(
  nodes: readonly GroupNode[],
  threadId: string,
): ThreadAncestors | null {
  for (const group of nodes) {
    for (const project of group.projects) {
      for (const workspace of project.workspaces) {
        for (const family of workspace.families) {
          const holdsThread =
            family.root.id === threadId ||
            family.children.some((child) => child.id === threadId);
          if (!holdsThread) continue;
          return {
            groupId: group.groupId,
            projectId: project.project.id,
            workspaceKey: workspace.ref.key,
            rootId: family.root.id,
          };
        }
      }
    }
  }
  return null;
}

export { sortByCreatedAtDescending };
