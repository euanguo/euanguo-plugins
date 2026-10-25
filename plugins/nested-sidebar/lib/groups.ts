/**
 * Project groups — the level above projects.
 *
 * bb's own `Section` cannot hold a project (its `sectionId` lives on the
 * thread), and it is mutually exclusive with grouping by project. So this
 * level is ours: a named bucket, a project belongs to at most one, and a
 * project that belongs to none lands in the implicit "Ungrouped" view.
 *
 * A group is deliberately thin — an id, a name, an order — because everything
 * else on the row (counts, worst status) is derived at render time from the
 * threads underneath it and must never be stored where it can go stale.
 */

import {
  GROUP_ICON_OPTIONS,
  DEFAULT_GROUP_ICON,
  canonicalGroupIcon,
  groupIconLabel,
  normalizeGroupIconName,
  validGroupIcon,
  type GroupIconName,
} from "./group-icons.ts";
export {
  GROUP_ICON_OPTIONS,
  DEFAULT_GROUP_ICON,
  canonicalGroupIcon,
  groupIconLabel,
  normalizeGroupIconName,
  validGroupIcon,
} from "./group-icons.ts";
export type { GroupIconName } from "./group-icons.ts";

export const MAX_GROUPS = 100;
export const MAX_GROUP_NAME_LENGTH = 60;
export const MAX_GROUP_ID_LENGTH = 100;

const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/;

export interface ProjectGroup {
  readonly id: string;
  readonly name: string;
  readonly icon: GroupIconName;
  /** Explicit user order; groups sort by this, then by name. */
  readonly position: number;
}

/**
 * projectId -> groupId. A project that belongs to no group is simply absent
 * from the map; there is never a stored null, so a released project cannot
 * linger as a key with no meaning.
 */
export type GroupAssignment = Readonly<Record<string, string>>;

export function validGroupId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_GROUP_ID_LENGTH &&
    value.trim() === value &&
    !CONTROL_CHARACTER.test(value)
  );
}

export function validGroupName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= MAX_GROUP_NAME_LENGTH &&
    !CONTROL_CHARACTER.test(value)
  );
}

export function canonicalGroupName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * The name a rename should store, or null when there is nothing to store.
 *
 * Shared by the inline editor on the group row and the manager dialog so the
 * two entry points cannot drift: an empty or unchanged draft is not a rename,
 * and everything else is normalised the same way the server normalises it.
 */
export function renameIntent(
  draft: string,
  currentName: string,
): string | null {
  const name = canonicalGroupName(draft);
  if (name.length === 0) return null;
  if (name === currentName) return null;
  return name;
}

export function sortGroups(groups: readonly ProjectGroup[]): ProjectGroup[] {
  return [...groups].sort(
    (left, right) =>
      left.position - right.position || left.name.localeCompare(right.name),
  );
}

/**
 * The scope the tab strip selects. `all` shows every project; `ungrouped` is
 * a real destination and not a synonym for `all`, because a project the user
 * has not filed yet must still be reachable from the strip.
 */
export type GroupScope =
  | { readonly kind: "all" }
  | { readonly kind: "ungrouped" }
  | { readonly kind: "group"; readonly groupId: string };

export function groupScopeKey(scope: GroupScope): string {
  if (scope.kind === "all") return "__all__";
  if (scope.kind === "ungrouped") return "__ungrouped__";
  return scope.groupId;
}

/**
 * Whether the strip draws its Ungrouped tab.
 *
 * Ungrouped is a real destination, but only once groups exist — with none it
 * would duplicate All — and only while it holds a project. A project record is
 * enough: it may have no thread or workspace yet, but the row is still where a
 * new thread starts, and hiding it would make that project unreachable from
 * its own scope.
 */
export function shouldShowUngroupedTab(
  projectGroupCount: number,
  ungroupedProjectCount: number,
  projectCount: number,
): boolean {
  // A snapshot from a previous mount can outlive the projects it described.
  // Until this view has at least one project, there is nothing for a scope to
  // contain, so no scope tab should imply otherwise.
  return projectCount > 0 && projectGroupCount > 0 && ungroupedProjectCount > 0;
}

/**
 * Which group a project belongs to under the current scope. `null` means the
 * scope does not include it. Membership is by the FIRST group that claims a
 * project, so a stale duplicate assignment cannot draw a project twice.
 */
export function groupIdForProject(
  assignment: GroupAssignment,
  validIds: ReadonlySet<string>,
  projectId: string,
): string | null {
  const groupId = assignment[projectId];
  return typeof groupId === "string" && validIds.has(groupId) ? groupId : null;
}

export function projectInScope(
  scope: GroupScope,
  assignment: GroupAssignment,
  validIds: ReadonlySet<string>,
  projectId: string,
): boolean {
  if (scope.kind === "all") return true;
  const groupId = groupIdForProject(assignment, validIds, projectId);
  if (scope.kind === "ungrouped") return groupId === null;
  return groupId === scope.groupId;
}

/**
 * Move a project into a group. Returns the next assignment map, or null when
 * the request is not a real change (unknown group, or already there) — the
 * caller then skips the round trip.
 */
export function assignProject(
  assignment: GroupAssignment,
  validIds: ReadonlySet<string>,
  projectId: string,
  groupId: string | null,
): GroupAssignment | null {
  const current = groupIdForProject(assignment, validIds, projectId);
  if (current === groupId) return null;
  if (groupId !== null && !validIds.has(groupId)) return null;
  const next: Record<string, string> = { ...assignment };
  if (groupId === null) delete next[projectId];
  else next[projectId] = groupId;
  return next;
}

/** Groups with no projects left, so the caller can offer to clean them up. */
export function emptyGroupIds(
  groups: readonly ProjectGroup[],
  assignment: GroupAssignment,
  validIds: ReadonlySet<string>,
  projectIds: readonly string[],
): string[] {
  const used = new Set<string>();
  for (const projectId of projectIds) {
    const groupId = groupIdForProject(assignment, validIds, projectId);
    if (groupId !== null) used.add(groupId);
  }
  return groups.map((group) => group.id).filter((id) => !used.has(id));
}
