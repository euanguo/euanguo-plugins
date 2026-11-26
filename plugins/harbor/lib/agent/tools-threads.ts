/**
 * Thread tidying action executor used by `harbor_sidebar_organize`.
 *
 * Keeps settle, snooze, pin, and rename behind one consolidated sidebar/thread
 * organization tool without inflating the registered tool count.
 */

import type { AgentToolDeps } from "./actions.ts";
import { quoteName } from "./instructions.ts";

export type ThreadOrganizeAction =
  | "thread_settle"
  | "thread_snooze"
  | "thread_pin"
  | "thread_rename";

export interface ThreadOrganizeInput {
  readonly action: ThreadOrganizeAction;
  readonly thread_id?: string;
  readonly thread_ids?: readonly string[];
  readonly settled: boolean;
  readonly until?: string | null;
  readonly pinned: boolean;
  readonly title?: string;
}

const targetIds = (
  threadIds: readonly string[] | undefined,
  callerId: string,
): readonly string[] => threadIds ?? [callerId];

function report(
  threadIds: readonly string[],
  outcome: (threadId: string) => string | null,
): string {
  return threadIds
    .map((threadId) => {
      const failure = outcome(threadId);
      return failure === null ? `- ${threadId}: done` : `- ${threadId}: ${failure}`;
    })
    .join("\n");
}

export async function executeThreadOrganizeAction(
  deps: AgentToolDeps,
  input: ThreadOrganizeInput,
  callerThreadId: string,
): Promise<string> {
  switch (input.action) {
    case "thread_settle": {
      const targets = targetIds(input.thread_ids, callerThreadId);
      const failures = new Map<string, string>();
      for (const threadId of targets) {
        const result = await deps.actions.settleThread(threadId, input.settled);
        if (!result.ok) failures.set(threadId, result.message ?? "bb refused.");
      }
      return report(targets, (threadId) => failures.get(threadId) ?? null);
    }

    case "thread_snooze": {
      if (input.until === undefined) {
        return "until is required for thread_snooze (pass an ISO 8601 timestamp or null to unsnooze).";
      }
      const targets = targetIds(input.thread_ids, callerThreadId);
      let snoozedUntil: number | null = null;
      if (input.until !== null) {
        const parsed = Date.parse(input.until);
        if (Number.isNaN(parsed)) {
          return `Could not read ${quoteName(input.until)} as a time. Use an ISO 8601 time with an offset, or null.`;
        }
        if (parsed <= Date.now()) {
          return "That time is in the past. Give a future time, or pass null to unsnooze.";
        }
        snoozedUntil = parsed;
      }
      const failures = new Map<string, string>();
      for (const threadId of targets) {
        const result = await deps.actions.snoozeThread(threadId, snoozedUntil);
        if (!result.ok) failures.set(threadId, result.message ?? "bb refused.");
      }
      return report(targets, (threadId) => failures.get(threadId) ?? null);
    }

    case "thread_pin": {
      const targets = targetIds(input.thread_ids, callerThreadId);
      const failures = new Map<string, string>();
      for (const threadId of targets) {
        if (!(await deps.actions.setThreadPinned(threadId, input.pinned))) {
          failures.set(threadId, "bb refused.");
        }
      }
      return report(targets, (threadId) => failures.get(threadId) ?? null);
    }

    case "thread_rename": {
      const trimmed = input.title?.trim() ?? "";
      if (trimmed.length === 0) {
        return "title is required for thread_rename.";
      }
      const target = input.thread_id ?? callerThreadId;
      const renamed = await deps.actions.renameThread(target, trimmed);
      return renamed
        ? `Renamed ${target} to ${quoteName(trimmed)}.`
        : `bb would not rename ${target}. The thread may be gone, or the title refused.`;
    }

    default: {
      const _exhaustive: never = input.action;
      return _exhaustive;
    }
  }
}
