/**
 * The manual arrangement, as a per-scope map.
 *
 * One scope is one list: a group holds its projects, a project holds its root
 * threads, and a project also holds its worktrees. Storing it per scope rather
 * than as one global list is what makes "move a project inside its group" a
 * local write — and it is the shape the tree already has
 * (`group -> project -> workspace -> thread`).
 *
 * This module is shared by the server store and the frontend hook, so it stays
 * free of any SDK or inbox type. `UNGROUPED_ORDER_SCOPE` mirrors
 * `UNGROUPED_SCOPE_KEY` in `view-state.ts`; a test pins the two together rather
 * than importing the frontend view state into the server bundle.
 */

/** The scope key for projects that belong to no group. */
export const UNGROUPED_ORDER_SCOPE = "__ungrouped__";

export const MAX_ORDER_SCOPES = 200;
export const MAX_ORDER_ITEMS = 500;
export const MAX_ORDER_ID_LENGTH = 200;
const SAFE_ID = /^[^\u0000-\u001F\u007F]+$/;

export type ManualOrderMap = Readonly<Record<string, readonly string[]>>;

export interface ManualOrder {
  /** Group scope key -> project ids. */
  readonly projects: ManualOrderMap;
  /** Project id -> root thread ids. */
  readonly families: ManualOrderMap;
  /** Project id -> worktree keys, in the order they are drawn. */
  readonly workspaces: ManualOrderMap;
}

export const EMPTY_MANUAL_ORDER: ManualOrder = {
  projects: {},
  families: {},
  workspaces: {},
};

export function validOrderId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ORDER_ID_LENGTH &&
    value.trim() === value &&
    SAFE_ID.test(value)
  );
}

/** One scope's list: bounded, every id valid, no duplicates. */
export function validOrderItems(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_ORDER_ITEMS &&
    value.every(validOrderId) &&
    new Set(value).size === value.length
  );
}

export function validOrderMap(value: unknown): value is ManualOrderMap {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_ORDER_SCOPES) return false;
  return entries.every(
    ([scopeId, items]) => validOrderId(scopeId) && validOrderItems(items),
  );
}

export function emptyOrderMap(): Record<string, string[]> {
  return {};
}

/**
 * The stored JSON column. Returns null for anything this build cannot use, so
 * the caller falls back to the default order rather than drawing a half-read
 * arrangement.
 */
export function parseItemIds(raw: string | null): string[] | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return validOrderItems(parsed) ? [...parsed] : null;
  } catch {
    return null;
  }
}

export function serializeItemIds(ids: readonly string[]): string {
  return JSON.stringify([...ids]);
}

/** Copy only the scopes that validate, so one bad key cannot drop the rest. */
export function normalizeOrderMap(value: unknown): Record<string, string[]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const normalized: Record<string, string[]> = {};
  let count = 0;
  for (const [scopeId, items] of Object.entries(value)) {
    if (count >= MAX_ORDER_SCOPES) break;
    if (!validOrderId(scopeId) || !validOrderItems(items)) continue;
    normalized[scopeId] = [...items];
    count += 1;
  }
  return normalized;
}
