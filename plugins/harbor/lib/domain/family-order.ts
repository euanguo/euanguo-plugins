import type { ThreadFamily } from "./inbox.ts";

export const MAX_ORDER_ROOTS = 500;
const MAX_ID_LENGTH = 200;
const SAFE_ID = /^[^\u0000-\u001F\u007F]+$/;

export type FamilyOrderState = Readonly<Record<string, readonly string[]>>;

export type FamilyMoveResult =
  | { ok: true; order: string[] }
  | {
      ok: false;
      reason:
        | "cross-project"
        | "incomplete-order"
        | "invalid-id"
        | "missing-root"
        | "pinned-boundary"
        | "same-root";
    };

export function applyFamilyOrder(
  families: readonly ThreadFamily[],
  storedRootIds: readonly string[] | undefined,
): ThreadFamily[] {
  if (storedRootIds === undefined || !validStoredIds(storedRootIds)) {
    return [...families];
  }
  const rank = new Map(storedRootIds.map((id, index) => [id, index]));
  const orderedPartition = (partition: readonly ThreadFamily[]) =>
    [...partition].sort((left, right) => {
      const leftRank = rank.get(left.root.id);
      const rightRank = rank.get(right.root.id);
      if (leftRank !== undefined || rightRank !== undefined) {
        return (
          (leftRank ?? storedRootIds.length + families.indexOf(left)) -
          (rightRank ?? storedRootIds.length + families.indexOf(right))
        );
      }
      return families.indexOf(left) - families.indexOf(right);
    });
  const pinned = families.filter((family) => family.root.isPinned);
  const unpinned = families.filter((family) => !family.root.isPinned);
  return [...orderedPartition(pinned), ...orderedPartition(unpinned)];
}

export function moveProjectFamily({
  projectId,
  sourceProjectId,
  targetProjectId,
  rootIds,
  pinnedRootIds,
  sourceRootId,
  targetRootId,
  position,
}: {
  projectId: string;
  sourceProjectId: string;
  targetProjectId: string;
  rootIds: readonly string[];
  pinnedRootIds: readonly string[];
  sourceRootId: string;
  targetRootId: string;
  position: "before" | "after";
}): FamilyMoveResult {
  if (sourceProjectId !== projectId || targetProjectId !== projectId) {
    return { ok: false, reason: "cross-project" };
  }
  if (![projectId, sourceRootId, targetRootId].every(validId)) {
    return { ok: false, reason: "invalid-id" };
  }
  if (sourceRootId === targetRootId) return { ok: false, reason: "same-root" };
  if (!validExactOrder(rootIds) || !validPinnedPartition(rootIds, pinnedRootIds)) {
    return { ok: false, reason: "incomplete-order" };
  }
  const sourceIndex = rootIds.indexOf(sourceRootId);
  const targetIndex = rootIds.indexOf(targetRootId);
  if (sourceIndex < 0 || targetIndex < 0) {
    return { ok: false, reason: "missing-root" };
  }
  const pinned = new Set(pinnedRootIds);
  if (pinned.has(sourceRootId) !== pinned.has(targetRootId)) {
    return { ok: false, reason: "pinned-boundary" };
  }
  const order = [...rootIds];
  order.splice(sourceIndex, 1);
  const currentTargetIndex = order.indexOf(targetRootId);
  order.splice(currentTargetIndex + (position === "after" ? 1 : 0), 0, sourceRootId);
  return { ok: true, order };
}

export function keyboardFamilyMove(
  projectId: string,
  rootIds: readonly string[],
  pinnedRootIds: readonly string[],
  sourceRootId: string,
  delta: -1 | 1,
): FamilyMoveResult {
  const sourceIndex = rootIds.indexOf(sourceRootId);
  if (sourceIndex < 0) return { ok: false, reason: "missing-root" };
  const targetRootId = rootIds[sourceIndex + delta];
  if (targetRootId === undefined) return { ok: false, reason: "missing-root" };
  return moveProjectFamily({
    projectId,
    sourceProjectId: projectId,
    targetProjectId: projectId,
    rootIds,
    pinnedRootIds,
    sourceRootId,
    targetRootId,
    position: delta < 0 ? "before" : "after",
  });
}

function validExactOrder(ids: readonly string[]): boolean {
  return (
    ids.length <= MAX_ORDER_ROOTS &&
    ids.every(validId) &&
    new Set(ids).size === ids.length
  );
}

function validStoredIds(ids: readonly string[]): boolean {
  return validExactOrder(ids);
}

function validPinnedPartition(
  rootIds: readonly string[],
  pinnedRootIds: readonly string[],
): boolean {
  if (!validExactOrder(pinnedRootIds)) return false;
  const pinned = new Set(pinnedRootIds);
  if (pinnedRootIds.some((id) => !rootIds.includes(id))) return false;
  return rootIds.every(
    (id, index) => (index < pinnedRootIds.length) === pinned.has(id),
  );
}

function validId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    value.trim() === value &&
    SAFE_ID.test(value)
  );
}
