/**
 * The thread chores an agent may do, when the user has turned them on.
 *
 * Every one of these is reversible from the sidebar and none of them touches a
 * directory: settling parks a thread on the finished shelf and takes it back,
 * snoozing hides it until a moment, pinning moves it to the top, renaming
 * changes the title a person reads. They are the verbs a person uses to keep a
 * long sidebar readable, and they are exactly what an agent is good at doing
 * after it has read a dozen threads.
 *
 * They go through `NestAgentActions` so an agent's settle and a row's settle are
 * the same write, with the same row-before-archive ordering.
 *
 * The batch is deliberate: settling one thread at a time is a round trip per
 * thread, and the common request — "these are done, tidy them up" — is a list.
 */

import { z } from "zod";

import type { AgentToolDeps } from "./actions.ts";
import { quoteName } from "./instructions.ts";
import type { AgentToolRegistry } from "./toolkit.ts";

/**
 * The threads a batch tool acts on.
 *
 * Omitted means "this thread": a model rarely knows the id of the conversation
 * it is running in, and making it look one up to settle itself is a round trip
 * for nothing.
 */
const THREAD_IDS = z
  .array(z.string().min(1))
  .min(1)
  .max(20)
  .optional()
  .describe("Thread ids. Up to 20 at a time; omit to act on this thread.");

const targetIds = (threadIds: readonly string[] | undefined, callerId: string): readonly string[] =>
  threadIds ?? [callerId];

/** One line per thread, so a partial failure is visible rather than averaged. */
function report(
  threadIds: readonly string[],
  outcome: (threadId: string) => string | null,
): string {
  const lines = threadIds.map((threadId) => {
    const failure = outcome(threadId);
    return failure === null ? `- ${threadId}: done` : `- ${threadId}: ${failure}`;
  });
  return lines.join("\n");
}

export function registerThreadTools(
  registry: AgentToolRegistry,
  deps: AgentToolDeps,
): void {
  registry.register({
    name: "nest_thread_settle",
    feature: "threads",
    description:
      "Settle threads that are finished, or bring settled ones back. Settling archives the thread in bb and parks it on Nest's Settled shelf; unsettling restores it to the list. Both directions are reversible from the sidebar. Omit thread ids to settle this thread. Use it after the user confirms a piece of work is done, or when they ask to tidy the sidebar.",
    parameters: z.object({
      thread_ids: THREAD_IDS,
      settled: z
        .boolean()
        .default(true)
        .describe("True to settle and archive; false to bring them back."),
    }),
    async execute({ thread_ids, settled }, context) {
      const targets = targetIds(thread_ids, context.threadId);
      const failures = new Map<string, string>();
      for (const threadId of targets) {
        const result = await deps.actions.settleThread(threadId, settled);
        if (!result.ok) failures.set(threadId, result.message ?? "bb refused.");
      }
      return report(targets, (threadId) => failures.get(threadId) ?? null);
    },
  });

  registry.register({
    name: "nest_thread_snooze",
    feature: "threads",
    description:
      "Snooze threads until a moment, or bring them back early with until null. A snoozed thread leaves the list and returns by itself at that time; unsnoozing is immediate. Omit thread ids to snooze this thread. Use it for work the user wants out of the way but not finished, and pass an ISO 8601 time with an offset (for example 2026-11-10T09:00:00+08:00).",
    parameters: z.object({
      thread_ids: THREAD_IDS,
      until: z
        .string()
        .min(1)
        .nullable()
        .describe("ISO 8601 wake-up time, or null to unsnooze now."),
    }),
    async execute({ thread_ids, until }, context) {
      const targets = targetIds(thread_ids, context.threadId);
      let snoozedUntil: number | null = null;
      if (until !== null) {
        const parsed = Date.parse(until);
        if (Number.isNaN(parsed)) {
          return `Could not read ${quoteName(until)} as a time. Use an ISO 8601 time with an offset, or null.`;
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
    },
  });

  registry.register({
    name: "nest_thread_pin",
    feature: "threads",
    description:
      "Pin threads to the top of the sidebar, or unpin them. Pinning is bb's own pin, so it shows in every sidebar view; it is reversible and moves nothing else. Omit thread ids to pin this thread. Use it for a thread the user is tracking while other work continues.",
    parameters: z.object({
      thread_ids: THREAD_IDS,
      pinned: z.boolean().default(true).describe("True to pin; false to unpin."),
    }),
    async execute({ thread_ids, pinned }, context) {
      const targets = targetIds(thread_ids, context.threadId);
      const failures = new Map<string, string>();
      for (const threadId of targets) {
        if (!(await deps.actions.setThreadPinned(threadId, pinned))) {
          failures.set(threadId, "bb refused.");
        }
      }
      return report(targets, (threadId) => failures.get(threadId) ?? null);
    },
  });

  registry.register({
    name: "nest_thread_rename",
    feature: "threads",
    description:
      "Replace a thread's title; omit thread id to rename this thread. Use it when the user names the conversation, or after reading enough of it to give a title that says what the thread turned out to be — not to summarize in a sentence. Titles are what the sidebar is scanned by, so keep them short.",
    parameters: z.object({
      thread_id: z
        .string()
        .min(1)
        .optional()
        .describe("The thread to rename; omit for this thread."),
      title: z.string().min(1).max(200).describe("The new title."),
    }),
    async execute({ thread_id, title }, context) {
      const target = thread_id ?? context.threadId;
      const renamed = await deps.actions.renameThread(target, title.trim());
      return renamed
        ? `Renamed ${target} to ${quoteName(title.trim())}.`
        : `bb would not rename ${target}. The thread may be gone, or the title refused.`;
    },
  });
}
