import { useMemo } from "react";
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { experimental_useRpcKeyedQuery } from "@get-bb/plugin-sdk/app";
import { z } from "zod";

/**
 * Pull requests, keyed by environment.
 *
 * The SDK retired its per-thread pull request hook. The GitHub PR Status
 * plugin owns the read now, and it answers one environment at a time, so the
 * sidebar reads every environment it draws in one keyed query and hands each
 * row the answer its workspace already owns.
 */
const GITHUB_PR_PLUGIN_ID = "bb--github-pr-status";
const MAX_KEYS = 200;

const keysInput = z.object({ keys: z.array(z.string().min(1)) });

const pullRequestRowSchema = z.looseObject({
  outcome: z.string(),
  pullRequest: z
    .looseObject({
      number: z.number(),
      title: z.string(),
      state: z.string(),
      url: z.string(),
      attention: z.string(),
    })
    .optional(),
});

const pullRequestReadContract = defineRpcContract({
  pullRequests: {
    input: keysInput,
    output: z.record(z.string(), pullRequestRowSchema),
  },
});

export type PullRequestState = "open" | "draft" | "merged" | "closed";

export interface WorkspacePullRequest {
  readonly number: number;
  readonly title: string;
  readonly state: PullRequestState;
  readonly url: string;
  readonly attention: string;
}

const ATTENTION_STATES = new Set([
  "checks_failed",
  "changes_requested",
  "conflicts",
]);

function toPullRequestState(state: string): PullRequestState {
  const normalized = state.toLowerCase();
  if (normalized === "merged") return "merged";
  if (normalized === "closed") return "closed";
  if (normalized === "draft") return "draft";
  return "open";
}

export function needsAttention(pullRequest: WorkspacePullRequest): boolean {
  return ATTENTION_STATES.has(pullRequest.attention);
}

export function useWorkspacePullRequests(
  environmentIds: readonly string[],
): ReadonlyMap<string, WorkspacePullRequest> {
  const keys = environmentIds.slice(0, MAX_KEYS);
  const query = experimental_useRpcKeyedQuery({
    pluginId: GITHUB_PR_PLUGIN_ID,
    contract: pullRequestReadContract,
    method: "pullRequests",
    keys,
    enabled: keys.length > 0,
  });
  /**
   * One map per read, not one per render.
   *
   * This lands in the tree-row handlers bag, which is memoized so the rows can
   * keep their identity: a fresh Map every render would rebuild the bag every
   * render and undo that.
   */
  return useMemo(() => {
    const rows = new Map<string, WorkspacePullRequest>();
    for (const [environmentId, row] of Object.entries(query.data ?? {})) {
      if (row.outcome !== "available" || row.pullRequest === undefined) continue;
      const pullRequest = row.pullRequest;
      rows.set(environmentId, {
        number: pullRequest.number,
        title: pullRequest.title,
        state: toPullRequestState(pullRequest.state),
        url: pullRequest.url,
        attention: pullRequest.attention,
      });
    }
    return rows;
  }, [query.data]);
}
