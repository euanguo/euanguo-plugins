/**
 * Renaming one member's branch.
 *
 * Split from the feature service so the service stays about the feature as a
 * whole; this is the one operation that changes a repository's git state
 * without adding or removing a worktree, and it is reached from the member row
 * in the Repositories dialog.
 */

import type { FeatureStore } from "../lib/feature-store.ts";
import { validBranchName } from "../lib/feature-materialize.ts";
import type { Feature, FeatureMember } from "../lib/features.ts";
import type { HostCall } from "./feature-service.ts";

  /**
   * Rename one member's branch, keeping its commits and its worktree.
   *
   * Repositories in one feature may follow their own conventions, or may have
   * started before the feature was named, so a member's branch is its own to
   * choose. The rename goes through git (`branch -m`), so the worktree follows
   * and nothing is copied. A branch Nest created is re-recorded under the new
   * name, which is what a later delete uses.
   */
export async function renameFeatureMemberBranch(
  deps: {
    readonly store: FeatureStore;
    readonly call: HostCall;
    readonly requireFeature: (featureId: string) => Feature;
    readonly membersOf: (featureId: string) => readonly FeatureMember[];
    readonly refresh: () => Promise<unknown>;
    readonly writeContext: (
      feature: Feature,
      members: readonly FeatureMember[],
    ) => Promise<boolean>;
    readonly publish: () => void;
    readonly timeoutMs: number;
  },
  args: {
    featureId: string;
    directory: string;
    branch: string;
  },
): Promise<{ ok: boolean; reason: string | null }> {
    const { store, call, requireFeature, membersOf, refresh, writeContext, publish } = deps;
    const feature = requireFeature(args.featureId);
    const member = membersOf(args.featureId).find(
      (candidate) => candidate.directory === args.directory,
    );
    if (member === undefined) {
      return { ok: false, reason: `No repository folder ${args.directory} in this feature.` };
    }
    const branch = args.branch.trim();
    if (!validBranchName(branch)) {
      return { ok: false, reason: `${branch} is not a valid branch name.` };
    }
    if (member.branch === branch) return { ok: true, reason: null };
    const probe = await call<{
      status: string;
      branchExists?: boolean;
      worktrees?: readonly { branch: string | null }[];
    }>(
      "probeFeatureWorktree",
      { sourcePath: member.path, branch, targetPath: member.path },
      member.hostId,
      deps.timeoutMs,
    ).catch(() => null);
    const free =
      probe !== null &&
      probe.status === "ok" &&
      probe.branchExists !== true &&
      !(probe.worktrees ?? []).some((worktree) => worktree.branch === branch);
    if (!free) {
      return { ok: false, reason: `${branch} already exists in ${member.repository}.` };
    }
    const answer = await call<{ status: string; message?: string }>(
      "renameFeatureBranch",
      { repositoryPath: member.path, from: member.branch ?? "", to: branch },
      member.hostId,
      deps.timeoutMs,
    ).catch((error: unknown) => ({ status: "failed", message: messageOf(error) }));
    if (answer.status !== "renamed") {
      return { ok: false, reason: answer.message ?? "git refused to rename the branch." };
    }
    /**
     * The record follows a branch Nest created. One a person brought keeps no
     * record: deleting the feature must not delete a branch that was there
     * before it.
     */
    if (member.branch !== null) {
      const recorded = store.branches(feature.id).some(
        (candidate) =>
          candidate.repositoryPath === member.repositoryPath && candidate.branch === member.branch,
      );
      if (recorded) {
        store.forgetBranch({
          featureId: feature.id,
          repositoryPath: member.repositoryPath,
          branch: member.branch,
        });
        store.recordBranch({
          featureId: feature.id,
          repositoryPath: member.repositoryPath,
          hostId: member.hostId,
          branch,
        });
      }
    }
    await refresh();
    await writeContext(feature, membersOf(feature.id));
    publish();
    return { ok: true, reason: null };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
