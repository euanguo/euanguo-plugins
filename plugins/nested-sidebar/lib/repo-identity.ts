/**
 * Where a workspace really is, and which repository it really belongs to.
 *
 * bb groups threads by `projectId`, and that is the right key for everything
 * bb owns: the thread's project is a fact about the thread. It is the wrong key
 * for the sidebar, because a project is a *record* a user or an agent creates,
 * and a record can be created wrong. A repository is a fact on disk: two
 * checkouts of it share one `.git`, and no amount of bad bookkeeping changes
 * that.
 *
 * So this module derives a second, physical axis — repo -> workspace — from
 * paths and the `.git` files at the end of them, and reports every place the
 * two axes disagree. It decides nothing about bb's data and writes nothing; a
 * disagreement is a diagnostic the user reads, not a correction this makes.
 *
 * Everything here is pure. The filesystem work lives in the host entry
 * (`host/workspace-facts.ts`), which is the only place that can see the disk,
 * and its answer arrives as `WorkspaceFacts`.
 */

import type {
  WorkspaceEnvironmentDescriptor,
  WorkspaceProjectDescriptor,
} from "./workspace.ts";

/**
 * One worktree the repository itself knows about.
 *
 * Read from the repository's own bookkeeping rather than from bb, which is the
 * whole point: a worktree created by another tool is still in `.git` and still
 * absent from bb's environment table.
 */
export interface RepoWorktree {
  /** The machine that supplied this record, when inference added the context. */
  readonly hostId?: string | null;
  /** Absolute path as the repository records it. */
  readonly path: string;
  readonly branch: string | null;
  readonly head: string | null;
  /** A checkout not on a branch — a detached HEAD or a bare-ish worktree. */
  readonly detached: boolean;
  /** The repository records it but the directory is gone. */
  readonly prunable: boolean;
}

/**
 * What the disk says about one directory, and nothing more.
 *
 * `null` on a field means "not observed", never "false". A directory that could
 * not be read is not a directory that is not a repository, and the inference
 * below refuses to guess between them.
 */
export interface WorkspaceFacts {
  readonly hostId: string;
  /** The path as bb spelled it, kept so a mismatch can be reported. */
  readonly path: string;
  /** The path as the filesystem spells it; null when nothing is there. */
  readonly realPath: string | null;
  readonly isDirectory: boolean;
  /** `.git` is a directory here: the main working tree of a repository. */
  readonly isMainWorktree: boolean;
  /** `.git` is a file here: a linked worktree of some other checkout. */
  readonly isLinkedWorktree: boolean;
  /** A `.git` file points at its own repository, as inside a submodule. */
  readonly isNestedRepository: boolean;
  /** The working-tree root whose `.git` supplied the facts below. */
  readonly repositoryRoot: string | null;
  /** The `.git` directory every worktree of this repository shares. */
  readonly commonDir: string | null;
  /** `remote.<name>.url` from the repository's config. */
  readonly remoteUrl: string | null;
  /** Every worktree the repository records, the main one first. */
  readonly worktrees: readonly RepoWorktree[];
}

/** One directory, as the tree groups it. */
export interface PhysicalWorkspace {
  /** `ws:<hostId>:<realPath>`. Identity is the directory, not the record. */
  readonly key: string;
  readonly hostId: string;
  /** The canonical path; equals `rawPaths[0]` when bb spelled it canonically. */
  readonly path: string;
  /** Every spelling of it seen so far, bb's first. */
  readonly rawPaths: readonly string[];
  /** Every environment record that points at this directory. */
  readonly environmentIds: readonly string[];
  /** The bb projects those records claim. */
  readonly projectIds: readonly string[];
  readonly repoKey: string;
  readonly isMainWorktree: boolean;
  readonly isLinkedWorktree: boolean;
  readonly isNestedRepository: boolean;
  readonly repositoryRoot: string | null;
}

export type RepoKind = "git-remote" | "git-local" | "directory";

