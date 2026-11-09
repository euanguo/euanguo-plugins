/**
 * Bringing a member created by an older build onto the feature's topic branch.
 *
 * Older builds named a member's branch `feat/<feature-id>/<repo>`, one per
 * repository. The convention is one topic branch for the whole feature,
 * `feat/<slug>`, and an old member would otherwise sit on a name that no
 * longer means anything — and that the branch a feature row shows does not
 * describe. Only branches this plugin named are touched, and only when the
 * topic branch is free in that repository; a branch a person chose stays.
 *
 * Once per load per feature: this is a repair, not a standing rule.
 */

import type { worktreeDirectoryContract } from "../host/contract.ts";
import {
  asciiSlug,
  featureBranch,
  type Feature,
  type FeatureMember,
} from "../lib/features.ts";

/**
 * The branch prefixes the previous builder produced for a feature.
 *
 * It derived the prefix from the feature's id, and its slug rules kept `_`
 * while this build's do not: `feat_ai-2` against `feat-ai-2`. Both spellings
 * are matched so a member created by either build is repaired.
 */
function legacyBranchPrefixes(feature: Feature): string[] {
  const oldRules = feature.id
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/-{2,}/gu, "-")
    .replace(/^[-._]+|[-._]+$/gu, "")
    .slice(0, 48);
  const prefixes = new Set<string>([`feat/${asciiSlug(feature.id)}/`]);
  if (oldRules.length > 0) prefixes.add(`feat/${oldRules}/`);
  return [...prefixes];
}

/** The one host call shape the service hands in. */
export type HostCall = <T>(
  method: keyof typeof worktreeDirectoryContract,
  payload: unknown,
  hostId: string,
  timeoutMs: number,
) => Promise<T>;

export async function repairLegacyBranches(input: {
  readonly features: readonly Feature[];
  readonly members: readonly FeatureMember[];
  /** Features already checked this load; added to as they are. */
  readonly repaired: Set<string>;
  readonly call: HostCall;
  readonly log: { info(message: string): void; warn(message: string): void };
  readonly timeoutMs: number;
}): Promise<Set<string>> {
  const { features, members, repaired, call, log, timeoutMs } = input;
  const changedHosts = new Set<string>();
  for (const feature of features) {
    if (feature.state !== "active" || repaired.has(feature.id)) continue;
    repaired.add(feature.id);
    const topic = featureBranch(feature.slug);
    const legacyPrefixes = legacyBranchPrefixes(feature);
    for (const member of members) {
      if (member.featureId !== feature.id) continue;
      if (member.branch === null || member.branch === topic) continue;
      if (!legacyPrefixes.some((prefix) => member.branch?.startsWith(prefix))) continue;
      const probe = await call<{
        status: string;
        branchExists?: boolean;
        worktrees?: readonly { branch: string | null }[];
      }>(
        "probeFeatureWorktree",
        { sourcePath: member.path, branch: topic, targetPath: member.path },
        member.hostId,
        timeoutMs,
      ).catch(() => null);
      const free =
        probe !== null &&
        probe.status === "ok" &&
        probe.branchExists !== true &&
        !(probe.worktrees ?? []).some((worktree) => worktree.branch === topic);
      if (!free) {
        log.warn(`left ${member.branch} in ${member.path}: ${topic} is already taken there`);
        continue;
      }
      const answer = await call<{ status: string }>(
        "renameFeatureBranch",
        { repositoryPath: member.path, from: member.branch, to: topic },
        member.hostId,
        timeoutMs,
      ).catch(() => null);
      if (answer?.status === "renamed") {
        changedHosts.add(member.hostId);
        log.info(`renamed ${member.branch} to ${topic} in ${member.path}`);
      }
    }
  }
  return changedHosts;
}
