/**
 * Turning the two ordering decisions into a list.
 *
 * Projects are ordered *per group* — the tree is `group -> project`, so a
 * single flat project order cannot express "each group's own arrangement".
 * Thread families are ordered per project, which is what they always were.
 *
 * `manual` reads the user's stored arrangement; every other mode is a lens and
 * leaves that arrangement untouched on disk, so switching back restores it.
 * Pinned roots stay first under every mode, because pinning is itself an
 * ordering statement the user made.
 */

import { threadDisplayTitle, type ProjectThreadGroup, type ThreadFamily } from "./inbox.ts";
import { familyStatus } from "./family-status.ts";
import { familyMembers, familyUpdatedAt } from "./thread-management.ts";
import { statusKindRank, worstKind } from "./rollup.ts";
import { applyProjectOrder } from "./project-order.ts";
import { applyFamilyOrder } from "./family-order.ts";
import { UNGROUPED_ORDER_SCOPE, type ManualOrderMap } from "./manual-order.ts";
import type { ProjectSortMode, ThreadSortMode } from "./sort-modes.ts";

/** Which scope a project's manual order lives under. */
export function projectOrderScope(
  assignment: Readonly<Record<string, string>>,
  projectId: string,
): string {
  const groupId = assignment[projectId];
  return typeof groupId === "string" && groupId.length > 0
    ? groupId
    : UNGROUPED_ORDER_SCOPE;
}

function familyCount(group: ProjectThreadGroup): number {
  return group.families.length;
}

function projectUpdatedAt(group: ProjectThreadGroup): number {
  return group.families.reduce(
    (latest, family) => Math.max(latest, familyUpdatedAt(family)),
    0,
  );
}

function familyKind(family: ThreadFamily, now: number) {
  return familyStatus(familyMembers(family), now).kind;
}

/**
 * When this family last demanded attention, taken across its members.
 *
 * `latestAttentionAt` is bb's own "this wanted you" clock — it is what the
 * lifecycle already uses to wake a parked thread — so ordering by it puts the
 * most recently demanding work on top without inventing a second notion of
 * urgency.
 */
function familyAttentionAt(family: ThreadFamily): number {
  return familyMembers(family).reduce(
    (latest, thread) => Math.max(latest, thread.latestAttentionAt),
    0,
  );
}

function projectKind(group: ProjectThreadGroup, now: number) {
  return worstKind(
    group.families.map((family) => familyKind(family, now)),
  );
}

function projectComparator(
  mode: Exclude<ProjectSortMode, "manual">,
  now: number,
): (left: ProjectThreadGroup, right: ProjectThreadGroup) => number {
  const byName = (left: ProjectThreadGroup, right: ProjectThreadGroup) =>
    left.project.name.localeCompare(right.project.name);
  switch (mode) {
    case "name-asc":
      return byName;
    case "name-desc":
      return (left, right) => right.project.name.localeCompare(left.project.name);
    case "threads-desc":
      return (left, right) => familyCount(right) - familyCount(left) || byName(left, right);
    case "updated-desc":
      return (left, right) =>
        projectUpdatedAt(right) - projectUpdatedAt(left) || byName(left, right);
    case "status":
      return (left, right) =>
        statusKindRank(projectKind(left, now)) -
          statusKindRank(projectKind(right, now)) ||
        projectUpdatedAt(right) - projectUpdatedAt(left) ||
        byName(left, right);
  }
}

function familyComparator(
  mode: Exclude<ThreadSortMode, "manual">,
  now: number,
): (left: ThreadFamily, right: ThreadFamily) => number {
  const byId = (left: ThreadFamily, right: ThreadFamily) =>
    left.root.id.localeCompare(right.root.id);
  switch (mode) {
    case "created-desc":
      return (left, right) => right.root.createdAt - left.root.createdAt || byId(left, right);
    case "created-asc":
      return (left, right) => left.root.createdAt - right.root.createdAt || byId(left, right);
    case "updated-desc":
      return (left, right) => familyUpdatedAt(right) - familyUpdatedAt(left) || byId(left, right);
    case "updated-asc":
      return (left, right) => familyUpdatedAt(left) - familyUpdatedAt(right) || byId(left, right);
    case "attention-desc":
      return (left, right) =>
        familyAttentionAt(right) - familyAttentionAt(left) || byId(left, right);
    case "name-asc":
      return (left, right) =>
        threadDisplayTitle(left.root).localeCompare(threadDisplayTitle(right.root)) ||
        byId(left, right);
    case "status":
      return (left, right) =>
        statusKindRank(familyKind(left, now)) -
          statusKindRank(familyKind(right, now)) ||
        familyUpdatedAt(right) - familyUpdatedAt(left) ||
        byId(left, right);
  }
}

/**
 * The whole project list, ordered group by group.
 *
 * The result is a flat list whose *relative* order inside each group is the
 * order that matters: `buildTree` buckets it again by group and preserves each
 * bucket, so the concatenation order across groups is not load-bearing.
 */
export function orderProjectGroups(
  groups: readonly ProjectThreadGroup[],
  input: {
    assignment: Readonly<Record<string, string>>;
    /** Group ids in display order; projects in unknown groups land after. */
    groupOrder: readonly string[];
    manual: ManualOrderMap;
    mode: ProjectSortMode;
    now: number;
  },
): ProjectThreadGroup[] {
  const { assignment, groupOrder, manual, mode, now } = input;
  const buckets = new Map<string, ProjectThreadGroup[]>();
  for (const group of groups) {
    const key = projectOrderScope(assignment, group.project.id);
    const bucket = buckets.get(key) ?? [];
    bucket.push(group);
    buckets.set(key, bucket);
  }

  const ordered = new Map<string, ProjectThreadGroup[]>();
  for (const [key, bucket] of buckets) {
    ordered.set(
      key,
      mode === "manual"
        ? applyProjectOrder(bucket, manual[key] ?? [])
        : [...bucket].sort(projectComparator(mode, now)),
    );
  }

  const scopeOrder = [...groupOrder, UNGROUPED_ORDER_SCOPE];
  const seen = new Set<string>();
  const result: ProjectThreadGroup[] = [];
  for (const key of scopeOrder) {
    if (seen.has(key)) continue;
    seen.add(key);
    const bucket = ordered.get(key);
    if (bucket !== undefined) result.push(...bucket);
  }
  // A project whose group id no longer exists still has to render; `buildTree`
  // files it under Ungrouped, so it only needs to survive this flattening.
  for (const [key, bucket] of ordered) {
    if (!seen.has(key)) result.push(...bucket);
  }
  return result;
}

/** One project's root threads, pinned first under every mode. */
export function orderFamilies(
  families: readonly ThreadFamily[],
  input: {
    manual: readonly string[] | undefined;
    mode: ThreadSortMode;
    now: number;
  },
): ThreadFamily[] {
  const { manual, mode, now } = input;
  if (mode === "manual") return applyFamilyOrder(families, manual);
  const compare = familyComparator(mode, now);
  const pinned = families.filter((family) => family.root.isPinned);
  const unpinned = families.filter((family) => !family.root.isPinned);
  return [...[...pinned].sort(compare), ...[...unpinned].sort(compare)];
}

/** Project ids of one scope, in the order they are currently drawn. */
export function orderedProjectIds(
  groups: readonly ProjectThreadGroup[],
  assignment: Readonly<Record<string, string>>,
  scope: string,
): string[] {
  return groups
    .filter((group) => projectOrderScope(assignment, group.project.id) === scope)
    .map((group) => group.project.id);
}