/** One repository, or one plain directory standing in for one. */
export interface RepoIdentity {
  readonly key: string;
  readonly kind: RepoKind;
  readonly name: string;
  readonly remoteUrl: string | null;
  /** The main working tree, when one was seen. */
  readonly rootPath: string | null;
  readonly hostIds: readonly string[];
  readonly projectIds: readonly string[];
  readonly workspaces: readonly PhysicalWorkspace[];
  /** Worktrees the repository records that no environment points at. */
  readonly unseenWorktrees: readonly RepoWorktree[];
  readonly diagnostics: readonly RepoDiagnostic[];
}

export type RepoDiagnosticCode =
  | "split-repo"
  | "multi-repo-project"
  | "orphan-workspace"
  | "ownership-conflict"
  | "ambiguous-owner"
  | "dangling-path"
  | "duplicate-path"
  | "unseen-worktree"
  | "path-not-canonical";

/**
 * Something the two axes disagree about.
 *
 * Deliberately not a severity and not an action. Every one of these can be
 * legitimate — a project really may own a folder outside its checkout — so the
 * sidebar's job is to say what it saw and let the user decide. The one thing it
 * must never do is draw the disagreement as if it were agreement.
 */
export interface RepoDiagnostic {
  readonly code: RepoDiagnosticCode;
  readonly repoKey: string;
  /** The projects, environments or paths the code is about. */
  readonly subjects: readonly string[];
  /** A sentence for the row's tooltip. Built here so both sides say it once. */
  readonly message: string;
}

const PERSONAL_WORKSPACE_PROVIDER = "personal-workspace";

/**
 * A path in the one spelling this module compares.
 *
 * Backslashes become slashes, runs collapse, the trailing slash goes. Case is
 * left alone: two paths differing only in case are the same directory on a
 * case-insensitive volume and two on a case-sensitive one, and only the host
 * can tell which. That is what `realPath` is for.
 */
export function normalizeRepoPath(path: string | null | undefined): string | null {
  const trimmed = path?.trim();
  if (trimmed === undefined || trimmed.length === 0) return null;
  const normalized = trimmed
    .replaceAll("\\", "/")
    .replace(/\/+/g, "/")
    .replace(/\/+$/, "");
  return normalized.length === 0 ? "/" : normalized;
}

/**
 * The identity of a directory, which is what a workspace really is.
 *
 * Not the environment id: bb can hold two records for one directory, and one
 * record can be retired and replaced. Both are the same workspace, and drawing
 * them apart is how one worktree becomes two rows.
 */
export function physicalWorkspaceKey(hostId: string, path: string): string {
  return `ws:${hostId}:${normalizeRepoPath(path) ?? path}`;
}

/**
 * A remote URL reduced to the repository it names.
 *
 * Every spelling of one repository has to land on one key or the same repo
 * drawn from two checkouts splits in two: the scp form (`git@host:owner/repo`),
 * the https form, a port, a trailing slash, the `.git` suffix, and the
 * credentials some tools leave in the URL. What survives is `host/owner/repo`,
 * which is what two clones of one repository agree on and what two forks of it
 * do not.
 *
 * Null for anything that names no repository, so the caller falls back to the
 * path rather than merging unrelated checkouts under one empty key.
 */
export function normalizeRemoteUrl(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (trimmed === undefined || trimmed.length === 0) return null;

  // Idempotent on purpose. This is the form `RepoIdentity` stores, and a caller
  // that normalizes it again must get the same answer rather than null.
  const alreadyNormalized = /^([a-z0-9.-]+\.[a-z]{2,})\/(.+)$/i.exec(trimmed);
  if (alreadyNormalized !== null) {
    const [, host, pathname] = alreadyNormalized;
    if (host !== undefined && pathname !== undefined) {
      return finishRemote(host, pathname);
    }
  }

  // scp form first: `git@github.com:owner/repo.git` has no scheme for `URL`.
  const scp = /^(?:[^@/]+@)?([^:/]+):(?!\/)(.+)$/.exec(trimmed);
  if (scp !== null && !trimmed.includes("://")) {
    const [, host, pathname] = scp;
    if (host !== undefined && pathname !== undefined) {
      return finishRemote(host, pathname);
    }
  }

  try {
    const url = new URL(trimmed);
    // A local path remote is a fact about one machine, not an identity two
    // machines share, so it is deliberately not normalized into a key.
    if (url.protocol === "file:") return null;
    return finishRemote(url.hostname, url.pathname);
  } catch {
    return null;
  }
}

