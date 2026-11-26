import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type {
  WorkspaceEnvironmentDescriptor,
  WorkspaceKind,
  WorkspacePaths,
  WorkspaceProjectDescriptor,
} from "../schemas/workspace.ts";
import {
  environmentWorkspaceKey,
  normalizeWorkspacePath,
  physicalWorkspaceKey,
} from "./workspace-key.ts";
import type { WorkspaceOwnershipMap } from "./workspace-ownership.ts";

export type {
  WorkspaceEnvironmentDescriptor,
  WorkspaceKind,
  WorkspacePaths,
  WorkspaceProjectDescriptor,
};

export interface WorkspaceActivityMeta {
  readonly managed: boolean;
  readonly createdAt: number | null;
  readonly dangling: boolean;
  readonly lastActiveAt?: number | null;
}

export type WorktreeTier = "primary" | "inactive";

export const FRESH_WORKTREE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const UNMANAGED_ACTIVE_WORKTREE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface WorkspaceRef extends WorkspaceActivityMeta {
  readonly kind: WorkspaceKind;
  readonly key: string;
  readonly label: string;
  readonly alias: string | null;
  readonly branch: string | null;
  readonly environmentId: string | null;
  readonly environmentIds: readonly string[];
  readonly path: string | null;
  readonly hostId: string | null;
  readonly diagnostic: string | null;
}

export const NO_WORKSPACE_REF: WorkspaceRef = {
  kind: "personal",
  key: "__no_workspace__",
  label: "No workspace",
  alias: null,
  branch: null,
  environmentId: null,
  environmentIds: [],
  path: null,
  hostId: null,
  diagnostic: null,
  managed: false,
  createdAt: null,
  dangling: false,
  lastActiveAt: null,
};

const PERSONAL_WORKSPACE_PROVIDER = "personal-workspace";

function clean(value: string | null | undefined): string | null {
  const result = value?.trim();
  return result === undefined || result.length === 0 ? null : result;
}

function basename(path: string | null): string | null {
  if (path === null) return null;
  return path.split("/").filter(Boolean).at(-1) ?? null;
}

function pathHint(path: string | null): string {
  if (path === null) return "unknown path";
  const parts = path.split("/").filter(Boolean);
  return parts.slice(Math.max(0, parts.length - 2)).join("/");
}

function labelFor(
  kind: WorkspaceKind,
  alias: string | null,
  branch: string | null,
  path: string | null,
  environmentId: string | null,
): string {
  if (alias !== null) return alias;
  if (kind === "project-checkout") return branch ?? "Project checkout";
  if (kind === "git-worktree") return branch ?? basename(path) ?? "Git worktree";
  if (kind === "nested-checkout") return basename(path) ?? "Nested checkout";
  if (kind === "external-checkout") return basename(path) ?? "External checkout";
  if (kind === "external-directory") return basename(path) ?? "External directory";
  if (kind === "unresolved") {
    return environmentId === null
      ? "Unresolved workspace"
      : `Unresolved · ${environmentId.slice(-8)}`;
  }
  return "No workspace";
}

/**
 * bb's provisioning kind, as the workspace level reads it.
 *
 * `workspaceProvisionType` answers two different questions at once and only one
 * of them is about worktrees. `managed-worktree` means bb made the directory;
 * `unmanaged` means bb did not, which is true of *every project checkout* and of
 * every directory a person pointed bb at. Reading `unmanaged` as "a worktree bb
 * does not manage" — which is what this did — labelled every plain directory a
 * worktree, and made `classifyWorkspace`'s external-checkout and
 * external-directory branches unreachable: any environment outside its project's
 * source came back as `git-worktree`, so a directory nobody had made a worktree
 * of was drawn with a worktree's label and offered a worktree's menu.
 *
 * `isWorktree` is the field that answers the worktree question, and it is the
 * only one consulted here.
 */
export function workspaceDisplayKindOf(environment: {
  readonly workspaceProvisionType: string | null;
  readonly isWorktree: boolean;
}): NonNullable<WorkspaceEnvironmentDescriptor["workspaceDisplayKind"]> {
  if (environment.workspaceProvisionType === "managed-worktree") {
    return "managed-worktree";
  }
  return environment.isWorktree ? "unmanaged-worktree" : "other";
}

