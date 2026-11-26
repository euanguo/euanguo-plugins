import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  nextMarkerDelayMs,
  snoozedRowStatuses,
} from "../lib/domain/row-status.ts";
import type { ThreadLifecycleRow } from "../lib/domain/lifecycle.ts";

function row(overrides: Partial<ThreadLifecycleRow> = {}): ThreadLifecycleRow {
  return {
    threadId: "thr_1",
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    ...overrides,
  };
}

const HOUR = 60 * 60 * 1_000;

describe("snoozedRowStatuses", () => {
  it("marks a thread Harbor is holding back", () => {
    const statuses = snoozedRowStatuses({
      rows: [row({ snoozedUntil: 2 * HOUR, snoozedAt: 0 })],
      now: HOUR,
    });
    assert.equal(statuses.length, 1);
    assert.equal(statuses[0]?.threadId, "thr_1");
    assert.equal(statuses[0]?.status.icon, "Clock");
    assert.match(String(statuses[0]?.status.label), /^Snoozed by Harbor · wakes in /);
  });

  /**
   * A wake time that has passed is not a marker: the row is not being held back
   * any more, and a glyph that outlives its reason is worse than no glyph.
   */
  it("marks nothing for a wake time that has passed", () => {
    assert.deepEqual(
      snoozedRowStatuses({ rows: [row({ snoozedUntil: HOUR })], now: HOUR }),
      [],
    );
  });

  /**
   * Settling archives the thread, so bb's own list does not draw it at all — a
   * marker for it would be a marker on a row that is not there.
   */
  it("marks nothing for a settled row", () => {
    assert.deepEqual(
      snoozedRowStatuses({
        rows: [row({ settledAt: HOUR, snoozedUntil: null })],
        now: 2 * HOUR,
      }),
      [],
    );
  });

  it("marks nothing for an active row", () => {
    assert.deepEqual(snoozedRowStatuses({ rows: [row()], now: HOUR }), []);
  });

  // A held state, not work that is happening: the shimmer belongs to running
  // work, and a snooze is the opposite of that.
  it("uses the neutral tone rather than the running one", () => {
    const statuses = snoozedRowStatuses({
      rows: [row({ snoozedUntil: 2 * HOUR })],
      now: HOUR,
    });
    assert.equal(statuses[0]?.status.tone, "default");
  });

  it("marks one row per snooze, in the order it was given", () => {
    const statuses = snoozedRowStatuses({
      rows: [
        row({ threadId: "a", snoozedUntil: 2 * HOUR }),
        row({ threadId: "b" }),
        row({ threadId: "c", snoozedUntil: 5 * HOUR }),
      ],
      now: HOUR,
    });
    assert.deepEqual(
      statuses.map((entry) => entry.threadId),
      ["a", "c"],
    );
  });
});

describe("nextMarkerDelayMs", () => {
  it("arms for the soonest wake", () => {
    assert.equal(
      nextMarkerDelayMs(
        [
          row({ threadId: "a", snoozedUntil: 5 * HOUR }),
          row({ threadId: "b", snoozedUntil: 2 * HOUR }),
        ],
        HOUR,
      ),
      HOUR,
    );
  });

  it("arms for nothing when nothing is upcoming", () => {
    assert.equal(nextMarkerDelayMs([row({ snoozedUntil: HOUR })], HOUR), null);
    assert.equal(nextMarkerDelayMs([row()], HOUR), null);
    assert.equal(nextMarkerDelayMs([], HOUR), null);
  });
});