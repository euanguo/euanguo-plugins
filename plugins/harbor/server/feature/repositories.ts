/**
 * Planning one repository in a feature, without touching the disk.
 *
 * The plan answers what a materialize would do: create a worktree, reuse one,
 * or refuse. It is the read half of adding a repository; the provisioner keeps
 * the write half and the refresh that follows it.
 */
import {
  childDirectoryFor,
  planMaterialize,
  validBranchName,
} from "../../lib/domain/feature-materialize.ts";
import { featureBranch, type Feature } from "../../lib/domain/features.ts";
import type { HostCall } from "./containers.ts";

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
  readonly role?: "worktree" | "ref";
}

export async function planFeatureRepository(input: {
  readonly args: {
    readonly featureId: string;
    readonly projectId: string;
    readonly branch?: string | null;
    readonly role?: "worktree" | "ref";
    readonly baseBranch?: string | null;
  };
  readonly requireFeature: (featureId: string) => Feature;
  readonly ensureRoot: (feature: Feature) => Promise<Feature>;
  readonly projectSource: (
    projectId: string,
  ) => Promise<{ path: string; hostId: string } | null>;
  readonly call: HostCall;
  readonly timeoutMs: number;
  readonly isRefLinked?: (featureId: string, directory: string) => boolean;
}): Promise<
  RepositoryPlan & {
    mainRepoPath: string | null;
    hostId: string;
    role: "worktree" | "ref";
    directory: string;
    baseBranch: string | null;
  }
> {
  const { args, requireFeature, ensureRoot, projectSource, call, timeoutMs, isRefLinked } = input;
  const feature = await ensureRoot(requireFeature(args.featureId));
  const source = await projectSource(args.projectId);
  const role: "worktree" | "ref" = args.role === "ref" ? "ref" : "worktree";
  const branch =
    role === "ref"
      ? "(read-only ref)"
      : args.branch?.trim() || featureBranch(feature.slug);
  const blocked = (reason: string, repository = "", path = "", directory = "") => ({
    projectId: args.projectId,
    repository,
    branch,
    path,
    outcome: "blocked" as const,
    newBranch: false,
    base: null,
    reason,
    role,
    mainRepoPath: null,
    hostId: feature.hostId ?? "",
    directory,
    baseBranch: args.baseBranch ?? null,
  });
  if (source === null) return blocked("This project has no folder on a machine.");
  const repository = repositoryNameOf(source.path);
  const directory = childDirectoryFor(repository);
  if (feature.hostId !== source.hostId) {
    return blocked(
      "This repository lives on a different machine from the feature's folder.",
      repository,
      "",
      directory,
    );
  }
  const target = `${feature.rootPath}/${directory}`;
  if (role === "ref") {
    const alreadyLinked = isRefLinked?.(feature.id, directory) === true;
    return {
      projectId: args.projectId,
      repository,
      branch,
      path: target,
      outcome: alreadyLinked ? "reuse" : "create",
      newBranch: false,
      base: null,
      reason: null,
      role: "ref",
      mainRepoPath: source.path,
      hostId: source.hostId,
      directory,
      baseBranch: null,
    };
  }
  if (!validBranchName(branch)) {
    return blocked(`${branch} is not a valid branch name.`, repository, "", directory);
  }
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
  if (probe.status === "failed") return blocked(probe.message, repository, target, directory);
  const isOwnRef = isRefLinked?.(feature.id, directory) === true;
  const decision = planMaterialize({
    featureDirectory: feature.rootPath ?? "",
    repositoryName: repository,
    branch,
    probe: isOwnRef ? { ...probe, targetExists: false } : probe,
  });
  return {
    projectId: args.projectId,
    repository,
    branch,
    path: decision.path,
    outcome: decision.status,
    newBranch: decision.status === "create" ? decision.newBranch : false,
    base:
      decision.status === "create" && decision.newBranch
        ? (args.baseBranch ?? probe.defaultBase)
        : null,
    reason: decision.status === "blocked" ? decision.reason : null,
    role: "worktree",
    mainRepoPath: probe.mainRepoPath,
    hostId: source.hostId,
    directory,
    baseBranch: args.baseBranch ?? null,
  };
}

function repositoryNameOf(sourcePath: string): string {
  const parts = sourcePath.replaceAll("\\", "/").split("/").filter(Boolean);
  return parts.at(-1) ?? "repo";
}
