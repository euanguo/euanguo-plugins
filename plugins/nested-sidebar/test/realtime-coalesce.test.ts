import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  coalesceDecision,
  REALTIME_COALESCE_MS,
} from "../lib/realtime-coalesce.ts";

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

/**
 * The wiring, checked across the whole directory rather than per file, so a hook
 * added later cannot quietly subscribe without the coalescing. Every one of these
 * channels can publish in a burst — a bulk operation, a settled thread taking
 * several turns, a project reorder that touches two scopes — and each burst used
 * to cost one read per publish.
 */
describe("every realtime subscription coalesces", () => {
  it("has no bare useRealtime left in hooks", async () => {
    const entries = await readdir(new URL("../hooks/", import.meta.url));
    const offenders: string[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".ts")) continue;
      // The wrapper itself is the one place the raw hook belongs.
      if (entry === "use-coalesced-realtime.ts") continue;
      const source = await readFile(
        new URL(`../hooks/${entry}`, import.meta.url),
        "utf8",
      );
      // `useRealtimeConnectionState(` does not match this: the paren follows the
      // bare name.
      if (/useRealtime\(/.test(source)) offenders.push(entry);
    }
    assert.deepEqual(offenders, []);
  });

  it("subscribes through the wrapper on every channel it reads", async () => {
    // The argument as written at the call site: a quoted literal for bb's own
    // channels, an imported constant for this plugin's.
    const channels: Array<[file: string, channel: string]> = [
      ["use-lifecycle.ts", '"lifecycle"'],
      ["use-settled-threads.ts", '"lifecycle"'],
      ["use-project-icons.ts", '"project-icons"'],
      ["use-project-colors.ts", '"project-colors"'],
      ["use-nest-order.ts", "ORDER_CHANNEL"],
      ["use-groups.ts", "GROUP_CHANNEL"],
      ["use-view-preferences.ts", "VIEW_PREFERENCE_CHANNEL"],
    ];
    for (const [file, channel] of channels) {
      const source = await readFile(
        new URL(`../hooks/${file}`, import.meta.url),
        "utf8",
      );
      assert.match(
        source,
        new RegExp(`useCoalescedRealtime\\(${channel},`),
        `${file} must coalesce ${channel}`,
      );
    }
  });

  /**
   * A trailing read that fires after unmount would set state on a dead tree, and
   * the wrapper is the only place that can clear it.
   */
  it("clears a pending trailing read on unmount", async () => {
    const wrapper = await readFile(
      new URL("../hooks/use-coalesced-realtime.ts", import.meta.url),
      "utf8",
    );
    assert.match(wrapper, /clearTimeout\(trailing\.current\)/);
    assert.match(wrapper, /useEffect\(\s*\(\) => \(\) => \{/);
  });
});