/**
 * What a workspace is, from bb's records and the project it claims.
 *
 * Exported because the agent map and the tree have to agree about this. They
 * were separate once, and they disagreed: the map printed bb's raw provisioning
 * kind, where `unmanaged` means "bb did not create this directory" — true of
 * every project checkout — and so labelled a plain directory a worktree.
 *
 * The project-checkout test comes first, so the `unmanaged` kind cannot reach
 * the worktree branch for a project's own checkout; everything after it is a
 * directory that is *not* where the project lives.
 */
export interface WorkspaceClassificationPhysical {
  readonly hostId: string;
  readonly path: string;
  readonly isLinkedWorktree: boolean;
  readonly isNestedRepository: boolean;
  readonly repositoryRoot: string | null;
}

export function classifyWorkspace(
  environment: WorkspaceEnvironmentDescriptor,
  project: WorkspaceProjectDescriptor | undefined,
  physical?: WorkspaceClassificationPhysical | null,
): WorkspaceKind {
  if (environment.providerId === PERSONAL_WORKSPACE_PROVIDER) return "personal";
  const path = normalizeWorkspacePath(environment.path);
  if (path === null) return "unresolved";
  if (physical === null) {
    return environment.isWorktree
      ? "git-worktree"
      : environment.isGitRepo
        ? "external-checkout"
        : "external-directory";
  }
  const effectiveHostId = physical?.hostId ?? environment.hostId;
  const effectivePath = physical?.path ?? path;
  const sourcePath = normalizeWorkspacePath(project?.sourcePath);
  if (
    sourcePath !== null &&
    effectivePath === sourcePath &&
    project !== undefined &&
    project.sourceHostId !== null &&
    effectiveHostId === project.sourceHostId
  ) {
    return "project-checkout";
  }
  if (physical !== undefined) {
    if (physical.isLinkedWorktree) return "git-worktree";
    if (physical.isNestedRepository) return "nested-checkout";
    if (
      sourcePath !== null &&
      physical.repositoryRoot !== null &&
      (effectivePath === sourcePath ||
        effectivePath.startsWith(sourcePath === "/" ? "/" : `${sourcePath}/`))
    ) {
      return "nested-checkout";
    }
    return environment.isGitRepo ? "external-checkout" : "external-directory";
  }
  if (
    environment.isWorktree ||
    environment.workspaceDisplayKind === "managed-worktree" ||
    environment.workspaceDisplayKind === "unmanaged-worktree"
  ) {
    return "git-worktree";
  }
  if (environment.isGitRepo) return "external-checkout";
  return "external-directory";
}

export function workspaceRefOf(
  thread: PluginSidebarThread,
  environments: ReadonlyMap<string, WorkspaceEnvironmentDescriptor> = new Map(),
  projects: ReadonlyMap<string, WorkspaceProjectDescriptor> = new Map(),
  ownership: WorkspaceOwnershipMap | undefined = undefined,
): WorkspaceRef {
  const environment = thread.environment;
  if (environment === null || environment.providerId === PERSONAL_WORKSPACE_PROVIDER) return NO_WORKSPACE_REF;

  const descriptor = environment.id === null ? undefined : environments.get(environment.id);
  if (descriptor === undefined) {
    const branch = clean(environment.branchName);
    const alias = clean(environment.name);
    return {
      kind: "unresolved",
      key: environmentWorkspaceKey(environment.id ?? "unknown"),
      label: labelFor("unresolved", alias, branch, null, environment.id),
      alias,
      branch,
      environmentId: environment.id,
      environmentIds: environment.id === null ? [] : [environment.id],
      path: null,
      hostId: thread.host?.id ?? null,
      diagnostic: "Environment metadata is unavailable.",
      managed: false,
      createdAt: null,
      dangling: false,
      lastActiveAt: null,
    };
  }

  return workspaceRefOfEnvironment(descriptor, projects, ownership) ?? NO_WORKSPACE_REF;
}

