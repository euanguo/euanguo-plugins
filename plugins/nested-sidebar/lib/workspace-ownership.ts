/**
 * Which project a physical workspace really belongs to.
 *
 * bb owns records, and a record can name the wrong project. The filesystem owns
 * directories and repositories, so this module derives a second owner from the
 * project source anchor plus the facts a host read from `.git`.
 *
 * The result is deliberately a shadow of bb's ownership, not a mutation:
 * environment and thread ids remain unchanged, and every conflict keeps both the
 * claimed and derived project ids.
 */

import {
  isWithin,
  physicalWorkspaceKey,
  type PhysicalWorkspace,
  type ProjectSourceFacts,
  type RepoIdentity,
} from "./repo-identity.ts";
import type {
  WorkspaceEnvironmentDescriptor,
  WorkspaceKind,
} from "./workspace.ts";

export type OwnershipConfidence =
  | "exact-source"
  | "local-repository"
  | "shared-remote"
  | "contained"
  | "claimed"
  | "unresolved";

export interface WorkspaceOwnership {
  readonly environmentId: string;
  readonly claimedProjectId: string;
  readonly ownerProjectId: string | null;
  readonly workspaceKey: string;
  readonly repoKey: string | null;
  readonly kind: WorkspaceKind;
  readonly confidence: OwnershipConfidence;
  readonly conflict: boolean;
}

export type WorkspaceOwnershipMap = Readonly<
  Record<string, WorkspaceOwnership>
>;

export interface OwnershipDiagnostic {
  readonly code: "ownership-conflict" | "ambiguous-owner";
  readonly environments: readonly string[];
  readonly projects: readonly string[];
  readonly message: string;
}

/** A worktree the repository records but no bb environment points at. */
export interface UnseenOwnedWorkspace {
  readonly projectId: string;
  readonly repoKey: string;
  readonly hostId: string;
  readonly path: string;
  readonly branch: string | null;
  readonly detached: boolean;
}

export interface WorkspaceOwnershipInference {
  readonly byEnvironmentId: WorkspaceOwnershipMap;
  readonly unseenByProject: Readonly<Record<string, readonly UnseenOwnedWorkspace[]>>;
  readonly diagnostics: readonly OwnershipDiagnostic[];
}

function physicalByEnvironment(
  repos: readonly RepoIdentity[],
): Map<string, PhysicalWorkspace> {
  const result = new Map<string, PhysicalWorkspace>();
  for (const repo of repos) {
    for (const workspace of repo.workspaces) {
      for (const environmentId of workspace.environmentIds) {
        result.set(environmentId, workspace);
      }
    }
  }
  return result;
}

function sourceMatchesPath(
  source: ProjectSourceFacts,
  workspace: PhysicalWorkspace,
): boolean {
  return (
    source.hostId === workspace.hostId &&
    source.path === workspace.path
  );
}

function candidateOwner(input: {
  claimedProjectId: string;
  workspace: PhysicalWorkspace;
  sources: readonly ProjectSourceFacts[];
  sourceRepoKeyByProject: ReadonlyMap<string, string>;
}): {
  ownerProjectId: string | null;
  confidence: OwnershipConfidence;
  ambiguous: boolean;
} {
  const exact = input.sources.filter((source) =>
    sourceMatchesPath(source, input.workspace),
  );
  if (exact.length > 0) {
    return {
      ownerProjectId: chooseProject(input.claimedProjectId, exact, input.workspace),
      confidence: "exact-source",
      ambiguous: exact.length > 1,
    };
  }

  const repository = input.sources.filter(
    (source) =>
      input.sourceRepoKeyByProject.get(source.projectId) === input.workspace.repoKey,
  );
  if (repository.length > 0) {
    const sameHost = repository.filter(
      (source) => source.hostId === input.workspace.hostId,
    );
    const candidates = sameHost.length > 0 ? sameHost : repository;
    const sharedRemote =
      sameHost.length === 0 &&
      input.workspace.repoKey.startsWith("repo:remote:");
    return {
      ownerProjectId: chooseProject(input.claimedProjectId, candidates, input.workspace),
      confidence: sharedRemote ? "shared-remote" : "local-repository",
      ambiguous: candidates.length > 1,
    };
  }

  const contained = input.sources
    .filter(
      (source) =>
        source.hostId === input.workspace.hostId &&
        isWithin(input.workspace.path, source.path),
    )
    .sort(
      (left, right) =>
        right.path.length - left.path.length ||
        left.projectId.localeCompare(right.projectId),
    );
  if (contained.length > 0) {
    const longest = contained[0]?.path;
    const nearest = contained.filter((source) => source.path === longest);
    return {
      ownerProjectId: chooseProject(input.claimedProjectId, nearest, input.workspace),
      confidence: "contained",
      ambiguous: nearest.length > 1,
    };
  }

  return {
    ownerProjectId: input.claimedProjectId,
    confidence: "claimed",
    ambiguous: false,
  };
}

