import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  nextMarkerDelayMs,
  snoozedRowStatuses,
} from "../lib/row-status.ts";
import type { ThreadLifecycleRow } from "../lib/lifecycle.ts";

const app = await readFile(new URL("../app.tsx", import.meta.url), "utf8");
const mount = await readFile(
  new URL("../lib/row-status-mount.ts", import.meta.url),
  "utf8",
);
const status = await readFile(new URL("../lib/row-status.ts", import.meta.url), "utf8");

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
  it("marks a thread Nest is holding back", () => {
    const statuses = snoozedRowStatuses({
      rows: [row({ snoozedUntil: 2 * HOUR, snoozedAt: 0 })],
      now: HOUR,
    });
    assert.equal(statuses.length, 1);
    assert.equal(statuses[0]?.threadId, "thr_1");
    assert.equal(statuses[0]?.status.icon, "Clock");
    assert.match(String(statuses[0]?.status.label), /^Snoozed by Nest · wakes in /);
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

/**
 * The content script. It runs whether or not Nest is the chosen list, gets no DOM
 * container, and is disposed when the frontend generation is replaced.
 */
describe("the row-status content script", () => {
  it("is registered as a content script, not a slot", () => {
    assert.match(app, /app\.contentScripts\.register\(\{/);
    assert.match(app, /id: "nest-row-status"/);
    assert.match(app, /mount: mountNestRowStatus/);
  });

  // The surface is experimental and an older client may not have it. Doing
  // nothing is the right answer; throwing would take the plugin down over a
  // decoration.
  it("feature-detects the host's decoration surface", () => {
    assert.match(
      mount,
      /const setStatus = context\.experimental_setThreadRowStatus;/,
    );
    assert.match(mount, /if \(setStatus === undefined\) return \(\) => undefined;/);
  });

  // A thread that woke up has to lose its glyph, or the marker outlives its
  // reason — which is exactly the thing a marker must not do.
  it("clears a marker it is no longer setting", () => {
    assert.match(mount, /for \(const threadId of applied\) \{/);
    assert.match(mount, /setStatus\(threadId, null\)/);
    assert.match(mount, /applied = \[\.\.\.ids\]/);
  });

  /**
   * One timer for the soonest wake rather than an interval, clamped because
   * `setTimeout` takes a signed 32-bit value and a far-future snooze would fire
   * at once in a tight loop.
   */
  it("arms one clamped timer rather than polling", () => {
    assert.match(mount, /nextMarkerDelayMs\(rows, now\)/);
    assert.match(mount, /Math\.min\(delay \+ 50, MAX_TIMEOUT_MS\)/);
    assert.match(mount, /window\.setTimeout\(apply, /);
    assert.doesNotMatch(mount, /setInterval/);
  });

  // Cross-tab only: a same-tab write does not fire `storage`, so the focus
  // re-read is what covers that case. Two listeners, two different gaps.
  it("re-reads on focus and on a cross-tab write", () => {
    assert.match(mount, /window\.addEventListener\("focus", onFocus\)/);
    assert.match(mount, /window\.addEventListener\("storage", onStorage\)/);
    assert.match(mount, /event\.key === WARM_START_ROWS_KEY/);
  });

  it("hands its markers back on disposal", () => {
    assert.match(mount, /context\.signal\.addEventListener\("abort", dispose\)/);
    assert.match(mount, /return dispose;/);
  });

  /**
   * The limitation is stated where it is created, not left for a reader to
   * discover: with Nest not the provider its hooks are not mounted, so nothing
   * refreshes the cache the script reads.
   */
  it("says what it cannot know, in the module that decides it", () => {
    assert.match(status, /The honest limitation/);
    assert.match(status, /snapshot of the last state Nest/);
  });
});