/**
 * The ref for an environment that has no thread behind it.
 *
 * The workspace level exists so a worktree can be reached, and a worktree whose
 * threads have all been settled is still one the user can start work in — the
 * environment outlives every conversation in it. So the tree needs a ref for an
 * environment on its own.
 *
 * It must be the ref its own threads would have produced: `key` is the identity
 * the tree groups by, so any difference here would split one worktree into two
 * rows rather than merging them into one.
 *
 * Null when the environment is not a workspace at all — a personal one, which
 * `workspaceRefOf` reports as the no-workspace bucket instead.
 */
export function workspaceRefOfEnvironment(
  descriptor: WorkspaceEnvironmentDescriptor,
  projects: ReadonlyMap<string, WorkspaceProjectDescriptor> = new Map(),
  ownership: WorkspaceOwnershipMap | undefined = undefined,
): WorkspaceRef | null {
  if (descriptor.providerId === PERSONAL_WORKSPACE_PROVIDER) return null;
  const ownershipRow = ownership?.[descriptor.id];
  const ownerProjectId = ownershipRow?.ownerProjectId ?? descriptor.projectId;
  const project = projects.get(ownerProjectId);
  const kind = ownershipRow?.kind ?? classifyWorkspace(descriptor, project);
  const path = normalizeWorkspacePath(descriptor.path);
  const alias = clean(descriptor.name);
  const branch = clean(descriptor.branchName);
  const key = path === null
    ? environmentWorkspaceKey(descriptor.id)
    : physicalWorkspaceKey(descriptor.hostId, path);
  return {
    kind,
    key,
    label: labelFor(kind, alias, branch, path, descriptor.id),
    alias,
    branch,
    environmentId: descriptor.id,
    environmentIds: [descriptor.id],
    path,
    hostId: descriptor.hostId,
    diagnostic: ownershipRow?.conflict === true
      ? `bb files this workspace under ${descriptor.projectId}; filesystem ownership places it under ${ownerProjectId}.`
      : kind === "external-checkout" || kind === "external-directory"
      ? "This environment is outside the project's configured source."
      : kind === "unresolved"
        ? "The workspace could not be classified from current metadata."
        : null,
    managed: descriptor.managed ?? (descriptor.workspaceDisplayKind === "managed-worktree"),
    createdAt: descriptor.createdAt ?? null,
    dangling: descriptor.dangling ?? false,
    lastActiveAt: descriptor.updatedAt ?? null,
  };
}

/**
 * Decides whether a workspace stays pinned in the primary layer or folds
 * into the inactive summary row under its project.
 */
export function classifyWorktreeTier(input: {
  readonly ref: WorkspaceRef;
  readonly openFamilyCount: number;
  readonly isActiveWorkspace: boolean;
  readonly hasOpenPullRequest: boolean;
  readonly inManualOrder: boolean;
  readonly lastActiveAt?: number | null;
  readonly now: number;
}): WorktreeTier {
  const { ref, openFamilyCount, isActiveWorkspace, hasOpenPullRequest, inManualOrder, now } = input;
  const managed = ref.managed ?? false;
  const createdAt = ref.createdAt ?? null;
  const dangling = ref.dangling ?? false;
  const lastActiveAt = input.lastActiveAt ?? ref.lastActiveAt ?? null;

  if (ref.kind === "project-checkout") return "primary";
  if (isActiveWorkspace) return "primary";
  if (openFamilyCount > 0) return "primary";
  if (hasOpenPullRequest) return "primary";
  if (ref.alias !== null) return "primary";
  if (inManualOrder) return "primary";
  if (!dangling && createdAt !== null && now - createdAt < FRESH_WORKTREE_WINDOW_MS) {
    return "primary";
  }
  if (
    !managed &&
    !dangling &&
    lastActiveAt !== null &&
    now - lastActiveAt < UNMANAGED_ACTIVE_WORKTREE_WINDOW_MS
  ) {
    return "primary";
  }
  return "inactive";
}