function chooseProject(
  claimedProjectId: string,
  candidates: readonly ProjectSourceFacts[],
  workspace: PhysicalWorkspace,
): string | null {
  const claimed = candidates.find(
    (candidate) => candidate.projectId === claimedProjectId,
  );
  if (claimed !== undefined) return claimed.projectId;

  const mainAtWorkspace = candidates.find(
    (candidate) =>
      candidate.hostId === workspace.hostId &&
      candidate.repositoryRoot === workspace.path &&
      workspace.isMainWorktree,
  );
  if (mainAtWorkspace !== undefined) return mainAtWorkspace.projectId;

  return [...candidates]
    .sort((left, right) => left.projectId.localeCompare(right.projectId))[0]
    ?.projectId ?? null;
}

function kindFor(input: {
  environment: WorkspaceEnvironmentDescriptor;
  workspace: PhysicalWorkspace | undefined;
  ownerProjectId: string | null;
  source: ProjectSourceFacts | undefined;
}): WorkspaceKind {
  const { environment, workspace, ownerProjectId, source } = input;
  if (environment.providerId === "personal-workspace") return "personal";
  if (environment.path === null) return "unresolved";
  if (workspace === undefined) {
    return environment.isWorktree
      ? "git-worktree"
      : environment.isGitRepo
        ? "external-checkout"
        : "external-directory";
  }
  if (
    ownerProjectId !== null &&
    source !== undefined &&
    source.hostId === workspace.hostId &&
    source.path === workspace.path
  ) {
    return "project-checkout";
  }
  if (workspace.isLinkedWorktree) return "git-worktree";
  if (workspace.isNestedRepository) return "nested-checkout";
  if (
    ownerProjectId !== null &&
    source !== undefined &&
    workspace.repositoryRoot !== null &&
    isWithin(workspace.path, source.path)
  ) {
    return "nested-checkout";
  }
  return environment.isGitRepo ? "external-checkout" : "external-directory";
}

/**
 * Derive one owner per environment record.
 *
 * The same physical directory can appear under several environment ids. Each id
 * receives the same owner and workspace key, so the tree can fold them into one
 * row without losing the ids its actions need.
 */
