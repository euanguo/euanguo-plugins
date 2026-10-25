/**
 * The decode boundary for every store that persists its last good answer.
 *
 * `store-snapshot.ts` holds the tiers and the rules; this file holds the part
 * that has to know what the data means. Each codec mirrors the RPC output
 * schema it was written against — the same shape, the same limits — because the
 * string it reads came out of `localStorage`, which the user and every other
 * script on the origin can write.
 *
 * One bad entry rejects the whole payload rather than being dropped from it.
 * That is the precedent `warm-start.ts` set and the reason is the same: a
 * half-accepted record is a first frame that is neither the user's arrangement
 * nor an honest empty one, and it is harder to reason about than a miss. A miss
 * costs one round trip of the default arrangement, which is the bug these
 * codecs exist to shrink, not a new failure mode.
 *
 * Every decoder returns `null` for anything it does not fully recognise and
 * never throws. `null` is a miss, which is not the same as an empty value: a
 * user with no groups, no manual order, or no colour overrides has a real
 * record that happens to be empty, and discarding it would send them back to a
 * cold frame on every start.
 */

import {
  MAX_GROUPS,
  validGroupId,
  validGroupName,
  type GroupAssignment,
  type ProjectGroup,
} from "./groups.ts";
import {
  canonicalGroupIcon,
  validGroupIcon,
  type GroupIconName,
} from "./group-icons.ts";
import { SCOPE_ICON_SCOPES, type ScopeIcons } from "./group-scope-icons.ts";
import {
  MAX_ORDER_ID_LENGTH,
  validOrderMap,
  type ManualOrderMap,
} from "./manual-order.ts";
import {
  validOrganizationMode,
  type OrganizationMode,
} from "./organization.ts";
import {
  validProjectSort,
  validThreadSort,
  validWorktreeSort,
  type ProjectSortMode,
  type ThreadSortMode,
  type WorktreeSortMode,
} from "./sort-modes.ts";
import type {
  WorkspaceEnvironmentDescriptor,
  WorkspacePaths,
  WorkspaceProjectDescriptor,
} from "./workspace.ts";
import type { StoreSnapshotCodec } from "./store-snapshot.ts";

export interface GroupsSnapshot {
  readonly groups: readonly ProjectGroup[];
  readonly assignment: GroupAssignment;
  readonly icons: ScopeIcons;
}

export interface OrderSnapshot {
  readonly projects: ManualOrderMap;
  readonly families: ManualOrderMap;
  readonly workspaces: ManualOrderMap;
}

export interface ViewPreferencesSnapshot {
  readonly projectSort: ProjectSortMode;
  readonly threadSort: ThreadSortMode;
  readonly worktreeSort: WorktreeSortMode;
  readonly organizationMode: OrganizationMode;
}

/**
 * How many projects may carry an assignment, and how many environments and
 * projects the path map may hold. Loose next to what a real account reaches —
 * these are here so a hand-written payload cannot make the first frame do
 * unbounded work, not to second-guess the server.
 */
const MAX_ASSIGNMENT_ENTRIES = 1_000;
const MAX_WORKSPACE_ENTRIES = 2_000;

const SAFE_ID = /^[^\u0000-\u001F\u007F]+$/;

/**
 * `JSON.parse` materialises `__proto__` as an own key, but assigning it back
 * goes through the inherited setter instead of creating a key — so a rebuild
 * would silently drop that entry and hand back a record that is not what was
 * stored. Nothing legitimate is ever named this.
 */
const RESERVED_KEY = "__proto__";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ORDER_ID_LENGTH &&
    value.trim() === value &&
    SAFE_ID.test(value)
  );
}

/** A stored string that must be present and non-empty, like an id or a host. */
function requiredString(value: unknown): string | null {
  return validId(value) ? value : null;
}

/** A stored string that may legitimately be absent; undefined means invalid. */
function optionalString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

function decodeGroup(value: unknown): ProjectGroup | null {
  if (!isRecord(value)) return null;
  const { id, name, icon, position } = value;
  if (!validGroupId(id)) return null;
  if (!validGroupName(name)) return null;
  if (!validGroupIcon(icon)) return null;
  if (typeof position !== "number" || !Number.isFinite(position)) return null;
  return { id, name, icon: canonicalGroupIcon(icon), position };
}

