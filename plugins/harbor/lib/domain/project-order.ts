import type { ProjectThreadGroup } from "./inbox.ts";

export const MAX_ORDERED_PROJECTS = 100;
const MAX_ID_LENGTH = 200;
const SAFE_ID = /^[^\u0000-\u001F\u007F]+$/;

export type ProjectMoveResult =
  | { ok: true; order: string[] }
  | { ok: false; reason: "incomplete-order" | "invalid-id" | "missing-project" | "same-project" };

export function applyProjectOrder(
  groups: readonly ProjectThreadGroup[],
  storedProjectIds: readonly string[],
): ProjectThreadGroup[] {
  if (!validOrder(storedProjectIds)) return [...groups];
  const rank = new Map(storedProjectIds.map((id, index) => [id, index]));
  return [...groups].sort((left, right) => {
    const leftRank = rank.get(left.project.id);
    const rightRank = rank.get(right.project.id);
    if (leftRank !== undefined || rightRank !== undefined) {
      return (
        (leftRank ?? storedProjectIds.length + groups.indexOf(left)) -
        (rightRank ?? storedProjectIds.length + groups.indexOf(right))
      );
    }
    return groups.indexOf(left) - groups.indexOf(right);
  });
}

export function moveProject({
  projectIds,
  sourceProjectId,
  targetProjectId,
  position,
}: {
  projectIds: readonly string[];
  sourceProjectId: string;
  targetProjectId: string;
  position: "before" | "after";
}): ProjectMoveResult {
  if (![sourceProjectId, targetProjectId].every(validId)) {
    return { ok: false, reason: "invalid-id" };
  }
  if (sourceProjectId === targetProjectId) {
    return { ok: false, reason: "same-project" };
  }
  if (!validOrder(projectIds)) return { ok: false, reason: "incomplete-order" };
  const sourceIndex = projectIds.indexOf(sourceProjectId);
  const targetIndex = projectIds.indexOf(targetProjectId);
  if (sourceIndex < 0 || targetIndex < 0) {
    return { ok: false, reason: "missing-project" };
  }
  const order = [...projectIds];
  order.splice(sourceIndex, 1);
  const currentTargetIndex = order.indexOf(targetProjectId);
  order.splice(currentTargetIndex + (position === "after" ? 1 : 0), 0, sourceProjectId);
  return { ok: true, order };
}

export function keyboardProjectMove(
  projectIds: readonly string[],
  sourceProjectId: string,
  delta: -1 | 1,
): ProjectMoveResult {
  const index = projectIds.indexOf(sourceProjectId);
  if (index < 0) return { ok: false, reason: "missing-project" };
  const targetProjectId = projectIds[index + delta];
  if (targetProjectId === undefined) return { ok: false, reason: "missing-project" };
  return moveProject({
    projectIds,
    sourceProjectId,
    targetProjectId,
    position: delta < 0 ? "before" : "after",
  });
}

function validOrder(value: readonly unknown[]): value is readonly string[] {
  return (
    value.length <= MAX_ORDERED_PROJECTS &&
    value.every((id): id is string => typeof id === "string" && validId(id)) &&
    new Set(value).size === value.length
  );
}

function validId(value: string): boolean {
  return value.length > 0 && value.length <= MAX_ID_LENGTH && value.trim() === value && SAFE_ID.test(value);
}
