/**
 * The sidebar's remembered view.
 *
 * bb restores the route — which thread is open — but nothing about the shape
 * the user left the tree in. Without this, every launch drops the user back on
 * "All" with every group and project expanded, which is the one thing a
 * project-first sidebar must not do: the tree is the user's filing system, and
 * a filing system that forgets where you were is worse than no nesting at all.
 *
 * Only the user's own choices are stored, never derived state. A project with
 * no entry is expanded; a workspace with no entry is collapsed; a thread family
 * with no entry falls back to the preference default. That keeps the store
 * small, and it means a preference change still applies to everything the user
 * has not touched by hand.
 */

import {
  THREAD_FILTER_PRESETS,
  type ThreadFilterPreset,
} from "./thread-management.ts";
import type { GroupScope } from "./groups.ts";

export const VIEW_STATE_STORAGE_KEY = "bb.nest.view-state.v1";
export const ALL_SCOPE_KEY = "__all__";
export const UNGROUPED_SCOPE_KEY = "__ungrouped__";

const MAX_IDS = 2_000;
const MAX_ID_LENGTH = 200;
const MAX_RAW_LENGTH = 512_000;
const SAFE_ID = /^[^\u0000-\u001F\u007F]+$/;

export interface NestViewState {
  /** `groupScopeKey` of the selected scope. */
  readonly scope: string;
  readonly filter: ThreadFilterPreset;
  /** Group ids the user collapsed. Ungrouped uses its own sentinel key. */
  readonly collapsedGroups: readonly string[];
  readonly collapsedProjects: readonly string[];
  /** Workspace keys the user opened; collapsed is the default. */
  readonly expandedWorkspaces: readonly string[];
  /** Thread families the user expanded or collapsed against the default. */
  readonly expandedFamilies: readonly string[];
  readonly collapsedFamilies: readonly string[];
  /**
   * Projects whose archived shelf the user turned on.
   *
   * Per project rather than global, and per browser rather than on the server,
   * because it is a view choice about one project's list — the same kind of thing
   * as which of its worktrees are folded. The archive itself is bb's, and this
   * does not touch it.
   */
  readonly archivedProjects: readonly string[];
  readonly snoozedOpen: boolean;
  readonly settledOpen: boolean;
}

export interface ViewStateStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function defaultViewState(): NestViewState {
  return {
    scope: ALL_SCOPE_KEY,
    filter: "all",
    collapsedGroups: [],
    collapsedProjects: [],
    expandedWorkspaces: [],
    expandedFamilies: [],
    collapsedFamilies: [],
    archivedProjects: [],
    snoozedOpen: false,
    settledOpen: false,
  };
}

function validId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    SAFE_ID.test(value)
  );
}

/**
 * One stored id list, or the empty list.
 *
 * Missing is normal — a record written before a field existed simply has no
 * entry for it — and so is a list this build cannot use. Both mean the same
 * thing to the caller: nothing was remembered here, so the row's own default
 * applies. Falling back per field rather than discarding the whole record is
 * what keeps a stale file from silently resetting a view the user still has.
 */
function readIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_IDS) return [];
  if (!value.every(validId)) return [];
  return [...new Set(value)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function decodeViewState(raw: string | null): NestViewState {
  const fallback = defaultViewState();
  if (raw === null || raw.length > MAX_RAW_LENGTH) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (!isRecord(parsed) || parsed.version !== 1) return fallback;

  const collapsedFamilies = readIds(parsed.collapsedFamilies);
  const expandedFamilies = readIds(parsed.expandedFamilies).filter(
    (id) => !collapsedFamilies.includes(id),
  );

  const filter = THREAD_FILTER_PRESETS.includes(
    parsed.filter as ThreadFilterPreset,
  )
    ? (parsed.filter as ThreadFilterPreset)
    : fallback.filter;

  return {
    scope: validId(parsed.scope) ? parsed.scope : fallback.scope,
    filter,
    collapsedGroups: readIds(parsed.collapsedGroups),
    collapsedProjects: readIds(parsed.collapsedProjects),
    expandedWorkspaces: readIds(parsed.expandedWorkspaces),
    // A family the user both expanded and collapsed is contradictory; the
    // collapse wins, because hiding something by accident is recoverable and
    // showing something the user put away is the worse surprise.
    expandedFamilies,
    collapsedFamilies,
    // A project whose shelf the user turned on, and which this build no longer
    // knows, simply stops being drawn: the read is per field, like every other
    // list here.
    archivedProjects: readIds(parsed.archivedProjects),
    snoozedOpen: parsed.snoozedOpen === true,
    settledOpen: parsed.settledOpen === true,
  };
}

export function readViewState(
  storage: ViewStateStorage | null = browserStorage(),
): NestViewState {
  if (storage === null) return defaultViewState();
  try {
    return decodeViewState(storage.getItem(VIEW_STATE_STORAGE_KEY));
  } catch {
    return defaultViewState();
  }
}

export function writeViewState(
  state: NestViewState,
  storage: ViewStateStorage | null = browserStorage(),
): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(
      VIEW_STATE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        scope: state.scope,
        filter: state.filter,
        collapsedGroups: [...state.collapsedGroups],
        collapsedProjects: [...state.collapsedProjects],
        expandedWorkspaces: [...state.expandedWorkspaces],
        expandedFamilies: [...state.expandedFamilies],
        collapsedFamilies: [...state.collapsedFamilies],
        archivedProjects: [...state.archivedProjects],
        snoozedOpen: state.snoozedOpen,
        settledOpen: state.settledOpen,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

/** Add or remove one id from a stored list, preserving the existing order. */
/**
 * Every key a worktree row has to be cleared under to be folded away.
 *
 * A row answers to its own key and to each environment id it was once known by
 * — `workspaceRefOf` reads both, because workspaces were identified by
 * environment before they were identified by path. Folding therefore has to
 * write both: clearing only the current key left a row expanded under an older
 * one expanded for good, which is a disclosure that no longer responds to being
 * clicked at all.
 */
export function workspaceExpansionKeys(ref: {
  readonly key: string;
  readonly environmentIds: readonly string[];
}): string[] {
  return [ref.key, ...ref.environmentIds];
}

/**
 * The expansion list after folding or unfolding one worktree.
 *
 * One list, because the caller has one write: `patchViewState` builds each patch
 * from the state in its closure, so a second call in the same tick would be
 * built from the state before the first and silently drop it.
 */
export function foldWorkspaceExpansion(
  ids: readonly string[],
  keys: readonly string[],
  openKey: string,
  expanded: boolean,
): string[] {
  return keys.reduce<string[]>(
    (current, key) => withId(current, key, expanded && key === openKey),
    [...ids],
  );
}

export function withId(
  ids: readonly string[],
  id: string,
  present: boolean,
): string[] {
  if (!validId(id)) return [...ids];
  const has = ids.includes(id);
  if (present === has) return [...ids];
  return present ? [...ids, id] : ids.filter((value) => value !== id);
}

/**
 * The stored scope, checked against the groups that exist right now.
 *
 * A scope naming a group the user has since deleted would otherwise select an
 * empty tree with no visible cause, so it degrades to "All" instead.
 */
export function resolveGroupScope(
  key: string,
  validGroupIds: ReadonlySet<string>,
): GroupScope {
  if (key === UNGROUPED_SCOPE_KEY) return { kind: "ungrouped" };
  if (key !== ALL_SCOPE_KEY && validGroupIds.has(key)) {
    return { kind: "group", groupId: key };
  }
  return { kind: "all" };
}

function browserStorage(): ViewStateStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