function decodeAssignment(value: unknown): GroupAssignment | null {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > MAX_ASSIGNMENT_ENTRIES) return null;
  const assignment: Record<string, string> = {};
  for (const [projectId, groupId] of entries) {
    if (projectId === RESERVED_KEY) return null;
    if (!validId(projectId)) return null;
    if (!validGroupId(groupId)) return null;
    assignment[projectId] = groupId;
  }
  return assignment;
}

/**
 * The strip's two tabs, built by name rather than by loop.
 *
 * `ScopeIcons` is a record over exactly the scopes in `SCOPE_ICON_SCOPES`, so
 * naming them here makes a third scope a compile error instead of a silently
 * missing tab. The loop is what checks the stored payload, so the constant
 * stays the one list of scopes the read and the build agree on.
 */
function decodeScopeIcons(value: unknown): ScopeIcons | null {
  if (!isRecord(value)) return null;
  for (const scope of SCOPE_ICON_SCOPES) {
    if (!validGroupIcon(value[scope])) return null;
  }
  const icons: Record<string, GroupIconName> = {};
  for (const scope of SCOPE_ICON_SCOPES) {
    icons[scope] = canonicalGroupIcon(value[scope]);
  }
  return {
    all: icons.all,
    ungrouped: icons.ungrouped,
  };
}

export const GROUPS_SNAPSHOT_CODEC: StoreSnapshotCodec<GroupsSnapshot> = {
  encode: (value) =>
    JSON.stringify({
      groups: value.groups.map(({ id, name, icon, position }) => ({
        id,
        name,
        icon,
        position,
      })),
      assignment: { ...value.assignment },
      icons: { all: value.icons.all, ungrouped: value.icons.ungrouped },
    }),
  decode: (stored) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(stored);
    } catch {
      return null;
    }
    if (!isRecord(parsed)) return null;
    if (!Array.isArray(parsed.groups)) return null;
    if (parsed.groups.length > MAX_GROUPS) return null;
    const groups: ProjectGroup[] = [];
    for (const entry of parsed.groups) {
      const group = decodeGroup(entry);
      if (group === null) return null;
      groups.push(group);
    }
    const assignment = decodeAssignment(parsed.assignment);
    if (assignment === null) return null;
    const icons = decodeScopeIcons(parsed.icons);
    if (icons === null) return null;
    return { groups, assignment, icons };
  },
};

/** One scope's list, or null when this build cannot use it. */
function decodeOrderMap(value: unknown): ManualOrderMap | null {
  if (!validOrderMap(value)) return null;
  const map: Record<string, readonly string[]> = {};
  for (const [scopeId, items] of Object.entries(value)) {
    if (scopeId === RESERVED_KEY) return null;
    map[scopeId] = [...items];
  }
  return map;
}

export const ORDER_SNAPSHOT_CODEC: StoreSnapshotCodec<OrderSnapshot> = {
  encode: (value) =>
    JSON.stringify({
      projects: value.projects,
      families: value.families,
      workspaces: value.workspaces,
    }),
  decode: (stored) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(stored);
    } catch {
      return null;
    }
    if (!isRecord(parsed)) return null;
    const projects = decodeOrderMap(parsed.projects);
    const families = decodeOrderMap(parsed.families);
    const workspaces = decodeOrderMap(parsed.workspaces);
    if (projects === null || families === null || workspaces === null) {
      return null;
    }
    return { projects, families, workspaces };
  },
};

export const VIEW_PREFERENCES_SNAPSHOT_CODEC: StoreSnapshotCodec<ViewPreferencesSnapshot> =
  {
    encode: (value) =>
      JSON.stringify({
        projectSort: value.projectSort,
        threadSort: value.threadSort,
        worktreeSort: value.worktreeSort,
        organizationMode: value.organizationMode,
      }),
    decode: (stored) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(stored);
      } catch {
        return null;
      }
      if (!isRecord(parsed)) return null;
      if (!validProjectSort(parsed.projectSort)) return null;
      if (!validThreadSort(parsed.threadSort)) return null;
      if (!validWorktreeSort(parsed.worktreeSort)) return null;
      if (!validOrganizationMode(parsed.organizationMode)) return null;
      return {
        projectSort: parsed.projectSort,
        threadSort: parsed.threadSort,
        worktreeSort: parsed.worktreeSort,
        organizationMode: parsed.organizationMode,
      };
    },
  };

