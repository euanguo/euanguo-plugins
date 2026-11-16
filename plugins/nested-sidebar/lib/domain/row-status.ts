/**
 * The marker Nest puts on bb's own thread rows.
 *
 * This is the additive half: when the user has not chosen Nest as their sidebar,
 * bb draws the list and Nest contributes one thing to it. The host's
 * `experimental_setThreadRowStatus` is the surface — the host renders the glyph,
 * owns its tone and animation, and clears it when the plugin deactivates.
 *
 * **What Nest can contribute, and why it is this.** A content script gets no DOM
 * container, no `experimental_useSidebarThreads`, and no RPC client — `useRpc` is
 * a hook, and a content script is not a component. The one source it can reach is
 * the same-origin web storage, which is where Nest already keeps its warm-start
 * cache for exactly this kind of cold read.
 *
 * So the marker says the one thing bb's own list cannot: **Nest is holding this
 * thread back until a time you chose.** bb draws a snoozed thread like any other,
 * because snoozing is Nest's idea and lives in Nest's store. Settled threads need
 * no marker — settling archives the thread, so bb's list does not draw it at all.
 *
 * **The honest limitation.** The cache is a snapshot of the last state Nest
 * wrote, not a live read: with Nest not the provider, its hooks are not mounted,
 * so nothing refreshes it. A snooze set in Nest's own sidebar shows here; a
 * snooze set on another machine does not, until Nest is the provider again. A
 * live version needs an RPC client the SDK does not expose to a content script,
 * and pretending otherwise would be a marker that is quietly wrong.
 */

import type { PluginComposerThreadRowStatus } from "@get-bb/plugin-sdk/app";
import { snoozeWakeLabel, type ThreadLifecycleRow } from "./lifecycle.ts";

export interface NestRowStatus {
  readonly threadId: string;
  readonly status: PluginComposerThreadRowStatus;
}

/**
 * A marker per snoozed thread, and none for anything else.
 *
 * A wake time that has passed is not a marker: the row is not being held back
 * any more, and a glyph that outlives its reason is worse than no glyph. The
 * caller's clock is passed in rather than read here, so the decision is testable
 * and every marker in one pass agrees about "now".
 */
export function snoozedRowStatuses(input: {
  rows: readonly ThreadLifecycleRow[];
  now: number;
}): NestRowStatus[] {
  const statuses: NestRowStatus[] = [];
  for (const row of input.rows) {
    const until = row.snoozedUntil;
    if (until === null || until <= input.now) continue;
    statuses.push({
      threadId: row.threadId,
      status: {
        // A bb icon-name hint; an unknown name falls back to the plugin's own
        // glyph, which is a fine outcome for a clock.
        icon: "Clock",
        label: `Snoozed by Nest · wakes in ${snoozeWakeLabel(until, input.now)}`,
        // `default` rather than `running`: a snooze is a held state, and the
        // shimmer belongs to work that is actually happening.
        tone: "default",
      },
    });
  }
  return statuses;
}

/**
 * The soonest wake among the markers, as a delay in milliseconds.
 *
 * One timer armed for the next wake rather than an interval: the sidebar's own
 * lifecycle read does the same, and a poll that mostly finds nothing is a poll
 * that should not have been armed.
 */
export function nextMarkerDelayMs(
  rows: readonly ThreadLifecycleRow[],
  now: number,
): number | null {
  const upcoming = rows
    .map((row) => row.snoozedUntil)
    .filter((until): until is number => until !== null && until > now);
  if (upcoming.length === 0) return null;
  return Math.min(...upcoming) - now;
}