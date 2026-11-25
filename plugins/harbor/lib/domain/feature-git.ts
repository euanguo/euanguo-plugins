/**
 * Pure domain types and aggregators for Multi-Repo Git Cockpit status, per-repo
 * diffs, commit suggestions, and Finish pre-flight health checks.
 */

export interface RepoSubmoduleStatus {
  readonly path: string;
  readonly name: string;
  readonly dirty: boolean;
  readonly commit: string | null;
}

export type CockpitRepoRole = "worktree" | "ref" | "submodule";

export interface FeatureRepoGitStatus {
  readonly directory: string;
  readonly repository: string;
  readonly role: CockpitRepoRole;
  readonly path: string;
  readonly branch: string | null;
  readonly upstream: string | null;
  readonly exists: boolean;
  readonly stagedFiles: number;
  readonly unstagedFiles: number;
  readonly untrackedFiles: number;
  readonly changedFiles: number;
  readonly additions: number;
  readonly deletions: number;
  readonly aheadCommits: number | null;
  readonly behindCommits: number | null;
  readonly clean: boolean;
  readonly lastCommitSubject: string | null;
  readonly submodules: readonly RepoSubmoduleStatus[];
}

export interface FeatureGitSummary {
  readonly featureId: string;
  readonly additions: number;
  readonly deletions: number;
  readonly dirtyRepoCount: number;
  readonly behindRepoCount: number;
  readonly unpushedRepoCount: number;
  readonly repos: readonly FeatureRepoGitStatus[];
}

export type DiffFileStatus =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "untracked";

export interface DiffFileEntry {
  readonly filePath: string;
  readonly status: DiffFileStatus;
  readonly staged: boolean;
  readonly additions: number;
  readonly deletions: number;
  readonly patch: string;
  readonly truncated: boolean;
}

export interface FeatureHealthRepo {
  readonly directory: string;
  readonly repository: string;
  readonly role: CockpitRepoRole;
  readonly path: string;
  readonly branch: string | null;
  readonly clean: boolean;
  readonly changedFiles: number;
  readonly untrackedFiles: number;
  readonly aheadCommits: number | null;
  readonly behindCommits: number | null;
  readonly additions: number;
  readonly deletions: number;
  readonly blockerReason: string | null;
}

export interface FeatureHealthReport {
  readonly featureId: string;
  readonly featureName: string;
  readonly rootPath: string | null;
  readonly repos: readonly FeatureHealthRepo[];
  readonly blockedCount: number;
  readonly threadCount: number;
  readonly createdBranches: number;
  readonly canDeleteBranches: boolean;
  readonly warnings: readonly string[];
}

export function aggregateFeatureGitStatus(
  featureId: string,
  repos: readonly FeatureRepoGitStatus[],
): FeatureGitSummary {
  let additions = 0;
  let deletions = 0;
  let dirtyRepoCount = 0;
  let behindRepoCount = 0;
  let unpushedRepoCount = 0;

  for (const repo of repos) {
    additions += repo.additions;
    deletions += repo.deletions;
    if (repo.role !== "ref" && !repo.clean) dirtyRepoCount += 1;
    if ((repo.behindCommits ?? 0) > 0) behindRepoCount += 1;
    if (repo.role !== "ref" && (repo.aheadCommits ?? 0) > 0) {
      unpushedRepoCount += 1;
    }
  }

  return {
    featureId,
    additions,
    deletions,
    dirtyRepoCount,
    behindRepoCount,
    unpushedRepoCount,
    repos: [...repos],
  };
}

