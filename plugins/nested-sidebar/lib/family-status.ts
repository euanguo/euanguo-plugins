import { DAY_MS } from "./thread-management.ts";

export const STALE_AFTER_MS = 7 * DAY_MS;

export type FamilyStatusKind =
  | "failed"
  | "needs-you"
  | "working"
  | "unread"
  | "inactive"
  | "stale";

export type FamilyStatusColorRole =
  | "error"
  | "waiting"
  | "working"
  | "workflow"
  | "agent"
  | "command"
  | "plan"
  | "goal"
  | "unread"
  | "inactive"
  | "stale";

export interface FamilyStatusThread {
  readonly indicator: string;
  readonly hasPendingInteraction: boolean;
  readonly isUnread: boolean;
  readonly updatedAt: number;
  readonly activity: {
    readonly workflows: number;
    readonly backgroundAgents: number;
    readonly backgroundCommands: number;
    readonly planMode: number;
    readonly goals: number;
  };
}

export interface FamilyStatusPresentation {
  readonly kind: FamilyStatusKind;
  readonly label: "Failed" | "Needs you" | "Working" | "Unread" | "Inactive" | "Stale";
  readonly description: string;
  readonly colorRole: FamilyStatusColorRole;
  readonly icon:
    | "CircleX"
    | "CircleQuestion"
    | "Loading"
    | "Workflow"
    | "UserRoundPlus"
    | "Terminal"
    | "ListTodo"
    | "Target"
    | "Eye"
    | "Clock"
    | "Hourglass";
  readonly animated: boolean;
  readonly receded: boolean;
}

const PRESENTATIONS: Readonly<Record<FamilyStatusKind, FamilyStatusPresentation>> = {
  failed: {
    kind: "failed",
    label: "Failed",
    description: "Work stopped with an error and may need attention.",
    colorRole: "error",
    icon: "CircleX",
    animated: false,
    receded: false,
  },
  "needs-you": {
    kind: "needs-you",
    label: "Needs you",
    description: "Waiting for your response before work can continue.",
    colorRole: "waiting",
    icon: "CircleQuestion",
    animated: false,
    receded: false,
  },
  working: {
    kind: "working",
    label: "Working",
    description: "Work is actively running in this thread family.",
    colorRole: "working",
    icon: "Loading",
    animated: true,
    receded: false,
  },
  unread: {
    kind: "unread",
    label: "Unread",
    description: "This thread family has activity you have not read.",
    colorRole: "unread",
    icon: "Eye",
    animated: false,
    receded: false,
  },
  inactive: {
    kind: "inactive",
    label: "Inactive",
    description: "No work is currently active in this thread family.",
    colorRole: "inactive",
    icon: "Clock",
    animated: false,
    receded: true,
  },
  stale: {
    kind: "stale",
    label: "Stale",
    description: "No activity has been recorded for seven days or more.",
    colorRole: "stale",
    icon: "Hourglass",
    animated: false,
    receded: true,
  },
};

export function familyStatusPresentation(
  kind: FamilyStatusKind,
): FamilyStatusPresentation {
  return PRESENTATIONS[kind];
}

export type WorkingActivityKind =
  | "runtime"
  | "workflow"
  | "agent"
  | "command"
  | "plan"
  | "goal";

const WORKING_PRESENTATIONS: Readonly<
  Record<WorkingActivityKind, FamilyStatusPresentation>
> = {
  runtime: PRESENTATIONS.working,
  workflow: {
    ...PRESENTATIONS.working,
    description: "A workflow is actively running in this thread family.",
    colorRole: "workflow",
    icon: "Workflow",
  },
  agent: {
    ...PRESENTATIONS.working,
    description: "A background agent is actively running in this thread family.",
    colorRole: "agent",
    icon: "UserRoundPlus",
  },
  command: {
    ...PRESENTATIONS.working,
    description: "A background command is actively running in this thread family.",
    colorRole: "command",
    icon: "Terminal",
  },
  plan: {
    ...PRESENTATIONS.working,
    description: "Plan mode is active in this thread family.",
    colorRole: "plan",
    icon: "ListTodo",
  },
  goal: {
    ...PRESENTATIONS.working,
    description: "A goal is actively running in this thread family.",
    colorRole: "goal",
    icon: "Target",
  },
};

export function workingActivityPresentation(
  kind: WorkingActivityKind,
): FamilyStatusPresentation {
  return WORKING_PRESENTATIONS[kind];
}

export function familyStatus(
  threads: readonly FamilyStatusThread[],
  now: number,
): FamilyStatusPresentation {
  if (threads.some((thread) => thread.indicator === "unread-error")) {
    return PRESENTATIONS.failed;
  }
  if (
    threads.some(
      (thread) =>
        thread.hasPendingInteraction || thread.indicator === "waiting-for-input",
    )
  ) {
    return PRESENTATIONS["needs-you"];
  }
  const activityKind = familyWorkingActivity(threads);
  if (activityKind !== null) return WORKING_PRESENTATIONS[activityKind];
  if (
    threads.some(
      (thread) =>
        thread.isUnread ||
        thread.indicator === "unread-success" ||
        thread.indicator === "unread-error",
    )
  ) {
    return PRESENTATIONS.unread;
  }
  const latest = threads.reduce(
    (value, thread) => Math.max(value, thread.updatedAt),
    0,
  );
  return now - latest >= STALE_AFTER_MS
    ? PRESENTATIONS.stale
    : PRESENTATIONS.inactive;
}

function isWorking(thread: FamilyStatusThread): boolean {
  return (
    thread.indicator === "runtime" ||
    thread.indicator === "workflow" ||
    thread.indicator === "background-agent" ||
    thread.indicator === "background-command" ||
    thread.indicator === "plan-mode" ||
    thread.indicator === "goal" ||
    thread.indicator === "working-draft" ||
    thread.activity.workflows > 0 ||
    thread.activity.backgroundAgents > 0 ||
    thread.activity.backgroundCommands > 0 ||
    thread.activity.planMode > 0 ||
    thread.activity.goals > 0
  );
}

function familyWorkingActivity(
  threads: readonly FamilyStatusThread[],
): WorkingActivityKind | null {
  if (
    threads.some(
      (thread) =>
        thread.indicator === "workflow" || thread.activity.workflows > 0,
    )
  ) {
    return "workflow";
  }
  if (
    threads.some(
      (thread) =>
        thread.indicator === "background-agent" ||
        thread.activity.backgroundAgents > 0,
    )
  ) {
    return "agent";
  }
  if (
    threads.some(
      (thread) =>
        thread.indicator === "background-command" ||
        thread.activity.backgroundCommands > 0,
    )
  ) {
    return "command";
  }
  if (
    threads.some(
      (thread) =>
        thread.indicator === "plan-mode" || thread.activity.planMode > 0,
    )
  ) {
    return "plan";
  }
  if (
    threads.some(
      (thread) => thread.indicator === "goal" || thread.activity.goals > 0,
    )
  ) {
    return "goal";
  }
  return threads.some(isWorking) ? "runtime" : null;
}
