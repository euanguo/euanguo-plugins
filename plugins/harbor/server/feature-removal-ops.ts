/**
 * The two loops a feature removal runs, apart from the decisions around them.
 *
 * Archiving every environment and taking every worktree back are the parts that
 * touch bb and the machines. Keeping them here lets the service decide when to
 * stop, and lets these two report partial failure instead of swallowing it.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import type { FeatureMember } from "../lib/domain/features.ts";
import type { HostCall } from "./feature-containers.ts";

export interface ArchiveThreadsResult {
  readonly archived: number;
  readonly failedEnvironmentIds: readonly string[];
  readonly message: string | null;
}

export async function archiveFeatureThreads(
  bb: BbPluginApi,
  environmentIds: readonly string[],
): Promise<ArchiveThreadsResult> {
  let archived = 0;
  const failedEnvironmentIds: string[] = [];
  const messages: string[] = [];
  for (const environmentId of environmentIds) {
    const answer = await bb.sdk.environments.archiveThreads({ environmentId }).catch(
      (error: unknown) => ({ failure: messageOf(error) }),
    );
    if ("failure" in answer) {
      bb.log.warn(`could not archive threads in ${environmentId}: ${answer.failure}`);
      failedEnvironmentIds.push(environmentId);
      messages.push(`${environmentId}: ${answer.failure}`);
      continue;
    }
    archived += answer.archivedThreadIds.length;
  }
  return {
    archived,
    failedEnvironmentIds,
    message: messages.length === 0 ? null : messages.join("; "),
  };
}

/** Take a feature's worktrees back through git, so the repository's records go too. */
export async function removeFeatureMembers(input: {
  readonly members: readonly FeatureMember[];
  readonly call: HostCall;
}): Promise<{ removed: number; leftovers: string[] }> {
  const { members, call } = input;
  let removed = 0;
  const leftovers: string[] = [];
  for (const member of members) {
    const answer = await call<{ status: string }>(
      "removeWorktree",
      { path: member.path, mainRepoPath: member.repositoryPath },
      member.hostId,
      60_000,
    ).catch(() => ({ status: "failed" }));
    if (answer.status === "removed") removed += 1;
    else leftovers.push(member.path);
  }
  return { removed, leftovers };
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
