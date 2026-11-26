import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  rollupCounts,
  rollupSummary,
  type StatusRollup,
} from "../lib/domain/rollup.ts";

function rollup(overrides: Partial<StatusRollup> = {}): StatusRollup {
  return {
    kind: "working",
    total: 1,
    failed: 0,
    working: 1,
    needsYou: 0,
    unread: 0,
    discIds: [],
    leadThreadId: "thr_1",
    ...overrides,
  };
}

describe("rollupCounts", () => {
  /**
   * The order is the whole point of a rollup: a folded row is skimmed, and a
   * blocked thread is the one that must not hide behind a running one.
   */
  it("orders by urgency, not by count", () => {
    const counts = rollupCounts(
      rollup({ failed: 1, needsYou: 1, working: 9, unread: 1 }),
    );
    assert.deepEqual(
      counts.map((entry) => entry.kind),
      ["failed", "needs-you", "working", "unread"],
    );
  });

  it("leaves out every signal that is zero", () => {
    assert.deepEqual(rollupCounts(rollup({ working: 3 })), [
      { kind: "working", count: 3 },
    ]);
  });

  it("returns nothing for a quiet subtree", () => {
    assert.deepEqual(
      rollupCounts(rollup({ kind: "inactive", working: 0, total: 4 })),
      [],
    );
  });

  /**
   * One list, two renderings. The dots a row draws and the sentence a screen
   * reader reads come from the same call, so they cannot disagree about which
   * signal came first.
   */
  it("is the same list rollupSummary words", () => {
    const counts = rollup({ failed: 2, needsYou: 1, working: 3 });
    assert.equal(rollupSummary(counts), "2 failed · 1 needs you · 3 working");
    assert.equal(
      rollupSummary(counts),
      rollupCounts(counts)
        .map((entry) => `${entry.count} ${entry.kind.replace("-", " ")}`)
        .join(" · "),
    );
  });

  it("still says nothing for a rollup with no counts", () => {
    assert.equal(rollupSummary(rollup({ kind: "inactive", working: 0 })), "");
  });
});