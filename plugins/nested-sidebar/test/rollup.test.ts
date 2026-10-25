import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_DISC_IDS,
  mergeRollups,
  rollupLeadPhrase,
  rollupSignalCount,
  rollupSummary,
  rollupThreads,
  worstKind,
} from "../lib/rollup.ts";
import type { FamilyStatusThread } from "../lib/family-status.ts";
import type { RollupThread } from "../lib/rollup.ts";

const NOW = 1_700_000_000_000;

let nextId = 0;

function thread(overrides: Partial<FamilyStatusThread> = {}): RollupThread {
  return {
    id: `thr_${(nextId += 1)}`,
    indicator: "none",
    hasPendingInteraction: false,
    isUnread: false,
    updatedAt: NOW,
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
    },
    ...overrides,
  };
}

describe("status rollups", () => {
  it("counts each state separately so a folded row can show numbers", () => {
    const rollup = rollupThreads(
      [
        thread({ indicator: "runtime" }),
        thread({ indicator: "runtime" }),
        thread({ hasPendingInteraction: true }),
        thread({ indicator: "unread-error" }),
        thread({ isUnread: true }),
        thread({}),
      ],
      NOW,
    );

    assert.equal(rollup.total, 6);
    // Counts overlap on purpose: an unread error is a failure AND a raised
    // hand, and both facts matter to someone scanning a folded row.
    assert.equal(rollup.failed, 1);
    assert.equal(rollup.needsYou, 2);
    assert.equal(rollup.working, 2);
    assert.equal(rollup.unread, 1);
  });

  it("puts the state that must not hide in front of the others", () => {
    assert.equal(worstKind(["working", "needs-you"]), "needs-you");
    assert.equal(worstKind(["needs-you", "failed"]), "failed");
    assert.equal(worstKind(["inactive", "stale"]), "inactive");
  });

  it("adds counts when child rollups are merged into a parent", () => {
    const left = rollupThreads([thread({ indicator: "runtime" })], NOW);
    const right = rollupThreads(
      [thread({ hasPendingInteraction: true }), thread({ isUnread: true })],
      NOW,
    );
    const merged = mergeRollups([left, right]);

    assert.equal(merged.total, 3);
    assert.equal(merged.working, 1);
    assert.equal(merged.needsYou, 1);
    assert.equal(merged.unread, 1);
    assert.equal(merged.kind, "needs-you");
  });

  it("ignores empty input rather than inventing a state", () => {
    const empty = rollupThreads([], NOW);
    assert.equal(empty.total, 0);
    assert.equal(empty.kind, "inactive");
    assert.equal(rollupSummary(empty), "");
    assert.equal(mergeRollups([empty, empty]).total, 0);
  });

  /**
   * A folded row draws the same cluster a chip does, so the rollup carries the
   * ids — and it names the threads that *put the chip there*, not the first three
   * under the row. A project's first three threads are usually the quiet ones,
   * and a colour that points at nothing is decoration. It also bounds them
   * itself: a cap applied at the call site would leave a summary's width growing
   * with the branch under it, which is the one thing a summary may not do.
   */
  it("names the threads carrying a signal, in list order, capped", () => {
    const threads = [
      thread({ indicator: "none" }),
      thread({ indicator: "runtime" }),
      thread({ indicator: "none" }),
      thread({ hasPendingInteraction: true }),
      thread({ indicator: "none" }),
    ];
    const rollup = rollupThreads(threads, NOW);
    assert.equal(rollup.total, 5);
    assert.equal(rollupSignalCount(rollup), 2);
    assert.deepEqual(
      rollup.discIds,
      [threads[1]!.id, threads[3]!.id],
      "the idle threads are not named",
    );
    assert.equal(MAX_DISC_IDS, 3);
  });

  it("caps the named threads, and the number is not the branch's size", () => {
    const threads = [
      thread({ indicator: "runtime" }),
      thread({ indicator: "runtime" }),
      thread({ indicator: "runtime" }),
      thread({ indicator: "runtime" }),
      thread({ indicator: "none" }),
      thread({ indicator: "none" }),
    ];
    const rollup = rollupThreads(threads, NOW);
    assert.equal(rollup.total, 6);
    assert.equal(rollupSignalCount(rollup), 4);
    assert.equal(rollup.discIds.length, MAX_DISC_IDS);
  });

  it("counts no signals for a branch that is only quiet", () => {
    const rollup = rollupThreads(
      [thread({ indicator: "none" }), thread({ indicator: "none" })],
      NOW,
    );
    // The same case as "draws no chip", by construction: the guard tests the
    // kind, and the kind is inactive exactly when this is 0.
    assert.equal(rollupSignalCount(rollup), 0);
    assert.deepEqual(rollup.discIds, []);
    assert.equal(rollup.kind, "inactive");
  });

  it("keeps the first ids when child rollups are merged", () => {
    const first = rollupThreads([thread({ indicator: "runtime" })], NOW);
    const second = rollupThreads(
      [thread({ indicator: "runtime" }), thread({ indicator: "runtime" })],
      NOW,
    );
    const third = rollupThreads([thread({ indicator: "runtime" })], NOW);
    const merged = mergeRollups([first, second, third]);
    assert.equal(merged.total, 4);
    assert.deepEqual(merged.discIds, [...first.discIds, ...second.discIds]);
  });

  it("has no ids to name for a quiet or empty branch", () => {
    assert.deepEqual(rollupThreads([], NOW).discIds, []);
    assert.deepEqual(mergeRollups([]).discIds, []);
  });

  it("names the jump target with a phrase, not the branch's counts", () => {
    // "Jump to the thread that 1 needs you · 2 working" was the old title: an
    // unfinished sentence as soon as more than one state was present.
    assert.equal(rollupLeadPhrase("failed"), "failed");
    assert.equal(rollupLeadPhrase("needs-you"), "needs you");
    assert.equal(rollupLeadPhrase("working"), "is working");
    assert.equal(rollupLeadPhrase("unread"), "you have not read");
  });

  it("summarises with the most urgent count first", () => {
    const rollup = rollupThreads(
      [
        thread({ indicator: "unread-error" }),
        thread({ hasPendingInteraction: true }),
        thread({ indicator: "runtime" }),
      ],
      NOW,
    );
    assert.equal(rollupSummary(rollup), "1 failed · 2 needs you · 1 working");
  });
});
