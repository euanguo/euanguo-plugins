import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { WorkspaceOwnershipMap } from "./workspace-ownership.ts";

export type WorkspaceKind =
  | "project-checkout"
  | "git-worktree"
  | "nested-checkout"
  | "external-checkout"
  | "external-directory"
  | "personal"
  | "unresolved";

export interface WorkspaceEnvironmentDescriptor {
  readonly id: string;
  readonly projectId: string;
  readonly hostId: string;
  readonly path: string | null;
  readonly isGitRepo: boolean;
  readonly isWorktree: boolean;
  readonly branchName: string | null;
  readonly name: string | null;
  readonly providerId: string | null;
  readonly workspaceDisplayKind: "managed-worktree" | "unmanaged-worktree" | "other" | null;
}

export interface WorkspaceProjectDescriptor {
  readonly projectId: string;
  readonly sourcePath: string | null;
  readonly sourceHostId: string | null;
}

/**
 * Where every workspace and project actually is on disk, keyed by environment
 * id and project id. This is the shape `listWorkspacePaths` returns, and the
 * shape the snapshot codec has to recognise on the way back in.
 */
export interface WorkspacePaths {
  readonly environments: Readonly<Record<string, WorkspaceEnvironmentDescriptor>>;
  readonly projects: Readonly<Record<string, WorkspaceProjectDescriptor>>;
}

export interface WorkspaceRef {
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

const NO_WORKSPACE: WorkspaceRef = {
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
};

const PERSONAL_WORKSPACE_PROVIDER = "personal-workspace";

function clean(value: string | null | undefined): string | null {
  const result = value?.trim();
  return result === undefined || result.length === 0 ? null : result;
}

export function normalizeWorkspacePath(path: string | null | undefined): string | null {
  const value = clean(path);
  if (value === null) return null;
  const normalized = value.replaceAll("\\", "/").replace(/\/+/g, "/").replace(/\/+$/, "");
  return normalized.length === 0 ? "/" : normalized;
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
  if (kind === "unresolved") return environmentId === null ? "Unresolved workspace" : "Unresolved · " + environmentId.slice(-8);
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
export function classifyWorkspace(
  environment: WorkspaceEnvironmentDescriptor,
  project: WorkspaceProjectDescriptor | undefined,
): WorkspaceKind {
  if (environment.providerId === PERSONAL_WORKSPACE_PROVIDER) return "personal";
  const path = normalizeWorkspacePath(environment.path);
  if (path === null) return "unresolved";
  const sourcePath = normalizeWorkspacePath(project?.sourcePath);
  if (
    sourcePath !== null &&
    path === sourcePath &&
    project !== undefined &&
    project.sourceHostId !== null &&
    environment.hostId === project.sourceHostId
  ) return "project-checkout";
  if (
    environment.isWorktree ||
    environment.workspaceDisplayKind === "managed-worktree" ||
    environment.workspaceDisplayKind === "unmanaged-worktree"
  ) return "git-worktree";
  if (environment.isGitRepo) return "external-checkout";
  return "external-directory";
}

/** Stable identity for a physical workspace. Classification is presentation
 * metadata and must never split one path into two rows when it changes. */
export function workspaceIdentityKey(input: {
  readonly hostId: string;
  readonly projectId: string;
  readonly path: string;
}): string {
  return `workspace:${input.hostId}:${input.projectId}:${normalizeWorkspacePath(input.path) ?? input.path}`;
}

export function workspaceRefOf(
  thread: PluginSidebarThread,
  environments: ReadonlyMap<string, WorkspaceEnvironmentDescriptor> = new Map(),
  projects: ReadonlyMap<string, WorkspaceProjectDescriptor> = new Map(),
  ownership: WorkspaceOwnershipMap | undefined = undefined,
): WorkspaceRef {
  const environment = thread.environment;
  if (environment === null || environment.providerId === PERSONAL_WORKSPACE_PROVIDER) return NO_WORKSPACE;

  const descriptor = environment.id === null ? undefined : environments.get(environment.id);
  if (descriptor === undefined) {
    const branch = clean(environment.branchName);
    const alias = clean(environment.name);
    return {
      kind: "unresolved",
      key: "environment:" + (environment.id ?? "unknown"),
      label: labelFor("unresolved", alias, branch, null, environment.id),
      alias,
      branch,
      environmentId: environment.id,
      environmentIds: environment.id === null ? [] : [environment.id],
      path: null,
      hostId: thread.host?.id ?? null,
      diagnostic: "Environment metadata is unavailable.",
    };
  }

  return workspaceRefOfEnvironment(descriptor, projects, ownership) ?? NO_WORKSPACE;
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
    ? "environment:" + descriptor.id
    : workspaceIdentityKey({ hostId: descriptor.hostId, projectId: ownerProjectId, path });
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
  };
}

export function mergeWorkspaceRefs(left: WorkspaceRef, right: WorkspaceRef): WorkspaceRef {
  if (left.key !== right.key) throw new Error("Cannot merge different workspaces.");
  const environmentIds = [...new Set([...left.environmentIds, ...right.environmentIds])];
  const representative = preferredWorkspaceRef(left, right);
  return {
    ...representative,
    environmentIds,
    environmentId: chooseCanonicalEnvironment(left, right),
    alias: left.alias ?? right.alias,
    branch: left.branch ?? right.branch,
    label: left.alias ?? right.alias ?? representative.label,
    diagnostic: left.diagnostic ?? right.diagnostic,
  };
}

function preferredWorkspaceRef(left: WorkspaceRef, right: WorkspaceRef): WorkspaceRef {
  const leftPriority = workspaceSortOrder(left.kind);
  const rightPriority = workspaceSortOrder(right.kind);
  if (leftPriority !== rightPriority) return leftPriority < rightPriority ? left : right;
  return left.environmentId === null || (right.environmentId !== null && left.environmentId.localeCompare(right.environmentId) <= 0)
    ? left
    : right;
}

function chooseCanonicalEnvironment(left: WorkspaceRef, right: WorkspaceRef): string | null {
  const candidates = [left, right].flatMap((ref) =>
    ref.environmentId === null ? [] : [{
      id: ref.environmentId,
      priority: ref.kind === "project-checkout" ? 0 : ref.kind === "git-worktree" ? 1 : 2,
    }],
  );
  candidates.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  return candidates[0]?.id ?? null;
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
    return { ...ref, label: ref.label + " · " + suffix };
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
