/**
 * Planning one repository in a feature, without touching the disk.
 *
 * The plan answers what a materialize would do: create a worktree, reuse one,
 * or refuse. It is the read half of adding a repository; the service keeps the
 * write half and the refresh that follows it.
 */
import {
  childDirectoryFor,
  planMaterialize,
  validBranchName,
} from "../lib/domain/feature-materialize.ts";
import { featureBranch, type Feature } from "../lib/domain/features.ts";
import type { HostCall } from "./feature-containers.ts";

export interface RepositoryPlan {
  readonly projectId: string;
  readonly repository: string;
  readonly branch: string;
  readonly path: string;
  readonly outcome: "create" | "reuse" | "blocked";
  /** Set when `outcome` is `create`: whether the branch is new. */
  readonly newBranch: boolean;
  /** Where a new branch starts, before the fetch. */
  readonly base: string | null;
  readonly reason: string | null;
}

export async function planFeatureRepository(input: {
  readonly args: {
    readonly featureId: string;
    readonly projectId: string;
    readonly branch?: string | null;
  };
  readonly requireFeature: (featureId: string) => Feature;
  readonly ensureRoot: (feature: Feature) => Promise<Feature>;
  readonly projectSource: (
    projectId: string,
  ) => Promise<{ path: string; hostId: string } | null>;
  readonly call: HostCall;
  readonly timeoutMs: number;
}): Promise<RepositoryPlan & { mainRepoPath: string | null; hostId: string }> {
  const { args, requireFeature, ensureRoot, projectSource, call, timeoutMs } = input;
  const feature = await ensureRoot(requireFeature(args.featureId));
  const source = await projectSource(args.projectId);
  const branch = args.branch?.trim() || featureBranch(feature.slug);
  const blocked = (reason: string, repository = "", path = "") => ({
    projectId: args.projectId,
    repository,
    branch,
    path,
    outcome: "blocked" as const,
    newBranch: false,
    base: null,
    reason,
    mainRepoPath: null,
    hostId: feature.hostId ?? "",
  });
  if (source === null) return blocked("This project has no folder on a machine.");
  const repository = repositoryNameOf(source.path);
  if (!validBranchName(branch)) return blocked(`${branch} is not a valid branch name.`, repository);
  if (feature.hostId !== source.hostId) {
    return blocked(
      "This repository lives on a different machine from the feature's folder.",
      repository,
    );
  }
  const target = `${feature.rootPath}/${childDirectoryFor(repository)}`;
  const probe = await call<
    | {
        status: "ok";
        repository: boolean;
        mainWorktree: boolean;
        mainRepoPath: string | null;
        worktrees: readonly { path: string; branch: string | null }[];
        branchExists: boolean;
        targetExists: boolean;
        defaultBase: string;
      }
    | { status: "failed"; message: string }
  >(
    "probeFeatureWorktree",
    { sourcePath: source.path, branch, targetPath: target },
    source.hostId,
    timeoutMs,
  );
  if (probe.status === "failed") return blocked(probe.message, repository, target);
  const decision = planMaterialize({
    featureDirectory: feature.rootPath ?? "",
    repositoryName: repository,
    branch,
    probe,
  });
  return {
    projectId: args.projectId,
    repository,
    branch,
    path: decision.path,
    outcome: decision.status,
    newBranch: decision.status === "create" ? decision.newBranch : false,
    base: decision.status === "create" && decision.newBranch ? probe.defaultBase : null,
    reason: decision.status === "blocked" ? decision.reason : null,
    mainRepoPath: probe.mainRepoPath,
    hostId: source.hostId,
  };
}

function repositoryNameOf(sourcePath: string): string {
  const parts = sourcePath.replaceAll("\\", "/").split("/").filter(Boolean);
  return parts.at(-1) ?? "repo";
}
