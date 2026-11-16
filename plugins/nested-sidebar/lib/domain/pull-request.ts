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

export function toPullRequestState(state: string): PullRequestState {
  const normalized = state.toLowerCase();
  if (normalized === "merged") return "merged";
  if (normalized === "closed") return "closed";
  if (normalized === "draft") return "draft";
  return "open";
}

export function needsAttention(pullRequest: WorkspacePullRequest): boolean {
  return ATTENTION_STATES.has(pullRequest.attention);
}
