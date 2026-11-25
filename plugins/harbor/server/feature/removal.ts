/**
 * Finishing, reopening, deleting features, and removing single repository members.
 */
import { isWithinPath } from "../../lib/domain/feature-root.ts";
import {
  featureForPath,
  normalizeFeaturePath,
  planFeatureRemoval,
  type Feature,
  type FeatureMember,
  type FeatureRemovalSurvey,
} from "../../lib/domain/features.ts";
import { archiveFeatureThreads, removeFeatureMembers } from "./removal-ops.ts";
import {
  FeatureError,
  PROBE_TIMEOUT_MS,
  type FeatureServiceCore,
  type FeatureSnapshot,
} from "./types.ts";

export function createFeatureRemoval(input: {
  readonly core: FeatureServiceCore;
  readonly refresh: () => Promise<FeatureSnapshot>;
}) {
  const { core, refresh } = input;
  const {
    bb,
    store,
    repository,
    call,
    publish,
    getCached,
    membersOf,
    requireFeature,
    writeContext,
  } = core;

  /** Every bb environment inside a feature's folder: its root and its members. */
  const environmentsOf = async (feature: Feature) => {
    if (feature.rootPath === null || feature.hostId === null) return [];
    const environments = await bb.sdk.environments.list({
      hostId: feature.hostId,
      limit: 1_000,
    });
    const cached = getCached();
    return environments.filter(
      (environment) =>
        featureForPath([feature], environment.path) !== null ||
        cached.adoptions[environment.id] === feature.id,
    );
  };

  const adoptedEnvByTargetPath = (
    feature: Feature,
    environments: readonly { readonly id: string; readonly path: string | null }[],
  ): ReadonlyMap<string, string> => {
    const adoptions = store.adoptions();
    const byTarget = new Map<string, string>();
    for (const environment of environments) {
      if (adoptions[environment.id] !== feature.id) continue;
      if (environment.path === null) continue;
      if (featureForPath([feature], environment.path) !== null) continue;
      byTarget.set(normalizeFeaturePath(environment.path), environment.id);
    }
    return byTarget;
  };

  const survey = async (
    featureId: string,
    options: { readonly deletesBranches: boolean },
  ) => {
    await refresh();
    const feature = requireFeature(featureId);
    if (
      feature.hostId !== null &&
      getCached().memberScanFailures.includes(feature.hostId)
    ) {
      throw new FeatureError(
        `Could not read the repositories of ${feature.name}. Nothing was removed.`,
        "unavailable",
      );
    }
    const allMembers = membersOf(featureId);
    const environments = await environmentsOf(feature);
    const adoptedTargets = adoptedEnvByTargetPath(feature, environments);
    const worktreeMembers = allMembers.filter(
      (member) =>
        member.role !== "ref" &&
        !adoptedTargets.has(normalizeFeaturePath(member.repositoryPath)),
    );
    const worktrees =
      worktreeMembers.length === 0 || feature.hostId === null
        ? ([] as FeatureRemovalSurvey["worktrees"])
        : await call<{ worktrees: FeatureRemovalSurvey["worktrees"] }>(
            "inspectFeatureWorktrees",
            { paths: worktreeMembers.map((member) => member.path) },
            feature.hostId,
            PROBE_TIMEOUT_MS,
          ).then((answer) => answer.worktrees);
    const threadLists = await Promise.all(
      environments.map((environment) =>
        bb.sdk.threads.list({ environmentId: environment.id, archived: false }),
      ),
    );
    const threadCount = threadLists.reduce((total, list) => total + list.length, 0);
    const result = planFeatureRemoval({ worktrees, threadCount }, options);
    return {
      feature,
      members: worktreeMembers,
      allMembers,
      environments,
      adoptedTargets,
      worktrees,
      threadCount,
      warnings: result.warnings,
      requiresConfirmation: result.requiresConfirmation,
    };
  };

  const unlinkRefMembers = async (
    feature: Feature,
    members: readonly FeatureMember[],
    adoptedTargets: ReadonlyMap<string, string>,
  ) => {
    if (feature.rootPath === null || feature.hostId === null) return;
    for (const member of members) {
      if (
        member.role !== "ref" &&
        !adoptedTargets.has(normalizeFeaturePath(member.repositoryPath))
      ) {
        continue;
      }
      await call(
        "unlinkFeatureReference",
        { featureDirectory: feature.rootPath, directory: member.directory },
        feature.hostId,
        PROBE_TIMEOUT_MS,
      ).catch(() => undefined);
    }
  };

  /**
   * Finish: the work is done, so its worktrees go and its record stays.
   *
   * Branches and the feature folder (`AGENTS.md`) stay so reopening finds them.
   */
  const finish = async (featureId: string, acknowledged: boolean) => {
    const surveyed = await survey(featureId, { deletesBranches: false });
    if (surveyed.requiresConfirmation && !acknowledged) {
      throw new FeatureError(
        `This feature still holds work: ${surveyed.warnings.join("; ")}.`,
        "blocked",
      );
    }
    const archived = await archiveFeatureThreads(
      bb,
      surveyed.environments.map((environment) => environment.id),
    );
    if (archived.failedEnvironmentIds.length > 0) {
      throw new FeatureError(
        `Could not archive threads: ${archived.message ?? "bb did not say why"}. The feature was not changed.`,
        "unavailable",
      );
    }
    const { removed, leftovers } = await removeFeatureMembers({
      members: surveyed.members,
      call,
    });
    await unlinkRefMembers(surveyed.feature, surveyed.allMembers, surveyed.adoptedTargets);
    repository.refLinks.deleteForFeature(featureId);
    store.setState(featureId, "archived");
    await refresh();
    const feature = store.find(featureId);
    if (feature !== undefined) await writeContext(feature, membersOf(featureId));
    publish();
    return {
      archivedThreads: archived.archived,
      removedWorktrees: removed,
      leftovers,
    };
  };

  const reopen = async (featureId: string) => {
    requireFeature(featureId);
    store.setState(featureId, "active");
    await refresh();
    publish();
  };

  /** Delete: everything finish does, then the folder, and recorded branches if asked. */
  const remove = async (args: {
    featureId: string;
    acknowledged: boolean;
    deleteBranches: boolean;
  }) => {
    const surveyed = await survey(args.featureId, { deletesBranches: args.deleteBranches });
    if (surveyed.requiresConfirmation && !args.acknowledged) {
      throw new FeatureError(
        `This feature still holds work: ${surveyed.warnings.join("; ")}.`,
        "blocked",
      );
    }
    const { feature } = surveyed;
    const archived = await archiveFeatureThreads(
      bb,
      surveyed.environments.map((environment) => environment.id),
    );
    if (archived.failedEnvironmentIds.length > 0) {
      throw new FeatureError(
        `Could not archive threads: ${archived.message ?? "bb did not say why"}. Nothing was removed.`,
        "unavailable",
      );
    }
    const { removed, leftovers } = await removeFeatureMembers({
      members: surveyed.members,
      call,
    });
    if (leftovers.length > 0) {
      await refresh();
      await writeContext(feature, membersOf(feature.id));
      publish();
      return {
        archivedThreads: archived.archived,
        removedWorktrees: removed,
        leftovers,
        deletedBranches: 0,
        removedFolder: false,
      };
    }
    await unlinkRefMembers(feature, surveyed.allMembers, surveyed.adoptedTargets);
    let deletedBranches = 0;
    if (args.deleteBranches) {
      for (const target of store.branches(feature.id)) {
        const answer = await call<{ status: string }>(
          "deleteFeatureBranch",
          { mainRepoPath: target.repositoryPath, branch: target.branch },
          target.hostId,
          PROBE_TIMEOUT_MS,
        ).catch(() => ({ status: "kept" }));
        if (answer.status === "deleted") deletedBranches += 1;
      }
    }
    let removedFolder = false;
    if (feature.rootPath !== null && feature.hostId !== null) {
      const answer = await call<{ status: string }>(
        "removeFeatureDirectory",
        { featureDirectory: feature.rootPath },
        feature.hostId,
        PROBE_TIMEOUT_MS,
      ).catch(() => ({ status: "kept" }));
      removedFolder = answer.status === "removed";
    }
    repository.remove(args.featureId);
    await refresh();
    publish();
    return {
      archivedThreads: archived.archived,
      removedWorktrees: removed,
      leftovers,
      deletedBranches,
      removedFolder,
    };
  };

  /** Take one repository out of a feature. Refused while it holds work, unless forced. */
  const removeRepository = async (args: {
    featureId: string;
    directory: string;
    force: boolean;
  }) => {
    await refresh();
    const feature = requireFeature(args.featureId);
    if (
      feature.hostId !== null &&
      getCached().memberScanFailures.includes(feature.hostId)
    ) {
      throw new FeatureError(
        `Could not read the repositories of ${feature.name}. ${args.directory} was not removed.`,
        "unavailable",
      );
    }
    const member = membersOf(args.featureId).find(
      (candidate) => candidate.directory === args.directory,
    );
    if (member === undefined) {
      throw new FeatureError(`No repository folder ${args.directory} in this feature.`, "not-found");
    }
    if (member.role === "ref" && feature.rootPath !== null && feature.hostId !== null) {
      await call(
        "unlinkFeatureReference",
        { featureDirectory: feature.rootPath, directory: member.directory },
        feature.hostId,
        PROBE_TIMEOUT_MS,
      );
      repository.refLinks.remove(args.featureId, args.directory);
      await refresh();
      await writeContext(feature, membersOf(feature.id));
      publish();
      return { removed: true };
    }
    const environments = await environmentsOf(feature);
    const adoptedTargets = adoptedEnvByTargetPath(feature, environments);
    const adoptedEnvId = adoptedTargets.get(normalizeFeaturePath(member.repositoryPath));
    if (adoptedEnvId !== undefined && feature.rootPath !== null && feature.hostId !== null) {
      await call(
        "unlinkFeatureReference",
        { featureDirectory: feature.rootPath, directory: member.directory },
        feature.hostId,
        PROBE_TIMEOUT_MS,
      );
      store.adopt(adoptedEnvId, null);
      await refresh();
      await writeContext(feature, membersOf(feature.id));
      publish();
      return { removed: true };
    }
    const [state] = await call<{ worktrees: FeatureRemovalSurvey["worktrees"] }>(
      "inspectFeatureWorktrees",
      { paths: [member.path] },
      member.hostId,
      PROBE_TIMEOUT_MS,
    ).then((answer) => answer.worktrees);
    const statusFailed = state === undefined || Boolean(state.error);
    const loses =
      statusFailed || state.changedFiles > 0 || state.untrackedFiles > 0;
    if (loses && !args.force) {
      const detail =
        state === undefined
          ? "unreadable worktree state"
          : state.error
            ? `git status error (${state.error})`
            : `${state.changedFiles} changed and ${state.untrackedFiles} untracked files`;
      throw new FeatureError(
        `${args.directory} has ${detail}. Commit them first, or remove with force.`,
        statusFailed ? "unavailable" : "blocked",
      );
    }
    const matchedEnvs = environments.filter(
      (environment) =>
        environment.path !== null &&
        isWithinPath(member.path, environment.path),
    );
    const archived = await archiveFeatureThreads(
      bb,
      matchedEnvs.map((environment) => environment.id),
    );
    if (archived.failedEnvironmentIds.length > 0) {
      throw new FeatureError(
        `Could not archive threads: ${archived.message ?? "bb did not say why"}. ${args.directory} was not removed.`,
        "unavailable",
      );
    }
    const { removed } = await removeFeatureMembers({ members: [member], call });
    if (removed !== 1) return { removed: false };
    await refresh();
    await writeContext(feature, membersOf(feature.id));
    publish();
    return { removed: true };
  };

  return { survey, finish, reopen, remove, removeRepository };
}
