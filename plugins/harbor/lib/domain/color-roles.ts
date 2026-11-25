/**
 * The eighteen semantic colours, grouped by what they colour.
 *
 * This exists because the same eighteen roles were being described three times
 * in three vocabularies: eighteen `bb.settings` descriptors labelled
 * "Custom · Working", "Custom · PR review", …; a read-only swatch list in the
 * settings section; and a third set of names in `familyStatusPresentation`.
 * A user could see a colour in one place and not change it there, which is the
 * one thing a colour setting must never do.
 *
 * Two facts, one definition:
 *
 * - **What it colours** (`group`): the three things a status colour can mean.
 *   Thread state is what a row shows about a thread; activity is what a running
 *   thread is doing; pull request is the PR's own state. They are separate
 *   because a user tuning "failed" is not thinking about "PR blocked".
 * - **What it is called** (`label`): the name the user reads, used by the
 *   settings descriptors, the swatch row, and the palette editor alike.
 */

export const COLOR_GROUPS = ["status", "activity", "pull-request"] as const;

export type ColorGroup = (typeof COLOR_GROUPS)[number];

export interface SemanticColorRoleDefinition {
  readonly role: string;
  readonly group: ColorGroup;
  readonly label: string;
}

/**
 * Order matters: it is the order the settings fields are declared in, and so
 * the order the palette editor draws them in. Status first — it is what the
 * sidebar is mostly made of.
 */
export const SEMANTIC_COLOR_ROLE_DEFINITIONS = [
  // Thread state: what a row says about the thread.
  { role: "working", group: "status", label: "Working" },
  { role: "waiting", group: "status", label: "Needs you" },
  { role: "unread", group: "status", label: "Unread" },
  { role: "error", group: "status", label: "Failed" },
  { role: "inactive", group: "status", label: "Inactive" },
  { role: "stale", group: "status", label: "Stale" },
  // Activity: what a working thread is doing.
  { role: "workflow", group: "activity", label: "Workflow" },
  { role: "agent", group: "activity", label: "Agent" },
  { role: "command", group: "activity", label: "Command" },
  { role: "plan", group: "activity", label: "Plan" },
  { role: "goal", group: "activity", label: "Goal" },
  // Pull request: the PR's own state.
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

/** The role a `bb.settings` key holds, so one table maps both ways. */
export const COLOR_SETTING_KEYS: Readonly<Record<string, string>> = {
  working: "workingColor",
  workflow: "workflowColor",
  agent: "agentColor",
  command: "commandColor",
  plan: "planColor",
  goal: "goalColor",
  waiting: "waitingColor",
  unread: "unreadColor",
  error: "errorColor",
  inactive: "idleColor",
  stale: "staleColor",
  prReview: "prReviewColor",
  prChecks: "prChecksColor",
  prReady: "prReadyColor",
  prMerged: "prMergedColor",
  prDraft: "prDraftColor",
  prBlocked: "prBlockedColor",
  prClosed: "prClosedColor",
};
