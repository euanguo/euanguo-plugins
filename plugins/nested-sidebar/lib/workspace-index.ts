/**
 * One derived table of workspaces.
 *
 * bb owns environments, projects, and threads. Everything the sidebar draws
 * about a workspace is a projection of those records plus what the disk says
 * about paths, so this module builds that projection once and every view reads
 * it. Nothing here is stored.
 *
 * The identity is the physical directory, `ws:<hostId>:<path>`. Project is
 * ownership metadata, not identity: a project claim can change, and when it
 * did the old key moved the user's order and expansion with it. A directory
 * with several environment records becomes one workspace with several records,
 * and a worktree the repository knows but bb does not is a workspace with no
 * record at all.
 */

import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

import { featureOfWorkspace, isFeatureRoot, type Feature, type FeatureAssignment } from "./features.ts";
import type { RepoIdentity } from "./repo-identity.ts";
import {
  workspaceRefOfEnvironment,
  workspaceSortOrder,
  normalizeWorkspacePath,
  type WorkspaceEnvironmentDescriptor,
  type WorkspaceKind,
  type WorkspaceProjectDescriptor,
  type WorkspaceRef,
} from "./workspace.ts";
import type {
  UnseenOwnedWorkspace,
  WorkspaceOwnershipMap,
} from "./workspace-ownership.ts";

/** The personal bucket every thread without a workspace lands in. */
export const NO_WORKSPACE_KEY = "__no_workspace__";

export function physicalWorkspaceKey(hostId: string, path: string): string {
  return `ws:${hostId}:${normalizeWorkspacePath(path) ?? path}`;
}

function environmentKey(environmentId: string): string {
  return `environment:${environmentId}`;
}

/** One bb environment pointing at a directory. Never the identity itself. */
export interface WorkspaceRecord {
  readonly environmentId: string;
  readonly claimedProjectId: string;
  readonly providerId: string | null;
  readonly name: string | null;
  readonly branchName: string | null;
  readonly isWorktree: boolean;
}

/**
 * A workspace as every view draws it.
 *
 * Extends the older `WorkspaceRef` shape so the rows, the label rules, and the
 * worktree arrangement keep reading the fields they already read. The fields
 * below it are the ones this module adds: who owns the directory, which
 * feature contains it, and which other workspaces sit inside it.
 */
export interface Workspace extends WorkspaceRef {
  /** The derived owner, with bb's claim as the fallback. */
  readonly projectId: string;
  /** Every project record that points at this directory. */
  readonly claimedProjectIds: readonly string[];
  readonly conflict: boolean;
  readonly repoKey: string | null;
  /** The feature root workspace that contains this one, by path. */
  readonly parentKey: string | null;
  readonly childKeys: readonly string[];
  readonly featureId: string | null;
  /** True when no bb environment points at the directory. */
  readonly unseen: boolean;
  /** Keys this workspace answered to before the physical key. */
  readonly legacyKeys: readonly string[];
  readonly records: readonly WorkspaceRecord[];
  /** The record bb will accept for the derived owner, or null. */
  readonly canonicalEnvironmentId: string | null;
  /** True when a bb record exists that can launch work here. */
  readonly launchable: boolean;
}

export interface WorkspaceIndex {
  readonly list: readonly Workspace[];
  /** Workspaces no other feature root contains. */
  readonly roots: readonly Workspace[];
  readonly byKey: ReadonlyMap<string, Workspace>;
  readonly byEnvironmentId: ReadonlyMap<string, string>;
  readonly byProject: ReadonlyMap<string, readonly Workspace[]>;
  readonly byPath: ReadonlyMap<string, Workspace>;
  readonly byFeature: ReadonlyMap<string, readonly Workspace[]>;
  /**
   * featureId -> the feature's name, for every feature the index was given.
   *
   * A member worktree carries only its feature's id, and the feature folder
   * itself is a workspace only once something has run there. The name has to
   * come from the feature record, not from the root workspace's label.
   */
  readonly featureNames: ReadonlyMap<string, string>;
  childrenOf: (key: string) => readonly Workspace[];
  /** The workspace a thread runs in, or null when it has none. */
  workspaceOfThread: (thread: PluginSidebarThread) => Workspace | null;
  /** A stored key from before the physical key, mapped forward. */
  migrateKey: (key: string) => string;
}

export interface WorkspaceIndexInput {
  readonly environments: Readonly<Record<string, WorkspaceEnvironmentDescriptor>>;
  readonly projects: Readonly<Record<string, WorkspaceProjectDescriptor>>;
  readonly ownership?: WorkspaceOwnershipMap;
  readonly repos?: readonly RepoIdentity[];
  readonly unseenWorkspaces?: Readonly<Record<string, readonly UnseenOwnedWorkspace[]>>;
  readonly features?: readonly Feature[];
  readonly adoptions?: FeatureAssignment;
}