function finishRemote(host: string, pathname: string): string | null {
  const hostname = host.trim().toLowerCase();
  const path = normalizeRepoPath(pathname)
    ?.replace(/^\/+/, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
  if (hostname.length === 0 || path === undefined || path.length === 0) {
    return null;
  }
  return `${hostname}/${path}`;
}

/** The last segment of a path, for naming a repository after its directory. */
function basename(path: string | null): string | null {
  if (path === null) return null;
  const parts = path.split("/").filter(Boolean);
  return parts.at(-1) ?? null;
}

/** What a repository is called when nothing better is known. */
export function repoName(remoteUrl: string | null, fallbackPath: string | null): string {
  const normalized = normalizeRemoteUrl(remoteUrl);
  if (normalized !== null) {
    return basename(normalized) ?? normalized;
  }
  return basename(normalizeRepoPath(fallbackPath)) ?? "Repository";
}

/**
 * The key one set of facts resolves to.
 *
 * A remote is preferred because it is the only identity two machines agree on:
 * the same repository cloned on a laptop and a server shares a remote and
 * shares nothing else, and keying on the local `.git` path would draw one
 * repository twice. Without a remote the path is all there is, and it is
 * honest — it names one directory on one machine.
 */
export function repoKeyOf(facts: WorkspaceFacts): string {
  const remote = normalizeRemoteUrl(facts.remoteUrl);
  if (remote !== null) return `repo:remote:${remote}`;

  const anchor = facts.commonDir ?? facts.realPath ?? normalizeRepoPath(facts.path);
  if (anchor === null) return `repo:unknown:${facts.hostId}:${facts.path}`;
  return `repo:dir:${facts.hostId}:${anchor}`;
}

function repoKindOf(facts: WorkspaceFacts): RepoKind {
  if (facts.commonDir === null && !facts.isMainWorktree && !facts.isLinkedWorktree) {
    return "directory";
  }
  return normalizeRemoteUrl(facts.remoteUrl) !== null ? "git-remote" : "git-local";
}

/** The facts for one directory, keyed either by what bb asked or by what resolved. */
function indexFacts(facts: Iterable<WorkspaceFacts>): Map<string, WorkspaceFacts> {
  const index = new Map<string, WorkspaceFacts>();
  for (const fact of facts) {
    // Both spellings, because the two questions are different: an environment is
    // looked up by the path bb recorded, and a workspace already resolved is
    // looked up by where it turned out to be.
    index.set(physicalWorkspaceKey(fact.hostId, fact.path), fact);
    if (fact.realPath !== null) {
      index.set(physicalWorkspaceKey(fact.hostId, fact.realPath), fact);
    }
  }
  return index;
}

function factsFor(
  index: ReadonlyMap<string, WorkspaceFacts>,
  hostId: string,
  path: string | null,
): WorkspaceFacts | undefined {
  if (path === null) return undefined;
  return index.get(physicalWorkspaceKey(hostId, path));
}

export interface RepoInferenceInput {
  readonly environments: Iterable<WorkspaceEnvironmentDescriptor>;
  /** projectId -> configured source. */
  readonly projects: ReadonlyMap<string, WorkspaceProjectDescriptor>;
  /**
   * Everything the host observed, in whatever order it answered. The index is
   * built here rather than by the caller, so there is no key for the caller to
   * get wrong.
   */
  readonly facts: Iterable<WorkspaceFacts>;
}

/** The physical answer for one project's configured source. */
export interface ProjectSourceFacts {
  readonly projectId: string;
  readonly hostId: string;
  readonly path: string;
  readonly repoKey: string;
  readonly isGitRepository: boolean;
  readonly repositoryRoot: string | null;
  /** The raw host observation, retained so a source-only repo can still be shown. */
  readonly facts: WorkspaceFacts | null;
}

export interface RepoInference {
  readonly repos: readonly RepoIdentity[];
  readonly diagnostics: readonly RepoDiagnostic[];
  /** projectId -> repoKey, for a caller that only wants the grouping. */
  readonly repoKeyByProject: ReadonlyMap<string, string>;
  /** projectId -> the physical source every ownership decision starts from. */
  readonly sourceByProject: ReadonlyMap<string, ProjectSourceFacts>;
  /**
   * The repository named by the source path itself.
   *
   * This is deliberately different from `repoKeyByProject`: that compatibility
   * map follows environments when a project has no readable source, while this
   * one answers the ownership question and never follows a claimed workspace.
   */
  readonly sourceRepoKeyByProject: ReadonlyMap<string, string>;
}

/**
 * The inference as it travels.
 *
 * The same shape as `RepoInference` with the map flattened, so the wire and the
 * module agree about what a repository is: a client that reads `repoKeyByProject`
 * is looking at the answer `inferRepos` produced, not at a second one it
 * rebuilt.
 */
export interface RepoFacts {
  readonly repos: readonly RepoIdentity[];
  readonly diagnostics: readonly RepoDiagnostic[];
  readonly repoKeyByProject: Readonly<Record<string, string>>;
  readonly sourceRepoKeyByProject: Readonly<Record<string, string>>;
  readonly workspaceOwnership: Readonly<Record<string, import("./workspace-ownership.ts").WorkspaceOwnership>>;
  readonly unseenWorkspaces: Readonly<
    Record<string, readonly import("./workspace-ownership.ts").UnseenOwnedWorkspace[]>
  >;
  /** Machines that did not answer; their workspaces are drawn unverified. */
  readonly unavailableHostIds: readonly string[];
}

/** Nothing probed yet: bb's own grouping, with no repository axis at all. */
export const NO_REPO_FACTS: RepoFacts = {
  repos: [],
  diagnostics: [],
  repoKeyByProject: {},
  sourceRepoKeyByProject: {},
  workspaceOwnership: {},
  unseenWorkspaces: {},
  unavailableHostIds: [],
};

/**
 * Group every environment into a repository, and report where that disagrees
 * with how bb filed it.
 *
 * The result is a pure function of bb's records plus what the disk said. A
 * workspace whose facts never arrived is still placed — under a key made from
 * its path, with a diagnostic saying it was not verified — because dropping it
 * would take the row, and the `+` on it, off the sidebar.
 */export function inferRepos(input: RepoInferenceInput): RepoInference {
  const factsIndex = indexFacts(input.facts);
  const workspaces = new Map<string, {
    key: string;
    hostId: string;
    path: string;
    rawPaths: string[];
    environmentIds: string[];
    projectIds: string[];
    repoKey: string;
    isMainWorktree: boolean;
    isLinkedWorktree: boolean;
    isNestedRepository: boolean;
    repositoryRoot: string | null;
  }>();
  const diagnostics: RepoDiagnostic[] = [];
  const unverified = new Map<string, string[]>();

  for (const environment of input.environments) {
    // A personal workspace is not a project workspace at all: it is a scratch
    // directory bb made for one thread, and grouping it under a repository
    // would invent a project the user never created.
    if (environment.providerId === PERSONAL_WORKSPACE_PROVIDER) continue;

    const rawPath = normalizeRepoPath(environment.path);
    if (rawPath === null) continue;

    const facts = factsFor(factsIndex, environment.hostId, environment.path);
    const realPath = facts?.realPath ?? rawPath;
    const key = physicalWorkspaceKey(environment.hostId, realPath);

    const repoKey = facts === undefined
      ? `repo:dir:${environment.hostId}:${realPath}`
      : repoKeyOf(facts);
    if (facts === undefined) {
      unverified.set(repoKey, [...(unverified.get(repoKey) ?? []), realPath]);
    }

    const existing = workspaces.get(key);
    if (existing === undefined) {
      workspaces.set(key, {
        key,
        hostId: environment.hostId,
        path: realPath,
        rawPaths: [rawPath],
        environmentIds: [environment.id],
        projectIds: [environment.projectId],
        repoKey,
        isMainWorktree: facts?.isMainWorktree ?? false,
        isLinkedWorktree: facts?.isLinkedWorktree ?? false,
        isNestedRepository: facts?.isNestedRepository ?? false,
        repositoryRoot: facts?.repositoryRoot ?? null,
      });
    } else {
      if (!existing.rawPaths.includes(rawPath)) existing.rawPaths.push(rawPath);
      if (!existing.environmentIds.includes(environment.id)) {
        existing.environmentIds.push(environment.id);
      }
      if (!existing.projectIds.includes(environment.projectId)) {
        existing.projectIds.push(environment.projectId);
      }
      // One directory, two records: real, harmless, and worth saying once.
      diagnostics.push({
        code: "duplicate-path",
        repoKey: existing.repoKey,
        subjects: [...existing.environmentIds],
        message:
          `bb holds ${existing.environmentIds.length} environment records for ` +
          `${existing.path}. They are drawn as one workspace.`,
      });
    }
  }

  // Paths bb did not spell canonically. Reported rather than silently fixed,
  // because the fix belongs to bb and a wrong guess would merge two real
  // directories.
  for (const workspace of workspaces.values()) {
    const mismatched = workspace.rawPaths.filter((raw) => raw !== workspace.path);
    if (mismatched.length === 0) continue;
    diagnostics.push({
      code: "path-not-canonical",
      repoKey: workspace.repoKey,
      subjects: [workspace.path, ...mismatched],
      message:
        `${mismatched[0]} resolves to ${workspace.path}. The workspace is ` +
        `grouped by the resolved path.`,
    });
  }

  // The repository each project is configured against.
  //
  // This is what makes "orphan" a real statement. A worktree is by definition
  // outside its checkout — bb's own managed ones live in bb's plugin data
  // directory — so comparing paths would call every worktree an orphan. What
  // matters is whether the workspace is in a *different repository* from the
  // one its project points at, which is the mistake worth reporting.
  const sourceRepoKeyByProject = new Map<string, string>();
  const sourceByProject = new Map<string, ProjectSourceFacts>();
  for (const [projectId, project] of input.projects) {
    const { sourcePath, sourceHostId } = project;
    if (sourcePath === null || sourceHostId === null) continue;
    const sourceFacts = factsFor(factsIndex, sourceHostId, sourcePath);
    const sourcePathCanonical =
      normalizeRepoPath(sourceFacts?.realPath ?? null) ??
      normalizeRepoPath(sourcePath) ??
      sourcePath;
    const repoKey = sourceFacts === undefined
      ? `repo:dir:${sourceHostId}:${sourcePathCanonical}`
      : repoKeyOf(sourceFacts);
    sourceRepoKeyByProject.set(projectId, repoKey);
    sourceByProject.set(projectId, {
      projectId,
      hostId: sourceHostId,
      path: sourcePathCanonical,
      repoKey,
      isGitRepository:
        sourceFacts !== undefined &&
        sourceFacts.commonDir !== null,
      repositoryRoot:
        sourceFacts?.repositoryRoot ??
        (sourceFacts?.isMainWorktree === true ? sourceFacts.realPath : null),
      facts: sourceFacts ?? null,
    });
  }

  const repos = new Map<string, {
    key: string;
    kind: RepoKind;
    name: string;
    remoteUrl: string | null;
    rootPath: string | null;
    hostIds: string[];
    projectIds: string[];
    workspaces: PhysicalWorkspace[];
    factsByHost: Map<string, WorkspaceFacts>;
  }>();

  for (const workspace of workspaces.values()) {
    const facts = factsFor(factsIndex, workspace.hostId, workspace.path);
    const bucket = repos.get(workspace.repoKey) ?? {
      key: workspace.repoKey,
      kind: facts === undefined ? ("directory" as RepoKind) : repoKindOf(facts),
      name: repoName(facts?.remoteUrl ?? null, facts?.realPath ?? workspace.path),
      remoteUrl: normalizeRemoteUrl(facts?.remoteUrl ?? null),
      rootPath: null,
      hostIds: [] as string[],
      projectIds: [] as string[],
      workspaces: [] as PhysicalWorkspace[],
      factsByHost: new Map<string, WorkspaceFacts>(),
    };

    if (facts !== undefined && facts.isMainWorktree) bucket.rootPath = facts.realPath;
    if (bucket.rootPath === null) {
      const source = [...sourceByProject.values()].find(
        (candidate) =>
          candidate.repoKey === workspace.repoKey &&
          sourceRepoKeyByProject.get(candidate.projectId) === workspace.repoKey,
      );
      bucket.rootPath = source?.repositoryRoot ?? null;
    }
    if (facts !== undefined) bucket.factsByHost.set(workspace.hostId, facts);
    if (!bucket.hostIds.includes(workspace.hostId)) bucket.hostIds.push(workspace.hostId);
    for (const projectId of workspace.projectIds) {
      if (!bucket.projectIds.includes(projectId)) bucket.projectIds.push(projectId);
    }
    bucket.workspaces.push({
      key: workspace.key,
      hostId: workspace.hostId,
      path: workspace.path,
      rawPaths: workspace.rawPaths,
      environmentIds: workspace.environmentIds,
      projectIds: workspace.projectIds,
      repoKey: workspace.repoKey,
      isMainWorktree: workspace.isMainWorktree,
      isLinkedWorktree: workspace.isLinkedWorktree,
      isNestedRepository: workspace.isNestedRepository,
      repositoryRoot: workspace.repositoryRoot,
    });
    repos.set(workspace.repoKey, bucket);
  }

  for (const source of sourceByProject.values()) {
    const bucket = repos.get(source.repoKey) ?? {
      key: source.repoKey,
      kind:
        source.facts === null
          ? ("directory" as RepoKind)
          : repoKindOf(source.facts),
      name: repoName(source.facts?.remoteUrl ?? null, source.path),
      remoteUrl: normalizeRemoteUrl(source.facts?.remoteUrl ?? null),
      rootPath: source.repositoryRoot,
      hostIds: [] as string[],
      projectIds: [] as string[],
      workspaces: [] as PhysicalWorkspace[],
      factsByHost: new Map<string, WorkspaceFacts>(),
    };
    if (!bucket.hostIds.includes(source.hostId)) bucket.hostIds.push(source.hostId);
    if (!bucket.projectIds.includes(source.projectId)) {
      bucket.projectIds.push(source.projectId);
    }
    if (source.facts !== null) {
      bucket.factsByHost.set(source.hostId, source.facts);
      bucket.rootPath ??= source.repositoryRoot;
    }
    repos.set(source.repoKey, bucket);
  }

  const result: RepoIdentity[] = [];
  for (const bucket of repos.values()) {
    const localDiagnostics: RepoDiagnostic[] = [];
    const knownByHost = new Map<string, Set<string>>();
    for (const workspace of bucket.workspaces) {
      const known = knownByHost.get(workspace.hostId) ?? new Set<string>();
      known.add(workspace.path);
      knownByHost.set(workspace.hostId, known);
    }

    // A repository the user cannot see all of. The repository's own record is
    // the only place a worktree made by another tool shows up.
    const unseen: RepoWorktree[] = [];
    for (const [hostId, facts] of bucket.factsByHost) {
      const known = knownByHost.get(hostId) ?? new Set<string>();
      for (const worktree of facts.worktrees) {
        const real = normalizeRepoPath(worktree.path);
        if (real !== null && known.has(real)) continue;
        unseen.push({ ...worktree, hostId });
      }
    }
    unseen.sort(
      (left, right) =>
        (left.hostId ?? "").localeCompare(right.hostId ?? "") ||
        left.path.localeCompare(right.path),
    );
    if (unseen.length > 0) {
      localDiagnostics.push({
        code: "unseen-worktree",
        repoKey: bucket.key,
        subjects: unseen.map((worktree) => worktree.path),
        message:
          `${bucket.name} has ${unseen.length} worktree` +
          `${unseen.length === 1 ? "" : "s"} that bb has no environment for.`,
      });
    }
    const known = new Set(
      [...knownByHost.values()].flatMap((paths) => [...paths]),
    );

    if (bucket.projectIds.length > 1) {
      localDiagnostics.push({
        code: "split-repo",
        repoKey: bucket.key,
        subjects: bucket.projectIds,
        message:
          `One repository is filed under ${bucket.projectIds.length} projects ` +
          `in bb. Its worktrees are drawn together here.`,
      });
    }

    const orphan = bucket.workspaces.filter((workspace) =>
      workspace.projectIds.some((projectId) => {
        const sourceRepoKey = sourceRepoKeyByProject.get(projectId);
        // No configured source to compare against is not a misconfiguration.
        if (sourceRepoKey === undefined) return false;
        return workspace.repoKey !== sourceRepoKey;
      }),
    );
    if (orphan.length > 0) {
      localDiagnostics.push({
        code: "orphan-workspace",
        repoKey: bucket.key,
        subjects: orphan.map((workspace) => workspace.path),
        message:
          `${orphan.length} workspace${orphan.length === 1 ? " is" : "s are"} ` +
          `in a different repository from the project's configured source.`,
      });
    }

    for (const path of unverified.get(bucket.key) ?? []) {
      if (!known.has(path)) continue;
      localDiagnostics.push({
        code: "dangling-path",
        repoKey: bucket.key,
        subjects: [path],
        message: `${path} could not be read on its machine; it is drawn unverified.`,
      });
    }

    result.push({
      key: bucket.key,
      kind: bucket.kind,
      name: bucket.name,
      remoteUrl: bucket.remoteUrl,
      rootPath: bucket.rootPath,
      hostIds: bucket.hostIds,
      projectIds: bucket.projectIds,
      workspaces: bucket.workspaces,
      unseenWorktrees: unseen,
      diagnostics: localDiagnostics,
    });
    diagnostics.push(...localDiagnostics);
  }

  // One project whose environments resolve to two repositories is the shape an
  // agent makes when it starts a thread in a subdirectory of a checkout. It is
  // not wrong, but it is the reason a project row can hold two repos.
  const reposByProject = new Map<string, Set<string>>();
  for (const repo of result) {
    for (const projectId of repo.projectIds) {
      const keys = reposByProject.get(projectId) ?? new Set<string>();
      keys.add(repo.key);
      reposByProject.set(projectId, keys);
    }
  }
  for (const [projectId, keys] of reposByProject) {
    if (keys.size < 2) continue;
    const repoKey = keys.values().next().value;
    if (repoKey === undefined) continue;
    diagnostics.push({
      code: "multi-repo-project",
      repoKey,
      subjects: [projectId, ...keys],
      message:
        `One bb project has workspaces in ${keys.size} repositories. ` +
        `Each is drawn under its own repository.`,
    });
  }

  result.sort((left, right) => left.name.localeCompare(right.name) || left.key.localeCompare(right.key));

  const repoKeyByProject = new Map<string, string>();
  for (const [projectId, repoKey] of sourceRepoKeyByProject) {
    repoKeyByProject.set(projectId, repoKey);
  }
  for (const repo of result) {
    for (const projectId of repo.projectIds) {
      if (!repoKeyByProject.has(projectId)) repoKeyByProject.set(projectId, repo.key);
    }
  }

  return {
    repos: result,
    diagnostics,
    repoKeyByProject,
    sourceByProject,
    sourceRepoKeyByProject,
  };
}

/** Whether `path` is `root` or lives under it. Path segments, not prefixes. */
export function isWithin(path: string, root: string | null): boolean {
  const normalizedRoot = normalizeRepoPath(root);
  if (normalizedRoot === null) return false;
  const normalizedPath = normalizeRepoPath(path);
  if (normalizedPath === null) return false;
  if (normalizedPath === normalizedRoot) return true;
  return normalizedPath.startsWith(normalizedRoot === "/" ? "/" : `${normalizedRoot}/`);
}