export function inferWorkspaceOwnership(input: {
  environments: Iterable<WorkspaceEnvironmentDescriptor>;
  repos: readonly RepoIdentity[];
  sourceByProject: ReadonlyMap<string, ProjectSourceFacts>;
  sourceRepoKeyByProject: ReadonlyMap<string, string>;
}): WorkspaceOwnershipInference {
  const physical = physicalByEnvironment(input.repos);
  const sources = [...input.sourceByProject.values()];
  const byEnvironmentId: Record<string, WorkspaceOwnership> = {};
  const conflicts = new Map<string, {
    ownerProjectId: string;
    claimedProjectId: string;
    environmentIds: string[];
  }>();
  const ambiguous = new Map<string, {
    environmentIds: string[];
    projectIds: string[];
  }>();

  for (const environment of input.environments) {
    if (environment.providerId === "personal-workspace") continue;

    const workspace = physical.get(environment.id);
    const source = input.sourceByProject.get(environment.projectId);
    const result = workspace === undefined
      ? {
          ownerProjectId: environment.projectId,
          confidence: "claimed" as const,
          ambiguous: false,
        }
      : candidateOwner({
          claimedProjectId: environment.projectId,
          workspace,
          sources,
          sourceRepoKeyByProject: input.sourceRepoKeyByProject,
        });
    const ownerProjectId = result.ownerProjectId;
    const ownerSource = ownerProjectId === null
      ? undefined
      : input.sourceByProject.get(ownerProjectId);
    const kind = kindFor({
      environment,
      workspace,
      ownerProjectId,
      source: ownerSource ?? source,
    });
    const ownership: WorkspaceOwnership = {
      environmentId: environment.id,
      claimedProjectId: environment.projectId,
      ownerProjectId,
      workspaceKey:
        workspace?.key ??
        (environment.path === null
          ? `environment:${environment.id}`
          : physicalWorkspaceKey(environment.hostId, environment.path)),
      repoKey: workspace?.repoKey ?? null,
      kind,
      confidence:
        ownerProjectId === null ? "unresolved" : result.confidence,
      conflict: ownerProjectId !== environment.projectId,
    };
    byEnvironmentId[environment.id] = ownership;

    if (ownership.conflict && ownerProjectId !== null) {
      const key = `${ownerProjectId}\u0000${environment.projectId}`;
      const current = conflicts.get(key) ?? {
        ownerProjectId,
        claimedProjectId: environment.projectId,
        environmentIds: [],
      };
      current.environmentIds.push(environment.id);
      conflicts.set(key, current);
    }
    if (result.ambiguous) {
      const projectIds = [...sources]
        .filter((candidate) =>
          workspace === undefined
            ? false
            : candidate.projectId === ownerProjectId ||
              input.sourceRepoKeyByProject.get(candidate.projectId) === workspace.repoKey,
        )
        .map((candidate) => candidate.projectId)
        .sort();
      const key = projectIds.join("\u0000");
      const current = ambiguous.get(key) ?? {
        environmentIds: [],
        projectIds,
      };
      current.environmentIds.push(environment.id);
      ambiguous.set(key, current);
    }
  }

  const diagnostics: OwnershipDiagnostic[] = [];
  for (const conflict of conflicts.values()) {
    diagnostics.push({
      code: "ownership-conflict",
      environments: conflict.environmentIds,
      projects: [conflict.claimedProjectId, conflict.ownerProjectId],
      message:
        `bb files ${conflict.environmentIds.length} workspace record` +
        `${conflict.environmentIds.length === 1 ? "" : "s"} under ` +
        `${conflict.claimedProjectId}, but the filesystem places ` +
        `${conflict.environmentIds.length === 1 ? "it" : "them"} under ` +
        `${conflict.ownerProjectId}.`,
    });
  }
  for (const entry of ambiguous.values()) {
    diagnostics.push({
      code: "ambiguous-owner",
      environments: entry.environmentIds,
      projects: entry.projectIds,
      message:
        `${entry.environmentIds.length} workspace record` +
        `${entry.environmentIds.length === 1 ? " belongs" : "s belong"} to a ` +
        `repository shared by ${entry.projectIds.length} projects. The claimed ` +
        `project is kept unless one source is the repository's main checkout.`,
    });
  }

  const unseenByProject: Record<string, UnseenOwnedWorkspace[]> = {};
  for (const repo of input.repos) {
    const candidates = sources.filter(
      (source) =>
        input.sourceRepoKeyByProject.get(source.projectId) === repo.key,
    );
    if (candidates.length !== 1) continue;
    const projectId = candidates[0]?.projectId;
    if (projectId === undefined) continue;
    for (const worktree of repo.unseenWorktrees) {
      if (worktree.prunable || worktree.hostId === null || worktree.hostId === undefined) {
        continue;
      }
      const rows = unseenByProject[projectId] ?? [];
      rows.push({
        projectId,
        repoKey: repo.key,
        hostId: worktree.hostId,
        path: worktree.path,
        branch: worktree.branch,
        detached: worktree.detached,
      });
      unseenByProject[projectId] = rows;
    }
  }
  for (const rows of Object.values(unseenByProject)) {
    rows.sort((left, right) => left.path.localeCompare(right.path));
  }

  return { byEnvironmentId, unseenByProject, diagnostics };
}

/** The display owner for one thread, with bb's claimed project as fallback. */
export function ownerProjectIdForThread(
  thread: {
    readonly projectId: string;
    readonly environment: { readonly id: string | null } | null;
  },
  ownership: WorkspaceOwnershipMap | undefined,
): string {
  const environmentId = thread.environment?.id;
  if (environmentId === null || environmentId === undefined) {
    return thread.projectId;
  }
  return ownership?.[environmentId]?.ownerProjectId ?? thread.projectId;
}

/** The physical rows a project owns, independent of which project claimed them. */
export function ownedWorkspaces(
  repos: readonly RepoIdentity[],
  ownership: WorkspaceOwnershipMap,
  projectId: string,
): readonly {
  readonly repo: RepoIdentity;
  readonly workspace: PhysicalWorkspace;
  readonly environmentId: string | null;
}[] {
  const rows: {
    repo: RepoIdentity;
    workspace: PhysicalWorkspace;
    environmentId: string | null;
  }[] = [];
  for (const repo of repos) {
    for (const workspace of repo.workspaces) {
      const environmentId =
        workspace.environmentIds.find(
          (id) => ownership[id]?.ownerProjectId === projectId,
        ) ?? null;
      if (environmentId !== null) {
        rows.push({ repo, workspace, environmentId });
      }
    }
  }
  return rows.sort(
    (left, right) =>
      left.repo.name.localeCompare(right.repo.name) ||
      left.workspace.path.localeCompare(right.workspace.path),
  );
}
