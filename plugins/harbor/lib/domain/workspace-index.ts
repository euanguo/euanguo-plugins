/**
 * One derived table of workspaces.
 *
 * bb owns environments, projects, and threads. Everything the sidebar draws
 * about a workspace is a projection of those records plus what the disk says
 * about paths, so this module builds that projection once and every view reads
 * it. Nothing here is stored.
 *
 * The identity is the physical directory, `ws:<hostId>:<path>`, where the path
 * is the one bb recorded, normalized. Project is ownership metadata, not
 * identity: a project claim can change, and when it did the old key moved the
 * user's order and expansion with it. A directory with several environment
 * records becomes one workspace with several records, and a worktree the
 * repository knows but bb does not is a workspace with no record at all.
 *
 * `createWorkspace` is the one place a `Workspace` is assembled and the one
 * place its derived fields are computed. `buildWorkspaceIndex` gathers the
 * facts (records, claims, containment) and calls it once per row; nothing else
 * may recompute `conflict`, `legacyKeys`, or `launchable`.
 */

import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

import {
  featureForPath,
  featureOfWorkspace,
  isFeatureRoot,
  type Feature,
  type FeatureAssignment,
  type FeatureMember,
} from "./features.ts";
import type { RepoIdentity } from "./repo-identity.ts";
import {
  normalizeWorkspacePath,
  physicalWorkspaceKey,
  type WorkspaceKey,
} from "./workspace-key.ts";
import {
  workspaceRefOfEnvironment,
  workspaceSortOrder,
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

/** One bb environment pointing at a directory. Never the identity itself. */
export interface WorkspaceRecord {
  readonly environmentId: string;
  readonly claimedProjectId: string;
  readonly providerId: string | null;
  readonly name: string | null;
  readonly branchName: string | null;
  readonly isWorktree: boolean;
  readonly managed?: boolean;
  readonly createdAt?: number | null;
  readonly updatedAt?: number | null;
  readonly providerInstanceKey?: string | null;
  readonly dangling?: boolean;
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

/**
 * What a surface that did not build the full index can promise.
 *
 * A light derivation from thread rows knows `environmentId -> key` and can
 * answer which workspace a thread runs in. It does not own the reads that
 * establish a project's other workspaces, a feature's members, or filesystem
 * ownership, so it must not claim those maps are present. The remaining maps
 * are optional on purpose: a header may use one when the derivation happened
 * to have it, and falls back to no neighbours when it did not.
 */
export type PartialWorkspaceIndex = Pick<
  WorkspaceIndex,
  "byEnvironmentId" | "workspaceOfThread"
> &
  Partial<
    Pick<
      WorkspaceIndex,
      "byKey" | "byProject" | "byFeature" | "featureNames"
    >
  >;

export interface WorkspaceIndexInput {
  readonly environments: Readonly<Record<string, WorkspaceEnvironmentDescriptor>>;
  readonly projects: Readonly<Record<string, WorkspaceProjectDescriptor>>;
  readonly ownership?: WorkspaceOwnershipMap;
  readonly repos?: readonly RepoIdentity[];
  readonly unseenWorkspaces?: Readonly<Record<string, readonly UnseenOwnedWorkspace[]>>;
  readonly features?: readonly Feature[];
  readonly featureMembers?: readonly FeatureMember[];
  readonly adoptions?: FeatureAssignment;
}

/** Everything `createWorkspace` needs that the builder has already resolved. */
export interface CreateWorkspaceInput {
  /** The representative record: label, alias, branch, host, path, diagnostic. */
  readonly ref: WorkspaceRef;
  /** The one primary key, from `physicalWorkspaceKey` or its fallback. */
  readonly key: WorkspaceKey;
  readonly kind: WorkspaceKind;
  /** The derived owner, with bb's claim as the fallback. */
  readonly projectId: string;
  /** Every project record that points at the directory, in discovery order. */
  readonly claims: readonly string[];
  /**
   * The project ids the old project-scoped key was spelled with.
   *
   * Defaults to `claims`. An unseen worktree passes none: it never had a
   * project-scoped key, and inventing one would add a spelling no stored order
   * ever contained.
   */
  readonly legacyProjectIds?: readonly string[];
  readonly repoKey: string | null;
  readonly unseen: boolean;
  readonly records: readonly WorkspaceRecord[];
  /** Extra spellings the disk resolved, such as a symlink's realPath. */
  readonly aliases?: readonly string[];
  readonly featureId: string | null;
  /** The feature root's own name, when this row is one. */
  readonly label?: string;
  readonly parentKey?: string | null;
  readonly childKeys?: readonly string[];
  /** Who files each record; `canonicalEnvironmentId` consults it. */
  readonly ownership?: WorkspaceOwnershipMap;
}

/**
 * The one constructor for a `Workspace`.
 *
 * Every derived field is computed here and nowhere else. The builder supplies
 * what only it can know — which records point here, which feature root contains
 * it, which project the filesystem places here — and this assembles the row the
 * views read.
 */
export function createWorkspace(input: CreateWorkspaceInput): Workspace {
  const claimedProjectIds = [...new Set(input.claims)];
  const legacyKeys = [...(input.aliases ?? [])].filter(
    (value, at, all) => value !== input.key && all.indexOf(value) === at,
  );
  const canonicalEnvironmentId = chooseCanonicalEnvironment(
    input.kind,
    input.projectId,
    input.records,
    input.ownership,
  );
  return {
    ...input.ref,
    managed: input.ref.managed ?? false,
    createdAt: input.ref.createdAt ?? null,
    dangling: input.ref.dangling ?? false,
    lastActiveAt: input.ref.lastActiveAt ?? null,
    key: input.key,
    kind: input.kind,
    label: input.label ?? input.ref.label,
    alias: input.ref.alias,
    branch: input.ref.branch,
    // The derived record is the one bb will accept for the owner. Falling back
    // to the representative keeps an unseen workspace's `null` honest.
    environmentId: canonicalEnvironmentId ?? input.ref.environmentId,
    projectId: input.projectId,
    claimedProjectIds,
    conflict: claimedProjectIds.some((id) => id !== input.projectId),
    repoKey: input.repoKey,
    parentKey: input.parentKey ?? null,
    childKeys: [...(input.childKeys ?? [])],
    featureId: input.featureId,
    unseen: input.unseen,
    legacyKeys,
    records: [...input.records],
    canonicalEnvironmentId,
    launchable: canonicalEnvironmentId !== null,
  };
}

/**
 * The record a row launches from.
 *
 * One physical directory can carry several environment records, and each names
 * exactly one project. A record whose claim disagrees with the derived owner is
 * never chosen, however its id sorts: bb checks the *record's* project when a
 * reuse is submitted, so it is `409 Environment belongs to a different
 * project`. Among the rest, a checkout beats a worktree, then the id breaks the
 * tie.
 */
function chooseCanonicalEnvironment(
  kind: WorkspaceKind,
  owner: string,
  records: readonly WorkspaceRecord[],
  ownership: WorkspaceOwnershipMap | undefined,
): string | null {
  if (records.length === 0) return null;
  const candidates = records.map((row) => ({
    id: row.environmentId,
    preferred: row.claimedProjectId === owner ? 0 : 1,
    kind: kind === "project-checkout" ? 0 : kind === "git-worktree" ? 1 : 2,
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

/** One row while the builder is still gathering facts about it. */
interface WorkspaceDraft {
  ref: WorkspaceRef;
  key: WorkspaceKey;
  projectId: string;
  claims: Set<string>;
  kind: WorkspaceKind;
  repoKey: string | null;
  unseen: boolean;
}

export function buildWorkspaceIndex(input: WorkspaceIndexInput): WorkspaceIndex {
  const projects = new Map(Object.entries(input.projects));
  const drafts = new Map<string, WorkspaceDraft>();
  const byEnvironmentId = new Map<string, string>();
  const legacy = new Map<string, string>();
  const records = new Map<string, WorkspaceRecord[]>();

  const remember = (
    key: WorkspaceKey,
    ref: WorkspaceRef,
    projectId: string,
    claimedProjectId: string,
    canonicalKind: WorkspaceKind,
    repoKey: string | null,
    unseen: boolean,
  ): void => {
    const existing = drafts.get(key);
    if (existing === undefined) {
      drafts.set(key, {
        ref: { ...ref, key },
        key,
        projectId,
        claims: new Set([claimedProjectId]),
        kind: canonicalKind,
        repoKey,
        unseen,
      });
      return;
    }
    existing.claims.add(claimedProjectId);
    existing.kind =
      workspaceSortOrder(canonicalKind) < workspaceSortOrder(existing.kind)
        ? canonicalKind
        : existing.kind;
    const createdAtCandidates = [existing.ref.createdAt, ref.createdAt].filter(
      (value): value is number => typeof value === "number" && Number.isFinite(value),
    );
    const lastActiveCandidates = [existing.ref.lastActiveAt, ref.lastActiveAt].filter(
      (value): value is number => typeof value === "number" && Number.isFinite(value),
    );
    existing.ref = {
      ...existing.ref,
      alias: existing.ref.alias ?? ref.alias,
      branch: existing.ref.branch ?? ref.branch,
      label: existing.ref.alias ?? ref.alias ?? existing.ref.label,
      diagnostic: existing.ref.diagnostic ?? ref.diagnostic,
      managed: existing.ref.managed || ref.managed,
      createdAt:
        createdAtCandidates.length === 0 ? null : Math.min(...createdAtCandidates),
      dangling: existing.ref.dangling || ref.dangling,
      lastActiveAt:
        lastActiveCandidates.length === 0 ? null : Math.max(...lastActiveCandidates),
      environmentIds: [
        ...new Set([...existing.ref.environmentIds, ...ref.environmentIds]),
      ],
    };
  };

  for (const descriptor of Object.values(input.environments)) {
    const ref = workspaceRefOfEnvironment(descriptor, projects, input.ownership);
    if (ref === null) {
      byEnvironmentId.set(descriptor.id, NO_WORKSPACE_KEY);
      continue;
    }
    const ownershipRow = input.ownership?.[descriptor.id];
    const projectId = ownershipRow?.ownerProjectId ?? descriptor.projectId;
    remember(
      ref.key as WorkspaceKey,
      ref,
      projectId,
      descriptor.projectId,
      ownershipRow?.kind ?? ref.kind,
      ownershipRow?.repoKey ?? null,
      false,
    );
    byEnvironmentId.set(descriptor.id, ref.key);
    const row: WorkspaceRecord = {
      environmentId: descriptor.id,
      claimedProjectId: descriptor.projectId,
      providerId: descriptor.providerId,
      name: descriptor.name,
      branchName: descriptor.branchName,
      isWorktree: descriptor.isWorktree,
      managed: descriptor.managed ?? (descriptor.workspaceDisplayKind === "managed-worktree"),
      createdAt: descriptor.createdAt ?? null,
      updatedAt: descriptor.updatedAt ?? null,
      providerInstanceKey: descriptor.providerInstanceKey ?? null,
      dangling: descriptor.dangling ?? false,
    };
    const list = records.get(ref.key) ?? [];
    list.push(row);
    records.set(ref.key, list);
  }

  const features = input.features ?? [];
  const projectBySource = new Map<string, string>();
  for (const project of projects.values()) {
    const sourcePath = normalizeWorkspacePath(project.sourcePath);
    if (sourcePath === null || project.sourceHostId === null) continue;
    projectBySource.set(`${project.sourceHostId}\u0000${sourcePath}`, project.projectId);
  }
  const repoByRoot = new Map<string, RepoIdentity>();
  for (const repo of input.repos ?? []) {
    const rootPath = normalizeWorkspacePath(repo.rootPath);
    if (rootPath === null) continue;
    for (const hostId of repo.hostIds) {
      repoByRoot.set(`${hostId}\u0000${rootPath}`, repo);
    }
  }
  const activeFeatureIds = new Set(
    features.filter((feature) => feature.state !== "archived").map((feature) => feature.id),
  );
  const memberFeatureIds = new Map<string, string>();
  for (const member of input.featureMembers ?? []) {
    if (member.role === "ref" || !activeFeatureIds.has(member.featureId)) continue;
    const path = normalizeWorkspacePath(member.path);
    if (path === null) continue;
    const key = physicalWorkspaceKey(member.hostId, path);
    memberFeatureIds.set(key, member.featureId);
    if (drafts.has(key)) continue;
    const repoPath = normalizeWorkspacePath(member.repositoryPath);
    const matchedRepo =
      repoPath === null ? undefined : repoByRoot.get(`${member.hostId}\u0000${repoPath}`);
    const matchedProjectId =
      (repoPath === null
        ? undefined
        : projectBySource.get(`${member.hostId}\u0000${repoPath}`)) ??
      matchedRepo?.projectIds[0] ??
      member.repository;
    const kind: WorkspaceKind =
      member.role === "submodule" ? "nested-checkout" : "git-worktree";
    const ref: WorkspaceRef = {
      kind,
      key,
      label: member.branch ?? member.directory,
      alias: null,
      branch: member.branch,
      environmentId: null,
      environmentIds: [],
      path: member.path,
      hostId: member.hostId,
      diagnostic: null,
      managed: true,
      createdAt: null,
      dangling: false,
      lastActiveAt: null,
    };
    remember(
      key,
      ref,
      matchedProjectId,
      matchedProjectId,
      kind,
      matchedRepo?.key ?? null,
      false,
    );
  }

  for (const workspaces of Object.values(input.unseenWorkspaces ?? {})) {
    for (const unseen of workspaces) {
      const path = normalizeWorkspacePath(unseen.path);
      if (path === null) continue;
      if (featureForPath(features, path) !== null) continue;
      const key = physicalWorkspaceKey(unseen.hostId, path);
      if (drafts.has(key)) continue;
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
        managed: false,
        createdAt: null,
        dangling: false,
        lastActiveAt: null,
      };
      remember(key, ref, unseen.projectId, unseen.projectId, "git-worktree", unseen.repoKey, true);
    }
  }

  // A symlinked checkout is one workspace, not two. bb keys it by the path it
  // recorded; the disk's realPath is an alias of that primary key, so an order
  // stored under either spelling resolves to the same row. `aliases` is the
  // direct answer; `rawPaths` plus `path` carry the same fact across the RPC
  // wire, where only those fields are declared.
  const aliases = new Map<string, string[]>();
  for (const repo of input.repos ?? []) {
    for (const workspace of repo.workspaces) {
      const spellings = new Set<string>([
        ...(workspace.aliases ?? []),
        ...workspace.rawPaths.map((raw) =>
          physicalWorkspaceKey(workspace.hostId, raw),
        ),
        physicalWorkspaceKey(workspace.hostId, workspace.path),
      ]);
      for (const environmentId of workspace.environmentIds) {
        const key = byEnvironmentId.get(environmentId);
        if (key === undefined || key === NO_WORKSPACE_KEY) continue;
        const list = aliases.get(key) ?? [];
        for (const alias of spellings) {
          if (alias !== key && !list.includes(alias)) list.push(alias);
        }
        aliases.set(key, list);
      }
    }
  }

  const adoptions = input.adoptions ?? {};
  const featureIdOf = new Map<string, string | null>();
  const labelOf = new Map<string, string>();
  const rootPaths: { key: string; hostId: string | null; path: string }[] = [];
  for (const draft of drafts.values()) {
    const resolvedFeature = featureOfWorkspace({
      features,
      adoptions,
      environmentId: draft.ref.environmentId,
      path: draft.ref.path,
    });
    const featureId = resolvedFeature?.id ?? memberFeatureIds.get(draft.key) ?? null;
    featureIdOf.set(draft.key, featureId);
    labelOf.set(
      draft.key,
      resolvedFeature !== null && isFeatureRoot(resolvedFeature, draft.ref.path)
        ? resolvedFeature.name
        : draft.ref.label,
    );
    if (
      resolvedFeature !== null &&
      isFeatureRoot(resolvedFeature, draft.ref.path) &&
      draft.ref.path !== null &&
      draft.ref.hostId !== null
    ) {
      rootPaths.push({
        key: draft.key,
        hostId: draft.ref.hostId,
        path: normalizeWorkspacePath(draft.ref.path) ?? draft.ref.path,
      });
    }
  }

  // Containment, only for feature roots. A member worktree points at the
  // deepest feature root that holds it; anything else keeps no parent.
  const parents = new Map<string, string>();
  for (const draft of drafts.values()) {
    if (draft.ref.path === null || draft.ref.hostId === null) continue;
    const path = normalizeWorkspacePath(draft.ref.path) ?? draft.ref.path;
    let best: { key: string; length: number } | null = null;
    for (const root of rootPaths) {
      if (root.key === draft.key || root.hostId !== draft.ref.hostId) continue;
      if (path !== root.path && !path.startsWith(`${root.path}/`)) continue;
      if (best === null || root.path.length > best.length) best = { key: root.key, length: root.path.length };
    }
    if (best !== null) parents.set(draft.key, best.key);
  }
  const children = new Map<string, string[]>();
  for (const [key, parent] of parents) {
    const list = children.get(parent) ?? [];
    list.push(key);
    children.set(parent, list);
  }

  const byKey = new Map<string, Workspace>();
  for (const draft of drafts.values()) {
    const rows = records.get(draft.key) ?? [];
    const nested = children.get(draft.key) ?? [];
    const workspace = createWorkspace({
      ref: draft.ref,
      key: draft.key,
      kind: draft.kind,
      projectId: draft.projectId,
      claims: [...draft.claims],
      legacyProjectIds: rows.length === 0 ? [] : [...draft.claims, draft.projectId],
      repoKey: draft.repoKey,
      unseen: draft.unseen,
      records: rows,
      aliases: aliases.get(draft.key) ?? [],
      featureId: featureIdOf.get(draft.key) ?? null,
      label: labelOf.get(draft.key),
      parentKey: parents.get(draft.key) ?? null,
      childKeys: nested,
      ownership: input.ownership,
    });
    byKey.set(draft.key, workspace);
    for (const legacyKey of workspace.legacyKeys) {
      legacy.set(legacyKey, workspace.key);
    }
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
