/**
 * Semantic color roles grouped by meaning for status markers and palette previews.
 */

import type { SemanticColorRole } from "./preferences.ts";

export const COLOR_GROUPS = ["status", "activity", "pull-request"] as const;

export type ColorGroup = (typeof COLOR_GROUPS)[number];

export interface SemanticColorRoleDefinition {
  readonly role: SemanticColorRole;
  readonly group: ColorGroup;
  readonly label: string;
}

export const SEMANTIC_COLOR_ROLE_DEFINITIONS = [
  { role: "working", group: "status", label: "Working" },
  { role: "waiting", group: "status", label: "Needs you" },
  { role: "unread", group: "status", label: "Unread" },
  { role: "error", group: "status", label: "Failed" },
  { role: "inactive", group: "status", label: "Inactive" },
  { role: "stale", group: "status", label: "Stale" },
  { role: "workflow", group: "activity", label: "Workflow" },
  { role: "agent", group: "activity", label: "Agent" },
  { role: "command", group: "activity", label: "Command" },
  { role: "plan", group: "activity", label: "Plan" },
  { role: "goal", group: "activity", label: "Goal" },
  { role: "prReview", group: "pull-request", label: "PR review" },
  { role: "prChecks", group: "pull-request", label: "PR checks" },
  { role: "prReady", group: "pull-request", label: "PR ready" },
  { role: "prMerged", group: "pull-request", label: "PR merged" },
  { role: "prDraft", group: "pull-request", label: "PR draft" },
  { role: "prBlocked", group: "pull-request", label: "PR blocked" },
  { role: "prClosed", group: "pull-request", label: "PR closed" },
] as const satisfies readonly SemanticColorRoleDefinition[];

export const COLOR_GROUP_LABELS: Readonly<Record<ColorGroup, string>> = {
  status: "Thread state",
  activity: "Activity",
  "pull-request": "Pull request",
};

/** The 6 representative status dots rendered in palette preset cards. */
export const PALETTE_PREVIEW_ROLES: readonly SemanticColorRoleDefinition[] = [
  { role: "working", group: "status", label: "Working" },
  { role: "waiting", group: "status", label: "Needs you" },
  { role: "unread", group: "status", label: "Unread" },
  { role: "error", group: "status", label: "Failed" },
  { role: "prMerged", group: "pull-request", label: "PR merged" },
  { role: "inactive", group: "status", label: "Inactive" },
];