export function buildFeatureHealthReport(input: {
  readonly featureId: string;
  readonly featureName: string;
  readonly rootPath: string | null;
  readonly gitSummary: FeatureGitSummary;
  readonly threadCount: number;
  readonly createdBranches: number;
  readonly deletesBranches: boolean;
}): FeatureHealthReport {
  const warnings: string[] = [];
  let blockedCount = 0;
  const repos: FeatureHealthRepo[] = input.gitSummary.repos.map((repo) => {
    if (repo.role === "ref") {
      return {
        directory: repo.directory,
        repository: repo.repository,
        role: repo.role,
        path: repo.path,
        branch: repo.branch,
        clean: true,
        changedFiles: 0,
        untrackedFiles: 0,
        aheadCommits: null,
        behindCommits: repo.behindCommits,
        additions: 0,
        deletions: 0,
        blockerReason: null,
      };
    }

    const uncommittedCount = repo.changedFiles + repo.untrackedFiles;
    const unpushed = (repo.aheadCommits ?? 0) > 0;
    let blockerReason: string | null = null;
    if (uncommittedCount > 0) {
      blockerReason = `${uncommittedCount} uncommitted ${uncommittedCount === 1 ? "file" : "files"}`;
    } else if (input.deletesBranches && unpushed) {
      blockerReason = `${repo.aheadCommits} unpushed ${repo.aheadCommits === 1 ? "commit" : "commits"}`;
    }
    if (blockerReason !== null) {
      blockedCount += 1;
      warnings.push(`${repo.directory}: ${blockerReason}`);
    }

    return {
      directory: repo.directory,
      repository: repo.repository,
      role: repo.role,
      path: repo.path,
      branch: repo.branch,
      clean: repo.clean,
      changedFiles: repo.changedFiles,
      untrackedFiles: repo.untrackedFiles,
      aheadCommits: repo.aheadCommits,
      behindCommits: repo.behindCommits,
      additions: repo.additions,
      deletions: repo.deletions,
      blockerReason,
    };
  });

  const pluralThreads = input.threadCount === 1 ? "thread" : "threads";
  if (input.threadCount > 0) {
    warnings.push(`${input.threadCount} ${pluralThreads} will be archived`);
  }

  return {
    featureId: input.featureId,
    featureName: input.featureName,
    rootPath: input.rootPath,
    repos,
    blockedCount,
    threadCount: input.threadCount,
    createdBranches: input.createdBranches,
    canDeleteBranches:
      input.createdBranches > 0 &&
      repos.every((repo) => repo.clean && (repo.aheadCommits ?? 0) === 0),
    warnings,
  };
}

/**
 * Generates a concise conventional-style commit message draft from changed
 * file paths, feature name, and optional standing decisions.
 */
export function suggestCommitMessageFromFiles(input: {
  readonly repository: string;
  readonly featureName: string;
  readonly branch: string | null;
  readonly files: readonly Pick<DiffFileEntry, "filePath" | "status">[];
}): string {
  const dirs = new Set<string>();
  let allTests = input.files.length > 0;
  let allDocs = input.files.length > 0;

  for (const file of input.files) {
    const lower = file.filePath.toLowerCase();
    if (!/(^|\/)(test|tests|__tests__|.*\.test\.|.*\.spec\.)/u.test(lower)) {
      allTests = false;
    }
    if (!/(^|\/)(docs\/|readme|.*\.md$)/u.test(lower)) {
      allDocs = false;
    }
    const parts = file.filePath.split("/").filter((part) => part.length > 0);
    if (parts.length > 1) {
      const candidate = parts[0] === "src" && parts[1] ? parts[1] : parts[0];
      if (candidate) dirs.add(candidate);
    }
  }

  const kind = allDocs ? "docs" : allTests ? "test" : "feat";
  const scope =
    dirs.size === 1
      ? [...dirs][0]
      : input.repository.toLowerCase().replace(/[^a-z0-9-]+/gu, "-");
  const topicSource =
    input.featureName.trim().length > 0
      ? input.featureName.trim()
      : input.branch?.replace(/^feat\//u, "") ?? "updates";
  const cleanTopic = topicSource
    .replace(/\s+/gu, " ")
    .slice(0, 56);
  return `${kind}(${scope}): ${cleanTopic}`;
}
