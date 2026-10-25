import type {
  PluginSidebarProject,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk";
import {
  ownerProjectIdForThread,
  type WorkspaceOwnershipMap,
} from "./workspace-ownership.ts";

export interface ThreadFamily {
  root: PluginSidebarThread;
  /** Every visible descendant, oldest first, flattened for the compact tree. */
  children: PluginSidebarThread[];
}

export interface ProjectThreadGroup {
  project: PluginSidebarProject;
  families: ThreadFamily[];
}

/**
 * The sort that defines this sidebar: newest thread on top, and NOTHING moves
 * it afterwards. Activity never re-orders the list, so a row holds its place
 * from creation until you park it and the screen only changes when you act.
 * Status is carried by the card, not by position.
 *
 * Ties break on id so the order is total and stable across renders.
 */
export function sortByCreatedAtDescending<
  T extends { readonly id: string; readonly createdAt: number },
>(threads: readonly T[]): T[] {
  return [...threads].sort(
    (left, right) =>
      right.createdAt - left.createdAt || left.id.localeCompare(right.id),
  );
}

export function threadDisplayTitle(thread: PluginSidebarThread): string {
  const title = thread.title?.trim();
  if (title) return title;
  const fallback = thread.titleFallback?.trim();
  return fallback ? fallback : "Untitled thread";
}

/** Every live-work signal bb exposes for a sidebar row. */
export function threadIsWorking(thread: PluginSidebarThread): boolean {
  const { activity } = thread;
  return (
    activity.workflows > 0 ||
    activity.backgroundAgents > 0 ||
    activity.backgroundCommands > 0 ||
    activity.planMode > 0 ||
    activity.goals > 0 ||
    thread.indicator === "runtime" ||
    thread.indicator === "working-draft"
  );
}

/** Substring match on the visible title only, preserving the incoming order. */
export function searchThreadsByTitle(
  threads: readonly PluginSidebarThread[],
  query: string,
): PluginSidebarThread[] {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) return [...threads];
  return threads.filter((thread) =>
    threadDisplayTitle(thread).toLowerCase().includes(normalized),
  );
}

/**
 * The sidebar's project list: every project bb reports, in bb's order, with the
 * visible root threads filed under each one.
 *
 * Projects come first and threads fill them in, not the other way round. A
 * project with no visible thread — brand new, or with everything parked — is
 * still a project, and leaving it off the sidebar would make it unreachable
 * rather than quiet. Descendants stay attached to their oldest visible ancestor
 * and are flattened into one compact agent list; a parent that is not in
 * `threads` (parked, archived, filtered, or deleted) cannot own a visible row,
 * so its child becomes a root instead of vanishing. Roots keep the inbox's
 * static creation order, with the user's pinned roots first.
 *
 * A thread bb files under a project it does not list still gets a group, after
 * the known ones, so a stale row is never silently lost.
 */
export function buildProjectGroups(
  threads: readonly PluginSidebarThread[],
  projects: readonly PluginSidebarProject[],
  ownership: WorkspaceOwnershipMap | undefined = undefined,
): ProjectThreadGroup[] {
  const threadsByProject = new Map<string, PluginSidebarThread[]>();
  for (const thread of threads) {
    const projectId = ownerProjectIdForThread(thread, ownership);
    const bucket = threadsByProject.get(projectId) ?? [];
    bucket.push(thread);
    threadsByProject.set(projectId, bucket);
  }

  const groups: ProjectThreadGroup[] = projects.map((project) => ({
    project,
    families: threadFamilies(
      threadsByProject.get(project.id) ?? [],
      (thread) => ownerProjectIdForThread(thread, ownership),
    ),
  }));

  const known = new Set(projects.map((project) => project.id));
  const strays = [...threadsByProject.keys()]
    .filter((projectId) => !known.has(projectId))
    .sort((left, right) => left.localeCompare(right));
  for (const projectId of strays) {
    groups.push({
      project: {
        id: projectId,
        name: "Other project",
        isPersonal: false,
        href: `/projects/${projectId}`,
        settingsHref: `/projects/${projectId}/settings`,
      } satisfies PluginSidebarProject,
      families: threadFamilies(
        threadsByProject.get(projectId) ?? [],
        (thread) => ownerProjectIdForThread(thread, ownership),
      ),
    });
  }

  return groups;
}