export function buildWorkspaceIndex(input: WorkspaceIndexInput): WorkspaceIndex {
  const projects = new Map(Object.entries(input.projects));
  const byKey = new Map<string, Workspace>();
  const byEnvironmentId = new Map<string, string>();
  const legacy = new Map<string, string>();
  const records = new Map<string, WorkspaceRecord[]>();
  const claimed = new Map<string, Set<string>>();
  const legacyKeys = new Map<string, Set<string>>();

  const remember = (
    key: string,
    ref: WorkspaceRef,
    projectId: string,
    claimedProjectId: string,
    canonicalKind: WorkspaceKind,
    repoKey: string | null,
    unseen: boolean,
  ): void => {
    const existing = byKey.get(key);
    const claimedSet = claimed.get(key) ?? new Set<string>();
    claimedSet.add(claimedProjectId);
    claimed.set(key, claimedSet);
    const legacySet = legacyKeys.get(key) ?? new Set<string>();
    legacySet.add(ref.key);
    legacyKeys.set(key, legacySet);
    if (existing === undefined) {
      byKey.set(key, {
        ...ref,
        key,
        projectId,
        claimedProjectIds: [...claimedSet],
        conflict: [...claimedSet].some((id) => id !== projectId),
        repoKey,
        parentKey: null,
        childKeys: [],
        featureId: null,
        unseen,
        legacyKeys: [...legacySet],
        records: [],
        canonicalEnvironmentId: null,
        launchable: false,
        kind: canonicalKind,
      } as Workspace);
      return;
    }
    const better =
      workspaceSortOrder(canonicalKind) < workspaceSortOrder(existing.kind)
        ? canonicalKind
        : existing.kind;
    byKey.set(key, {
      ...existing,
      kind: better,
      alias: existing.alias ?? ref.alias,
      branch: existing.branch ?? ref.branch,
      label: existing.alias ?? ref.alias ?? existing.label,
      diagnostic: existing.diagnostic ?? ref.diagnostic,
      environmentIds: [...new Set([...existing.environmentIds, ...ref.environmentIds])],
      claimedProjectIds: [...claimedSet],
      conflict: [...claimedSet].some((id) => id !== existing.projectId),
      legacyKeys: [...legacySet],
    });
  };

  for (const descriptor of Object.values(input.environments)) {
    const ref = workspaceRefOfEnvironment(descriptor, projects, input.ownership);
    if (ref === null) {
      byEnvironmentId.set(descriptor.id, NO_WORKSPACE_KEY);
      continue;
    }
    const path = normalizeWorkspacePath(descriptor.path);
    const key = path === null ? environmentKey(descriptor.id) : physicalWorkspaceKey(descriptor.hostId, path);
    const ownershipRow = input.ownership?.[descriptor.id];
    const projectId = ownershipRow?.ownerProjectId ?? descriptor.projectId;
    remember(
      key,
      ref,
      projectId,
      descriptor.projectId,
      ownershipRow?.kind ?? ref.kind,
      ownershipRow?.repoKey ?? null,
      false,
    );
    byEnvironmentId.set(descriptor.id, key);
    const row: WorkspaceRecord = {
      environmentId: descriptor.id,
      claimedProjectId: descriptor.projectId,
      providerId: descriptor.providerId,
      name: descriptor.name,
      branchName: descriptor.branchName,
      isWorktree: descriptor.isWorktree,
    };
    const list = records.get(key) ?? [];
    list.push(row);
    records.set(key, list);
    legacy.set(ref.key, key);
    legacy.set(environmentKey(descriptor.id), key);
  }

  for (const workspaces of Object.values(input.unseenWorkspaces ?? {})) {
    for (const unseen of workspaces) {
      const path = normalizeWorkspacePath(unseen.path);
      if (path === null) continue;
      const key = physicalWorkspaceKey(unseen.hostId, path);
      const existing = byKey.get(key);
      if (existing !== undefined) continue;
      const label = unseen.branch ?? path.split("/").filter(Boolean).at(-1) ?? "Git worktree";
      const ref: WorkspaceRef = {
        kind: "git-worktree",
        key,
        label,
        alias: null,
        branch: unseen.branch,
        environmentId: null,
        environmentIds: [],
        path: unseen.path,
        hostId: unseen.hostId,
        diagnostic:
          "This worktree exists on disk but has no bb environment yet. Starting a thread here adopts it.",
      };
      remember(key, ref, unseen.projectId, unseen.projectId, "git-worktree", unseen.repoKey, true);
    }
  }

  const features = input.features ?? [];
  const adoptions = input.adoptions ?? {};
  const rootPaths: { key: string; hostId: string | null; path: string }[] = [];
  for (const workspace of byKey.values()) {
    const feature = featureOfWorkspace({
      features,
      adoptions,
      environmentId: workspace.environmentId,
      path: workspace.path,
    });
    const featureId = feature?.id ?? null;
    const label =
      feature !== null && isFeatureRoot(feature, workspace.path)
        ? feature.name
        : workspace.label;
    const canonicalEnvironmentId = chooseCanonical(
      workspace.key,
      byKey,
      records,
      input.ownership,
    );
    const next: Workspace = {
      ...workspace,
      featureId,
      label,
      environmentId: canonicalEnvironmentId ?? workspace.environmentId,
      canonicalEnvironmentId,
      launchable: canonicalEnvironmentId !== null,
      records: records.get(workspace.key) ?? [],
      claimedProjectIds: [...(claimed.get(workspace.key) ?? [])],
      conflict: [...(claimed.get(workspace.key) ?? [])].some(
        (id) => id !== workspace.projectId,
      ),
      legacyKeys: [...(legacyKeys.get(workspace.key) ?? [])],
    };
    byKey.set(workspace.key, next);
    if (feature !== null && isFeatureRoot(feature, workspace.path) && workspace.path !== null && workspace.hostId !== null) {
      rootPaths.push({ key: workspace.key, hostId: workspace.hostId, path: normalizeWorkspacePath(workspace.path) ?? workspace.path });
    }
  }

  // Containment, only for feature roots. A member worktree points at the
  // deepest feature root that holds it; anything else keeps no parent.
  const parents = new Map<string, string>();
  for (const workspace of byKey.values()) {
    if (workspace.path === null || workspace.hostId === null) continue;
    const path = normalizeWorkspacePath(workspace.path) ?? workspace.path;
    let best: { key: string; length: number } | null = null;
    for (const root of rootPaths) {
      if (root.key === workspace.key || root.hostId !== workspace.hostId) continue;
      if (path !== root.path && !path.startsWith(`${root.path}/`)) continue;
      if (best === null || root.path.length > best.length) best = { key: root.key, length: root.path.length };
    }
    if (best !== null) parents.set(workspace.key, best.key);
  }
  const children = new Map<string, string[]>();
  for (const [key, parent] of parents) {
    const list = children.get(parent) ?? [];
    list.push(key);
    children.set(parent, list);
  }
  for (const workspace of byKey.values()) {
    byKey.set(workspace.key, {
      ...workspace,
      parentKey: parents.get(workspace.key) ?? null,
      childKeys: children.get(workspace.key) ?? [],
    });
  }

  const byProject = new Map<string, Workspace[]>();
  const byFeature = new Map<string, Workspace[]>();
  const byPath = new Map<string, Workspace>();
  const list = [...byKey.values()];
  for (const workspace of list) {
    const projectsFor = byProject.get(workspace.projectId) ?? [];
    projectsFor.push(workspace);
    byProject.set(workspace.projectId, projectsFor);
    if (workspace.featureId !== null) {
      const forFeature = byFeature.get(workspace.featureId) ?? [];
      forFeature.push(workspace);
      byFeature.set(workspace.featureId, forFeature);
    }
    if (workspace.hostId !== null && workspace.path !== null) {
      byPath.set(
        `${workspace.hostId}\u0000${normalizeWorkspacePath(workspace.path) ?? workspace.path}`,
        workspace,
      );
    }
  }

  const resolveLegacy = (key: string): string => {
    const direct = legacy.get(key) ?? key;
    if (byKey.has(direct)) return direct;
    const byEnvironment = key.startsWith("environment:")
      ? byEnvironmentId.get(key.slice("environment:".length))
      : undefined;
    return byEnvironment ?? direct;
  };
  const migrateKey = (key: string): string => resolveLegacy(key);

  return {
    list,
    roots: list.filter((workspace) => workspace.parentKey === null),
    byKey,
    byEnvironmentId,
    byProject,
    byPath,
    byFeature,
    featureNames: new Map(features.map((feature) => [feature.id, feature.name])),
    childrenOf: (key) =>
      (children.get(key) ?? []).flatMap((child) => byKey.get(child) ?? []),
    workspaceOfThread: (thread) => {
      const environmentId = thread.environment?.id ?? null;
      if (environmentId === null) return null;
      const key = byEnvironmentId.get(environmentId);
      if (key === undefined || key === NO_WORKSPACE_KEY) return null;
      return byKey.get(key) ?? null;
    },
    migrateKey,
  };
}

function chooseCanonical(
  key: string,
  byKey: ReadonlyMap<string, Workspace>,
  records: ReadonlyMap<string, readonly WorkspaceRecord[]>,
  ownership: WorkspaceOwnershipMap | undefined,
): string | null {
  const workspace = byKey.get(key);
  const rows = records.get(key) ?? [];
  if (rows.length === 0) return null;
  const owner = workspace?.projectId ?? null;
  const candidates = rows.map((row) => ({
    id: row.environmentId,
    preferred: row.claimedProjectId === owner ? 0 : 1,
    kind:
      workspace?.kind === "project-checkout"
        ? 0
        : workspace?.kind === "git-worktree"
          ? 1
          : 2,
    misfiled: ownership?.[row.environmentId]?.conflict === true ? 1 : 0,
  }));
  candidates.sort(
    (left, right) =>
      left.misfiled - right.misfiled ||
      left.preferred - right.preferred ||
      left.kind - right.kind ||
      left.id.localeCompare(right.id),
  );
  return candidates[0]?.id ?? null;
}