/** Add enough context to labels that collide inside one project. */
export function disambiguateWorkspaceLabels(refs: readonly WorkspaceRef[]): WorkspaceRef[] {
  const counts = new Map<string, number>();
  for (const ref of refs) counts.set(ref.label, (counts.get(ref.label) ?? 0) + 1);
  const seen = new Map<string, number>();
  return refs.map((ref) => {
    if ((counts.get(ref.label) ?? 0) <= 1) return ref;
    const index = (seen.get(ref.label) ?? 0) + 1;
    seen.set(ref.label, index);
    const suffix = ref.path === null ? ref.environmentId?.slice(-8) ?? String(index) : pathHint(ref.path);
    return { ...ref, label: `${ref.label} · ${suffix}` };
  });
}

/**
 * Whether a project draws its workspaces as rows of their own.
 *
 * Two workspaces are always worth telling apart. One is normally the project's
 * own checkout, and naming it under the project already named after it is
 * noise, so a single-workspace project stays flat. A project with no threads is
 * the exception: the workspace row is then the only thing under the project,
 * and a worktree that was just created is exactly what the user came to look
 * at, so it is drawn rather than hidden until a second one appears.
 */
export function shouldShowWorkspaces(
  refs: readonly WorkspaceRef[],
  threadCount: number,
): boolean {
  const distinct = new Set(refs.map((ref) => ref.key)).size;
  return distinct >= 2 || (distinct === 1 && threadCount === 0);
}

export function workspaceSortOrder(kind: WorkspaceKind): number {
  if (kind === "project-checkout") return 0;
  if (kind === "git-worktree") return 1;
  if (kind === "nested-checkout") return 2;
  if (kind === "external-checkout") return 3;
  if (kind === "external-directory") return 4;
  if (kind === "unresolved") return 5;
  return 6;
}

export type WorkspaceLabelMode = "alias-over-branch" | "alias-and-branch" | "alias-only" | "branch-only";

export interface WorkspaceRowLabel {
  readonly label: string;
  readonly labelIsBranch: boolean;
  readonly detail: string | null;
  readonly stacked: boolean;
}

function alone(label: string, isBranch: boolean): WorkspaceRowLabel {
  return { label, labelIsBranch: isBranch, detail: null, stacked: false };
}

function together(alias: string, branch: string, stacked: boolean): WorkspaceRowLabel {
  return { label: alias, labelIsBranch: false, detail: branch, stacked };
}

function remaining(ref: WorkspaceRef): WorkspaceRowLabel {
  if (ref.alias !== null) return alone(ref.alias, false);
  if (ref.branch !== null) return alone(ref.branch, true);
  return alone(ref.label, false);
}

export function workspaceRowLabel(ref: WorkspaceRef, mode: WorkspaceLabelMode): WorkspaceRowLabel {
  const { alias, branch } = ref;
  if (alias !== null && branch !== null && alias === branch) return alone(alias, false);
  switch (mode) {
    case "alias-only": return alias === null ? remaining(ref) : alone(alias, false);
    case "branch-only": return branch === null ? remaining(ref) : alone(branch, true);
    case "alias-and-branch": return alias !== null && branch !== null ? together(alias, branch, false) : remaining(ref);
    case "alias-over-branch": return alias !== null && branch !== null ? together(alias, branch, true) : remaining(ref);
  }
}

/** What a workspace's kind is called wherever a row names it. */
export function workspaceKindLabel(kind: WorkspaceKind): string {
  switch (kind) {
    case "project-checkout":
      return "Project checkout";
    case "git-worktree":
      return "Git worktree";
    case "nested-checkout":
      return "Nested checkout";
    case "external-checkout":
      return "External checkout";
    case "external-directory":
      return "External directory";
    case "unresolved":
      return "Unresolved workspace";
    case "personal":
      return "Personal workspace";
  }
}

/** A line count at sidebar width: exact below a thousand, then 1.2k. */
export function formatLineCount(count: number): string {
  if (count < 1000) return String(count);
  const thousands = count / 1000;
  return `${thousands >= 100 ? Math.round(thousands) : Number(thousands.toFixed(1))}k`;
}