/**
 * One project's root threads, pinned first, each carrying its flattened
 * descendants oldest-first. Empty when the project has no visible thread, which
 * is a real state and not a reason to drop the project.
 */
function threadFamilies(
  projectThreads: readonly PluginSidebarThread[],
  projectIdOf: (thread: PluginSidebarThread) => string = (thread) =>
    thread.projectId,
): ThreadFamily[] {
  const threadById = new Map(
    projectThreads.map((thread) => [thread.id, thread]),
  );
  const familyByRootId = new Map<string, ThreadFamily>();

  for (const thread of projectThreads) {
    const root = visibleRootOf(thread, threadById, projectIdOf);
    let family = familyByRootId.get(root.id);
    if (family === undefined) {
      family = { root, children: [] };
      familyByRootId.set(root.id, family);
    }
    if (thread.id !== root.id) family.children.push(thread);
  }

  const families = [...familyByRootId.values()];
  for (const family of families) {
    family.children.sort(
      (left, right) =>
        left.createdAt - right.createdAt || left.id.localeCompare(right.id),
    );
  }
  families.sort((left, right) => {
    const pinOrder = Number(right.root.isPinned) - Number(left.root.isPinned);
    if (pinOrder !== 0) return pinOrder;
    return (
      right.root.createdAt - left.root.createdAt ||
      left.root.id.localeCompare(right.root.id)
    );
  });
  return families;
}

/**
 * Search without throwing away hierarchy. A matching child keeps its parent
 * visible as context; a matching parent keeps all of its children visible.
 */
export function searchProjectThreadGroups(
  groups: readonly ProjectThreadGroup[],
  query: string,
): ProjectThreadGroup[] {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) return [...groups];

  return groups.flatMap((group) => {
    const projectMatches = group.project.name.toLowerCase().includes(normalized);
    const families = group.families.flatMap((family) => {
      const rootMatches = threadDisplayTitle(family.root)
        .toLowerCase()
        .includes(normalized);
      if (projectMatches || rootMatches) return [family];
      const children = family.children.filter((thread) =>
        threadDisplayTitle(thread).toLowerCase().includes(normalized),
      );
      return children.length > 0 ? [{ ...family, children }] : [];
    });
    return families.length > 0 ? [{ ...group, families }] : [];
  });
}

export function visibleRootOf(
  thread: PluginSidebarThread,
  threadById: ReadonlyMap<string, PluginSidebarThread>,
  projectIdOf: (thread: PluginSidebarThread) => string = (candidate) =>
    candidate.projectId,
): PluginSidebarThread {
  let current = thread;
  const visited = new Set([thread.id]);
  while (current.parentThreadId !== null) {
    const parent = threadById.get(current.parentThreadId);
    if (
      parent === undefined ||
      projectIdOf(parent) !== projectIdOf(thread) ||
      visited.has(parent.id)
    ) {
      break;
    }
    visited.add(parent.id);
    current = parent;
  }
  return current;
}

/**
 * Archived threads never belong in the inbox — except the ones this plugin
 * parked, which it archives itself.
 *
 * Settling a thread archives it in bb, so leaving the flag alone to decide
 * visibility would empty the settled shelf the instant anything landed on it.
 * A parked row is the plugin saying "I put it there", and that outranks the
 * archive it set.
 */
export function visibleInboxThreads(
  threads: readonly PluginSidebarThread[],
  parkedThreadIds: ReadonlySet<string>,
): PluginSidebarThread[] {
  return threads.filter(
    (thread) => !thread.isArchived || parkedThreadIds.has(thread.id),
  );
}

