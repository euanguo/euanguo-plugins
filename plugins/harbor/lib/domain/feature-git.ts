/**
 * Pure domain types and aggregators for Multi-Repo Git Cockpit status, per-repo
 * read-only diffs, Cross-Repo Delivery Matrix readiness, and Finish health checks.
 */

import type {
  CockpitRepoRole,
  DiffFileEntry,
  DiffFileStatus,
  FeatureGitSummary,
  FeatureHealthRepo,
  FeatureHealthReport,
  FeatureRepoGitStatus,
  RepoSubmoduleStatus,
} from "../schemas/feature.ts";

export type {
  CockpitRepoRole,
  DiffFileEntry,
  DiffFileStatus,
  FeatureGitSummary,
  FeatureHealthRepo,
  FeatureHealthReport,
  FeatureRepoGitStatus,
  RepoSubmoduleStatus,
};

/** Classifies a single-file unified git patch for rendering fallbacks. */
export function classifyDiffPatch(patch: string): "hunks" | "binary" | "empty" {
  if (/Binary files .+ differ|GIT binary patch/u.test(patch)) {
    return "binary";
  }
  const hunkStart = patch.search(/^@@\s/mu);
  if (hunkStart === -1) {
    return "empty";
  }
  const afterHeader = patch.slice(hunkStart).replace(/^@@[^\n]*(?:\n|$)/u, "");
  if (!/^[+\- ]/mu.test(afterHeader)) {
    return "empty";
  }
  return "hunks";
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
    if (repo.role === "ref") continue;
    additions += repo.additions;
    deletions += repo.deletions;
    if (!repo.clean || repo.statusError) dirtyRepoCount += 1;
    if ((repo.behindCommits ?? 0) > 0) behindRepoCount += 1;
    if ((repo.aheadCommits ?? 0) > 0) unpushedRepoCount += 1;
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
    if (repo.statusError) {
      blockerReason = repo.statusError;
    } else if (uncommittedCount > 0) {
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
      clean: repo.clean && !repo.statusError,
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
      repos.every(
        (repo) =>
          repo.clean &&
          repo.blockerReason === null &&
          (repo.aheadCommits ?? 0) === 0,
      ),
    warnings,
  };
}

export type DeliveryRepoReadiness =
  | "missing"
  | "error"
  | "ref"
  | "dirty"
  | "behind"
  | "ahead"
  | "synced"
  | "local";

export interface DeliveryMatrixSummary {
  readonly writableRepoCount: number;
  readonly refRepoCount: number;
  readonly dirtyRepoCount: number;
  readonly unpushedRepoCount: number;
  readonly behindRepoCount: number;
  readonly cleanAheadRepos: readonly FeatureRepoGitStatus[];
  readonly pushableRepos: readonly FeatureRepoGitStatus[];
}

export function canPushFeatureRepo(repo: FeatureRepoGitStatus): boolean {
  return (
    repo.role !== "ref" &&
    repo.exists &&
    !repo.statusError &&
    (repo.aheadCommits ?? 0) > 0
  );
}

export function summarizeDeliveryMatrix(
  summary: FeatureGitSummary,
): DeliveryMatrixSummary {
  let writableRepoCount = 0;
  let refRepoCount = 0;
  const cleanAheadRepos: FeatureRepoGitStatus[] = [];
  const pushableRepos: FeatureRepoGitStatus[] = [];

  for (const repo of summary.repos) {
    if (repo.role === "ref") {
      refRepoCount += 1;
      continue;
    }
    writableRepoCount += 1;
    if (canPushFeatureRepo(repo)) {
      pushableRepos.push(repo);
      if (repo.clean) cleanAheadRepos.push(repo);
    }
  }

  return {
    writableRepoCount,
    refRepoCount,
    dirtyRepoCount: summary.dirtyRepoCount,
    unpushedRepoCount: summary.unpushedRepoCount,
    behindRepoCount: summary.behindRepoCount,
    cleanAheadRepos,
    pushableRepos,
  };
}

export function deliveryRepoReadiness(
  repo: FeatureRepoGitStatus,
): DeliveryRepoReadiness {
  if (!repo.exists) return "missing";
  if (repo.statusError) return "error";
  if (repo.role === "ref") return "ref";
  if (!repo.clean) return "dirty";
  if ((repo.behindCommits ?? 0) > 0) return "behind";
  if ((repo.aheadCommits ?? 0) > 0) return "ahead";
  return repo.upstream ? "synced" : "local";
}

function quoteShellPath(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function buildCrossRepoGitStatusCommand(
  repos: readonly FeatureRepoGitStatus[],
): string {
  return repos
    .filter((repo) => repo.exists)
    .map((repo) => `git -C ${quoteShellPath(repo.path)} status -sb`)
    .join("\n");
}
