import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("shared minute clock", () => {
  it("shares one interval across subscribers and tears down when all unsubscribe", async (t) => {
    const startMs = 1_700_000_040_000;
    const setIntervalCalls: number[] = [];
    const clearIntervalCalls: unknown[] = [];
    const timer = t.mock.timers;
    timer.enable({ apis: ["setInterval", "Date"], now: startMs });

    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
      setIntervalCalls.push(Number(args[1] ?? 0));
      return originalSetInterval(...args);
    }) as typeof setInterval;
    globalThis.clearInterval = ((id: ReturnType<typeof setInterval>) => {
      clearIntervalCalls.push(id);
      return originalClearInterval(id);
    }) as typeof clearInterval;

    const { getMinuteClockMs, subscribeMinuteClock } = await import(
      `../hooks/use-minute-clock.ts?t=${startMs}`
    );

    let firstHits = 0;
    let secondHits = 0;
    const stopFirst = subscribeMinuteClock(() => {
      firstHits += 1;
    });
    const stopSecond = subscribeMinuteClock(() => {
      secondHits += 1;
    });
    let stoppedFirst = false;
    let stoppedSecond = false;

    try {
      const initial = getMinuteClockMs();
      assert.equal(initial, startMs);
      assert.equal(setIntervalCalls.length, 1);

      timer.tick(60_000);
      assert.ok(firstHits >= 1);
      assert.equal(firstHits, secondHits);
      assert.equal(getMinuteClockMs(), startMs + 60_000);

      const hitsBeforeUnsub = firstHits;
      stopFirst();
      stoppedFirst = true;
      assert.equal(clearIntervalCalls.length, 0);

      timer.tick(60_000);
      assert.equal(firstHits, hitsBeforeUnsub);
      assert.ok(secondHits > hitsBeforeUnsub);

      stopSecond();
      stoppedSecond = true;
      assert.equal(clearIntervalCalls.length, 1);

      const hitsAfterTeardown = secondHits;
      timer.tick(60_000);
      assert.equal(firstHits, hitsBeforeUnsub);
      assert.equal(secondHits, hitsAfterTeardown);
    } finally {
      if (!stoppedFirst) stopFirst();
      if (!stoppedSecond) stopSecond();
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  });
});