/**
 * The parent of one thread, or null when the thread is a root, when the id is
 * unknown, or when the parent row is gone (deleted). The parent may be
 * archived or in another project: the flat list hides those, but the child
 * still needs a way back to them.
 */
export function parentOf(
  threads: readonly PluginSidebarThread[],
  threadId: string,
): PluginSidebarThread | null {
  const thread = threads.find((candidate) => candidate.id === threadId);
  const parentThreadId = thread?.parentThreadId;
  if (!parentThreadId) return null;
  return threads.find((candidate) => candidate.id === parentThreadId) ?? null;
}

/** The children of one thread, oldest first (the order they were spawned). */
export function childrenOf(
  threads: readonly PluginSidebarThread[],
  parentThreadId: string,
): PluginSidebarThread[] {
  return threads
    .filter((thread) => thread.parentThreadId === parentThreadId)
    .sort((left, right) => left.createdAt - right.createdAt);
}

/** One thread in the shape it is drawn in: hung off the row that owns it. */
export interface FamilyBranch {
  thread: PluginSidebarThread;
  children: FamilyBranch[];
}

/**
 * A family's descendants as the tree they actually form.
 *
 * `ThreadFamily.children` is flat — every descendant of the root, oldest first —
 * because that is the shape ordering, selection and the rollup all want. Drawing
 * wants the nesting back, so each thread is hung off the nearest ancestor that is
 * also being drawn. A filter that hides a middle thread promotes its children
 * rather than losing them, which is the same rule `visibleRootOf` applies one
 * level up.
 *
 * Siblings keep the order they arrived in, so a level reads oldest-first like the
 * one above it.
 */
export function familyBranches(family: ThreadFamily): FamilyBranch[] {
  const byId = new Map<string, PluginSidebarThread>([
    [family.root.id, family.root],
  ]);
  for (const thread of family.children) byId.set(thread.id, thread);

  // Every node first, then every link: a parent is not guaranteed to come
  // before its child in the flat list, and linking as we went would promote a
  // child whose parent had not been seen yet.
  const branchById = new Map<string, FamilyBranch>();
  const created: { thread: PluginSidebarThread; branch: FamilyBranch }[] = [];
  for (const thread of family.children) {
    const branch: FamilyBranch = { thread, children: [] };
    branchById.set(thread.id, branch);
    created.push({ thread, branch });
  }

  const drawn = new Set(family.children.map((thread) => thread.id));
  const branches: FamilyBranch[] = [];

  for (const { thread, branch } of created) {
    // Walk up past anything the filter dropped, to the nearest ancestor that is
    // being drawn — the same rule `visibleRootOf` applies when it decides which
    // family a thread belongs to. The walk is short: every thread in this map is
    // itself being drawn, so the first step either lands on one or on nothing.
    let ancestorId = thread.parentThreadId;
    while (
      ancestorId !== null &&
      ancestorId !== family.root.id &&
      !drawn.has(ancestorId)
    ) {
      const next = byId.get(ancestorId)?.parentThreadId ?? null;
      if (next === ancestorId) break;
      ancestorId = next;
    }

    const parent = ancestorId === null ? undefined : branchById.get(ancestorId);
    // A row is never hung off itself: the shape is impossible to draw, and a
    // thread that named itself as its parent would otherwise vanish instead of
    // appearing at the top level.
    if (parent === undefined || parent === branch) branches.push(branch);
    else parent.children.push(branch);
  }

  return branches;
}

/** Whether a thread is this row or anywhere under it. */
export function branchHoldsThread(
  branch: FamilyBranch,
  threadId: string | null,
): boolean {
  if (threadId === null) return false;
  if (branch.thread.id === threadId) return true;
  return branch.children.some((child) => branchHoldsThread(child, threadId));
}
