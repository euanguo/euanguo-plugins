/**
 * How a burst of realtime publishes collapses into reads.
 *
 * The policy is here rather than in the hook so it can be tested as plain
 * arithmetic, and because the choice it makes is the whole point of the feature:
 * this plugin's mutations are **not** optimistic. `settle`, `snooze`, and
 * `unsettle` write to the store and publish; the subscription that re-reads is
 * what makes the row move. A trailing-only debounce would therefore put the
 * coalescing window in front of the user's own click, which is a regression
 * dressed up as an optimisation.
 *
 * So the window has both edges:
 *
 * - **Leading** — the first publish of a burst reads at once, so a local action
 *   still lands immediately.
 * - **Trailing** — one more read after the burst, so the last state in it is
 *   never missed by a read that raced it. Without this, two publishes 10ms apart
 *   would leave the second unread.
 *
 * At most two reads per burst, however long the burst is.
 */

/**
 * How long a burst is allowed to collapse into one trailing read.
 *
 * Short enough that another client's change lands while the user is still
 * looking at the row; long enough that a settled thread taking three turns in a
 * row, or a bulk operation publishing per thread, costs one read instead of one
 * per publish.
 */
export const REALTIME_COALESCE_MS = 150;

export type CoalesceDecision =
  | { readonly kind: "run-now" }
  | { readonly kind: "schedule"; readonly delayMs: number }
  | { readonly kind: "swallow" };

export function coalesceDecision(input: {
  now: number;
  /** When the last read was started. 0 means none has run yet. */
  lastRunAt: number;
  windowMs: number;
  /** True when a trailing read is already armed. */
  trailingScheduled: boolean;
}): CoalesceDecision {
  const { now, lastRunAt, windowMs, trailingScheduled } = input;
  // A window of zero disables coalescing: every publish reads, which is what a
  // caller asking for no coalescing should get rather than a divide by nothing.
  if (windowMs <= 0) return { kind: "run-now" };
  const elapsed = now - lastRunAt;
  // The first publish of a burst, and the first publish after a quiet window.
  if (lastRunAt === 0 || elapsed >= windowMs) return { kind: "run-now" };
  // One trailing read is enough for any number of publishes inside the window:
  // it runs after them, so it sees the last of them.
  if (trailingScheduled) return { kind: "swallow" };
  return { kind: "schedule", delayMs: windowMs - elapsed };
}