const WORKSPACE_DISPLAY_KINDS = [
  "managed-worktree",
  "unmanaged-worktree",
  "other",
] as const;

function decodeWorkspaceDisplayKind(
  value: unknown,
): WorkspaceEnvironmentDescriptor["workspaceDisplayKind"] | undefined {
  if (value === null) return null;
  return typeof value === "string" &&
    (WORKSPACE_DISPLAY_KINDS as readonly string[]).includes(value)
    ? (value as WorkspaceEnvironmentDescriptor["workspaceDisplayKind"])
    : undefined;
}

function decodeEnvironment(
  value: unknown,
): WorkspaceEnvironmentDescriptor | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const projectId = requiredString(value.projectId);
  const hostId = requiredString(value.hostId);
  if (id === null || projectId === null || hostId === null) return null;
  const path = optionalString(value.path);
  const branchName = optionalString(value.branchName);
  const name = optionalString(value.name);
  const providerId = optionalString(value.providerId);
  const displayKind = decodeWorkspaceDisplayKind(value.workspaceDisplayKind);
  if (
    path === undefined ||
    branchName === undefined ||
    name === undefined ||
    providerId === undefined ||
    displayKind === undefined
  ) {
    return null;
  }
  if (typeof value.isGitRepo !== "boolean") return null;
  if (typeof value.isWorktree !== "boolean") return null;
  return {
    id,
    projectId,
    hostId,
    path,
    isGitRepo: value.isGitRepo,
    isWorktree: value.isWorktree,
    branchName,
    name,
    providerId,
    workspaceDisplayKind: displayKind,
  };
}

function decodeWorkspaceProject(
  value: unknown,
): WorkspaceProjectDescriptor | null {
  if (!isRecord(value)) return null;
  const projectId = requiredString(value.projectId);
  if (projectId === null) return null;
  const sourcePath = optionalString(value.sourcePath);
  const sourceHostId = optionalString(value.sourceHostId);
  if (sourcePath === undefined || sourceHostId === undefined) return null;
  return { projectId, sourcePath, sourceHostId };
}

/**
 * A record keyed by an id, with each entry required to agree with the key.
 *
 * The two must match because the consumers index by the id — `environments.get(
 * descriptor.id)` — so a record whose key is something else is a lookup that
 * silently misses. Rebuilding rather than returning the parsed object is also
 * what strips any field a newer build added and this one does not know.
 */
function decodeKeyed<T>(
  value: unknown,
  keyOf: (decoded: T) => string,
  decodeOne: (entry: unknown) => T | null,
): Readonly<Record<string, T>> | null {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > MAX_WORKSPACE_ENTRIES) return null;
  const decoded: Record<string, T> = {};
  for (const [key, entry] of entries) {
    if (key === RESERVED_KEY) return null;
    const one = decodeOne(entry);
    if (one === null) return null;
    if (keyOf(one) !== key) return null;
    decoded[key] = one;
  }
  return decoded;
}

export const WORKSPACE_PATHS_SNAPSHOT_CODEC: StoreSnapshotCodec<WorkspacePaths> = {
  encode: (value) =>
    JSON.stringify({
      environments: value.environments,
      projects: value.projects,
    }),
  decode: (stored) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(stored);
    } catch {
      return null;
    }
    if (!isRecord(parsed)) return null;
    const environments = decodeKeyed(
      parsed.environments,
      (entry: WorkspaceEnvironmentDescriptor) => entry.id,
      decodeEnvironment,
    );
    if (environments === null) return null;
    const projects = decodeKeyed(
      parsed.projects,
      (entry: WorkspaceProjectDescriptor) => entry.projectId,
      decodeWorkspaceProject,
    );
    if (projects === null) return null;
    return { environments, projects };
  },
};
