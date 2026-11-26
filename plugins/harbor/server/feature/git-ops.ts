/**
 * Server-side Multi-Repo Git Cockpit, Health Check, and `.code-workspace` import
 * coordination built over Harbor's host entries.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import {
  aggregateFeatureGitStatus,
  buildFeatureHealthReport,
  type CockpitRepoRole,
  type DiffFileEntry,
  type FeatureGitSummary,
  type FeatureHealthReport,
  type FeatureRepoGitStatus,
} from "../../lib/domain/feature-git.ts";
import { parseCodeWorkspaceJson } from "../../lib/domain/feature-presets.ts";
import {
  featureForPath,
  normalizeFeaturePath,
  type Feature,
  type FeatureMember,
} from "../../lib/domain/features.ts";
import type { FeatureRefLinkStore } from "../../lib/stores/feature-ref-link-store.ts";
import type { FeatureStore } from "../../lib/stores/feature-store.ts";
import type { HostCall } from "./containers.ts";
import {
  FeatureError,
  PROBE_TIMEOUT_MS,
  SCAN_TIMEOUT_MS,
  type FeatureSnapshot,
} from "./types.ts";

function dirnameOf(path: string): string {
  const cleaned = normalizeFeaturePath(path);
  const slash = cleaned.lastIndexOf("/");
  return slash <= 0 ? "/" : cleaned.slice(0, slash);
}

function basenameOf(path: string): string {
  const cleaned = normalizeFeaturePath(path);
  const slash = cleaned.lastIndexOf("/");
  return slash === -1 ? cleaned : cleaned.slice(slash + 1);
}

export function createFeatureGitOps(input: {
  readonly bb: BbPluginApi;
  readonly store: FeatureStore;
  readonly refLinks: FeatureRefLinkStore;
  readonly call: HostCall;
  readonly getCached: () => FeatureSnapshot;
  readonly requireFeature: (featureId: string) => Feature;
  readonly membersOf: (featureId: string) => readonly FeatureMember[];
  readonly createdBranchCount: (featureId: string) => number;
  readonly invalidate: (tags: readonly string[]) => void;
}) {
  const {
    bb,
    store,
    refLinks,
    call,
    getCached,
    requireFeature,
    membersOf,
    createdBranchCount,
    invalidate,
  } = input;

  interface ResolvedCockpitRepo {
    readonly directory: string;
    readonly repository: string;
    readonly role: CockpitRepoRole;
    readonly path: string;
    readonly hostId: string;
  }

  const resolveFeatureRepos = async (
    feature: Feature,
  ): Promise<ResolvedCockpitRepo[]> => {
    const resolved: ResolvedCockpitRepo[] = [];
    const seenPaths = new Set<string>();
    const seenDirectories = new Set<string>();
    const trackedRefs = new Set(
      refLinks
        .list(feature.id)
        .map((link) => normalizeFeaturePath(link.sourcePath)),
    );

    // Check adopted external worktrees first so promoted worktrees remain
    // editable (`role: "worktree"`) even if exposed inside the root via symlink.
    const adoptions = store.adoptions();
    const adoptedIds = Object.entries(adoptions)
      .filter(([, fid]) => fid === feature.id)
      .map(([envId]) => envId);
    const adoptedPaths = new Set<string>();
    if (adoptedIds.length > 0 && feature.hostId !== null) {
      const envs = await bb.sdk.environments
        .list({ limit: 1_000 })
        .catch(() => []);
      for (const env of envs) {
        if (!adoptedIds.includes(env.id) || typeof env.path !== "string") {
          continue;
        }
        const norm = normalizeFeaturePath(env.path);
        adoptedPaths.add(norm);
        if (featureForPath([feature], norm) !== null) continue;
        const dir = basenameOf(norm);
        if (seenDirectories.has(dir) || seenPaths.has(norm)) continue;
        seenDirectories.add(dir);
        seenPaths.add(norm);
        resolved.push({
          directory: dir,
          repository: env.name ?? dir,
          role: "worktree",
          path: norm,
          hostId: env.hostId,
        });
      }
    }

    for (const member of membersOf(feature.id)) {
      const targetNorm = normalizeFeaturePath(member.repositoryPath);
      const isAdopted = adoptedPaths.has(targetNorm);
      const role: CockpitRepoRole =
        isAdopted
          ? "worktree"
          : member.role === "ref" || trackedRefs.has(targetNorm)
            ? "ref"
            : member.role === "submodule"
              ? "submodule"
              : "worktree";
      const realNorm = isAdopted ? targetNorm : normalizeFeaturePath(member.path);
      if (
        seenDirectories.has(member.directory) ||
        seenPaths.has(realNorm) ||
        seenPaths.has(targetNorm)
      ) {
        continue;
      }
      seenDirectories.add(member.directory);
      seenPaths.add(realNorm);
      seenPaths.add(targetNorm);
      resolved.push({
        directory: member.directory,
        repository: member.repository,
        role,
        path: realNorm,
        hostId: member.hostId,
      });
    }

    for (const link of refLinks.list(feature.id)) {
      const norm = normalizeFeaturePath(link.sourcePath);
      if (seenDirectories.has(link.directory) || seenPaths.has(norm)) continue;
      seenDirectories.add(link.directory);
      seenPaths.add(norm);
      resolved.push({
        directory: link.directory,
        repository: link.repository,
        role: "ref",
        path: norm,
        hostId: link.hostId,
      });
    }

    return resolved;
  };

  const getFeatureGitStatus = async (
    featureId: string,
    baseBranch?: string | null,
  ): Promise<FeatureGitSummary> => {
    const feature = requireFeature(featureId);
    const repos = await resolveFeatureRepos(feature);
    if (repos.length === 0) {
      return aggregateFeatureGitStatus(featureId, []);
    }

    const byHost = new Map<string, ResolvedCockpitRepo[]>();
    for (const repo of repos) {
      const bucket = byHost.get(repo.hostId) ?? [];
      bucket.push(repo);
      byHost.set(repo.hostId, bucket);
    }

    const results: FeatureRepoGitStatus[] = [];
    for (const [hostId, hostRepos] of byHost) {
      let hostError: string | null = null;
      const answer = await call<{ repos: FeatureRepoGitStatus[] }>(
        "inspectFeatureGitStatus",
        {
          repos: hostRepos.map(({ directory, repository, role, path }) => ({
            directory,
            repository,
            role,
            path,
          })),
          baseBranch: baseBranch ?? null,
        },
        hostId,
        SCAN_TIMEOUT_MS,
      ).catch((error: unknown) => {
        hostError = error instanceof Error ? error.message : String(error);
        return {
          repos: hostRepos.map(
            ({ directory, repository, role, path }): FeatureRepoGitStatus => ({
              directory,
              repository,
              role,
              path,
              branch: null,
              upstream: null,
              exists: true,
              stagedFiles: 0,
              unstagedFiles: 0,
              untrackedFiles: 0,
              changedFiles: 0,
              additions: 0,
              deletions: 0,
              aheadCommits: null,
              behindCommits: null,
              clean: false,
              statusError: hostError ?? "Could not reach machine for git status.",
              lastCommitSubject: null,
              submodules: [],
            }),
          ),
        };
      });
      results.push(...answer.repos);
    }

    // Preserve original repo ordering.
    const byDir = new Map(results.map((entry) => [entry.directory, entry]));
    const ordered = repos.flatMap((repo) => {
      const hit = byDir.get(repo.directory);
      return hit === undefined ? [] : [hit];
    });
    return aggregateFeatureGitStatus(featureId, ordered);
  };

  const requireMemberRepo = async (featureId: string, directory: string) => {
    const feature = requireFeature(featureId);
    const repos = await resolveFeatureRepos(feature);
    const target = repos.find((repo) => repo.directory === directory);
    if (target === undefined) {
      throw new FeatureError(
        `Repository "${directory}" is not part of this feature.`,
        "not-found",
      );
    }
    return { feature, repo: target };
  };

  const readFeatureRepoDiff = async (args: {
    readonly featureId: string;
    readonly directory: string;
    readonly filePath?: string | null;
    readonly includeUntracked?: boolean;
  }): Promise<{
    readonly directory: string;
    readonly repository: string;
    readonly branch: string | null;
    readonly files: readonly DiffFileEntry[];
  }> => {
    const { repo } = await requireMemberRepo(args.featureId, args.directory);
    const answer = await call<{
      status: "ok" | "failed";
      message: string | null;
      branch: string | null;
      files: DiffFileEntry[];
    }>(
      "readRepoDiff",
      {
        path: repo.path,
        filePath: args.filePath ?? null,
        includeUntracked: args.includeUntracked ?? true,
      },
      repo.hostId,
      PROBE_TIMEOUT_MS,
    );
    if (answer.status === "failed") {
      throw new FeatureError(
        answer.message ?? `Could not inspect diff for ${args.directory}.`,
        "unavailable",
      );
    }
    return {
      directory: repo.directory,
      repository: repo.repository,
      branch: answer.branch,
      files: answer.files,
    };
  };

  const pushFeatureRepo = async (args: {
    readonly featureId: string;
    readonly directory: string;
  }) => {
    const { repo } = await requireMemberRepo(args.featureId, args.directory);
    if (repo.role === "ref") {
      throw new FeatureError(
        `${args.directory} is attached as a read-only reference.`,
        "blocked",
      );
    }
    const answer = await call<
      | { status: "pushed"; branch: string | null }
      | { status: "failed"; message: string }
    >("pushRepoBranch", { path: repo.path }, repo.hostId, 60_000);
    if (answer.status === "failed") {
      throw new FeatureError(answer.message, "unavailable");
    }
    invalidate([`feature-git:${args.featureId}`]);
    return answer;
  };

  const inspectFeatureHealth = async (args: {
    readonly featureId: string;
    readonly deletesBranches: boolean;
  }): Promise<FeatureHealthReport> => {
    const feature = requireFeature(args.featureId);
    if (
      feature.hostId !== null &&
      getCached().memberScanFailures.includes(feature.hostId)
    ) {
      throw new FeatureError(
        `Could not reach ${feature.name}'s machine to verify git health.`,
        "unavailable",
      );
    }
    const gitSummary = await getFeatureGitStatus(feature.id);
    const environments = await bb.sdk.environments
      .list({
        ...(feature.hostId === null ? {} : { hostId: feature.hostId }),
        limit: 1_000,
      })
      .catch(() => []);
    const adoptions = store.adoptions();
    const matchedEnvs = environments.filter(
      (environment) =>
        featureForPath([feature], environment.path) !== null ||
        adoptions[environment.id] === feature.id,
    );
    const threadLists = await Promise.all(
      matchedEnvs.map((environment) =>
        bb.sdk.threads
          .list({ environmentId: environment.id, archived: false })
          .catch(() => []),
      ),
    );
    const threadCount = threadLists.reduce((sum, rows) => sum + rows.length, 0);
    return buildFeatureHealthReport({
      featureId: feature.id,
      featureName: feature.name,
      rootPath: feature.rootPath,
      gitSummary,
      threadCount,
      createdBranches: createdBranchCount(feature.id),
      deletesBranches: args.deletesBranches,
    });
  };

  const importCodeWorkspace = async (args: {
    readonly hostId: string;
    readonly filePath: string;
  }) => {
    const file = await call<
      | { status: "ok"; content: string }
      | { status: "failed"; message: string }
    >(
      "readCodeWorkspaceFile",
      { path: args.filePath },
      args.hostId,
      PROBE_TIMEOUT_MS,
    );
    if (file.status === "failed") {
      throw new FeatureError(file.message, "not-found");
    }
    const folders = parseCodeWorkspaceJson(file.content, dirnameOf(args.filePath));
    const projects = await bb.sdk.projects.list({}).catch(() => []);
    const matched: {
      projectId: string;
      projectName: string;
      path: string;
      name: string | null;
    }[] = [];
    const unmatchedPaths: string[] = [];
    const seenProjects = new Set<string>();

    for (const folder of folders) {
      const folderNorm = normalizeFeaturePath(folder.path);
      const match = projects.find((project) =>
        project.sources.some(
          (source) =>
            source.hostId === args.hostId &&
            typeof source.path === "string" &&
            normalizeFeaturePath(source.path) === folderNorm,
        ),
      );
      if (match === undefined) {
        unmatchedPaths.push(folder.path);
        continue;
      }
      if (seenProjects.has(match.id)) continue;
      seenProjects.add(match.id);
      matched.push({
        projectId: match.id,
        projectName: match.name,
        path: folder.path,
        name: folder.name,
      });
    }

    const baseName = basenameOf(args.filePath).replace(/\.code-workspace$/iu, "");
    return {
      name: baseName || "Imported workspace",
      matched,
      unmatchedPaths,
    };
  };

  return {
    getFeatureGitStatus,
    readFeatureRepoDiff,
    pushFeatureRepo,
    inspectFeatureHealth,
    importCodeWorkspace,
  };
}
