import type { ProjectThreadGroup } from "./inbox.ts";

export const PROJECT_ORDER_STORAGE_KEY = "bb.nest.project-order.v1";
export const MAX_ORDERED_PROJECTS = 100;
const MAX_ID_LENGTH = 200;
const SAFE_ID = /^[^\u0000-\u001F\u007F]+$/;

export interface ProjectOrderStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export type ProjectMoveResult =
  | { ok: true; order: string[] }
  | { ok: false; reason: "incomplete-order" | "invalid-id" | "missing-project" | "same-project" };

export function decodeProjectOrder(raw: string | null): string[] {
  if (raw === null || raw.length > 32_000) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !validOrder(parsed)) return [];
    return [...parsed];
  } catch {
    return [];
  }
}

export function readProjectOrder(
  storage: ProjectOrderStorage | null = browserStorage(),
): string[] {
  if (storage === null) return [];
  try {
    return decodeProjectOrder(storage.getItem(PROJECT_ORDER_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function writeProjectOrder(
  order: readonly string[],
  storage: ProjectOrderStorage | null = browserStorage(),
): boolean {
  if (storage === null || !validOrder(order)) return false;
  try {
    storage.setItem(PROJECT_ORDER_STORAGE_KEY, JSON.stringify(order));
    return true;
  } catch {
    return false;
  }
}

/**
 * Drop the legacy browser-local order once it has been migrated to the server.
 * Best-effort: a browser that refuses storage simply keeps a stale copy that
 * nothing reads any more.
 */
export function clearProjectOrder(
  storage: ProjectOrderStorage | null = browserStorage(),
): void {
  if (storage === null) return;
  try {
    storage.removeItem?.(PROJECT_ORDER_STORAGE_KEY);
  } catch {
    // Nothing to do; the server copy is already authoritative.
  }
}

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

function browserStorage(): ProjectOrderStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
