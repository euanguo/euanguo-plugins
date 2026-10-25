import type { ThreadFamily } from "./inbox.ts";

export const FAMILY_ORDER_STORAGE_KEY = "bb.nest.family-order.v1";
export const MAX_ORDER_PROJECTS = 100;
export const MAX_ORDER_ROOTS = 500;
const MAX_ID_LENGTH = 200;
const SAFE_ID = /^[^\u0000-\u001F\u007F]+$/;

export type FamilyOrderState = Readonly<Record<string, readonly string[]>>;

export interface FamilyOrderStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

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

export function decodeFamilyOrder(raw: string | null): FamilyOrderState {
  if (raw === null || raw.length > 256_000) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.projects)) {
      return {};
    }
    const entries = Object.entries(parsed.projects);
    if (entries.length > MAX_ORDER_PROJECTS) return {};
    const projects: Record<string, string[]> = {};
    for (const [projectId, value] of entries) {
      if (!validId(projectId) || !Array.isArray(value) || value.length > MAX_ORDER_ROOTS) {
        return {};
      }
      if (!value.every((id): id is string => typeof id === "string" && validId(id))) {
        return {};
      }
      if (new Set(value).size !== value.length) return {};
      projects[projectId] = [...value];
    }
    return projects;
  } catch {
    return {};
  }
}

export function readFamilyOrder(
  storage: FamilyOrderStorage | null = browserStorage(),
): FamilyOrderState {
  if (storage === null) return {};
  try {
    return decodeFamilyOrder(storage.getItem(FAMILY_ORDER_STORAGE_KEY));
  } catch {
    return {};
  }
}

export function writeFamilyOrder(
  order: FamilyOrderState,
  storage: FamilyOrderStorage | null = browserStorage(),
): boolean {
  if (storage === null) return false;
  const normalized = normalizeState(order);
  if (normalized === null) return false;
  try {
    storage.setItem(
      FAMILY_ORDER_STORAGE_KEY,
      JSON.stringify({ version: 1, projects: normalized }),
    );
    return true;
  } catch {
    return false;
  }
}

/** Drop the legacy browser-local order once it has been migrated to the server. */
export function clearFamilyOrder(
  storage: FamilyOrderStorage | null = browserStorage(),
): void {
  if (storage === null) return;
  try {
    storage.removeItem?.(FAMILY_ORDER_STORAGE_KEY);
  } catch {
    // Nothing to do; the server copy is already authoritative.
  }
}

export function withProjectFamilyOrder(
  order: FamilyOrderState,
  projectId: string,
  rootIds: readonly string[],
): FamilyOrderState | null {
  if (!validId(projectId) || !validExactOrder(rootIds)) return null;
  const next = { ...order, [projectId]: [...rootIds] };
  return normalizeState(next);
}

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

function normalizeState(order: FamilyOrderState): Record<string, string[]> | null {
  const entries = Object.entries(order);
  if (entries.length > MAX_ORDER_PROJECTS) return null;
  const normalized: Record<string, string[]> = {};
  for (const [projectId, rootIds] of entries) {
    if (!validId(projectId) || !validExactOrder(rootIds)) return null;
    normalized[projectId] = [...rootIds];
  }
  return normalized;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function browserStorage(): FamilyOrderStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
