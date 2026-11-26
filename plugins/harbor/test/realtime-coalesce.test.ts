import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  coalesceDecision,
  REALTIME_COALESCE_MS,
} from "../lib/ui/realtime-coalesce.ts";

const WINDOW = 150;

describe("coalesceDecision", () => {
  /**
   * The leading edge, and the reason it exists. This plugin's mutations are not
   * optimistic: a settle writes, publishes, and waits for the subscription to
   * re-read before the row moves. A trailing-only window would put the
   * coalescing delay in front of the user's own click.
   */
  it("reads at once for the first publish there has ever been", () => {
    assert.deepEqual(
      coalesceDecision({
        now: 1_000,
        lastRunAt: 0,
        windowMs: WINDOW,
        trailingScheduled: false,
      }),
      { kind: "run-now" },
    );
  });

  it("reads at once for the first publish after a quiet window", () => {
    assert.deepEqual(
      coalesceDecision({
        now: 10_000,
        lastRunAt: 10_000 - WINDOW,
        windowMs: WINDOW,
        trailingScheduled: false,
      }),
      { kind: "run-now" },
    );
  });

  it("schedules one trailing read inside the window", () => {
    assert.deepEqual(
      coalesceDecision({
        now: 1_050,
        lastRunAt: 1_000,
        windowMs: WINDOW,
        trailingScheduled: false,
      }),
      // Waits out the rest of the window rather than the whole of it, so a burst
      // does not extend its own window with every publish.
      { kind: "schedule", delayMs: 100 },
    );
  });

  /**
   * The trailing read runs after every publish in the burst, so it sees the last
   * of them. One is enough for any number — which is what bounds a burst at two
   * reads.
   */
  it("swallows every further publish while a trailing read is armed", () => {
    for (const now of [1_010, 1_050, 1_100, 1_149]) {
      assert.deepEqual(
        coalesceDecision({
          now,
          lastRunAt: 1_000,
          windowMs: WINDOW,
          trailingScheduled: true,
        }),
        { kind: "swallow" },
      );
    }
  });

  it("never schedules a delay of zero or less", () => {
    const decision = coalesceDecision({
      now: 1_000 + WINDOW - 1,
      lastRunAt: 1_000,
      windowMs: WINDOW,
      trailingScheduled: false,
    });
    assert.equal(decision.kind, "schedule");
    assert.ok(decision.kind === "schedule" && decision.delayMs > 0);
  });

  // A caller asking for no coalescing gets no coalescing, rather than a divide
  // by nothing or a zero-delay timer per publish.
  it("reads every publish when the window is off", () => {
    assert.deepEqual(
      coalesceDecision({
        now: 1_001,
        lastRunAt: 1_000,
        windowMs: 0,
        trailingScheduled: true,
      }),
      { kind: "run-now" },
    );
  });

  it("defaults to a window short enough to feel live", () => {
    assert.equal(REALTIME_COALESCE_MS, 150);
  });
});
