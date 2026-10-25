import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  forgetNestActions,
  nestActions,
  publishNestActions,
  type PublishedNestActions,
} from "../lib/palette-bridge.ts";

const app = await readFile(new URL("../app.tsx", import.meta.url), "utf8");
const inbox = await readFile(
  new URL("../components/inbox/thread-inbox.tsx", import.meta.url),
  "utf8",
);

function actions(
  overrides: Partial<PublishedNestActions> = {},
): PublishedNestActions {
  return {
    settle: () => undefined,
    snoozeUntilTomorrow: () => undefined,
    wake: () => undefined,
    canPark: () => false,
    isParked: () => false,
    showNeedsYou: () => undefined,
    ...overrides,
  };
}

describe("palette bridge", () => {
  // A user who has pinned bb's own list has no Nest inbox. That is a normal
  // state, so every reader answers rather than throwing.
  it("reads as empty before anything is published", () => {
    assert.equal(nestActions(), null);
  });

  it("hands back what the mounted inbox published", () => {
    const published = actions({ canPark: () => true });
    publishNestActions(published);
    assert.equal(nestActions(), published);
    assert.equal(nestActions()?.canPark("thr_1"), true);
    forgetNestActions(published);
  });

  it("replaces one publisher with the next", () => {
    const first = actions();
    const second = actions();
    publishNestActions(first);
    publishNestActions(second);
    assert.equal(nestActions(), second);
    forgetNestActions(second);
  });

  /**
   * The guard that matters. A remount publishes the new dispatcher before the
   * old one unmounts — React runs a new effect before the previous cleanup in a
   * strict-mode double invoke, and a fast remount does the same — so an
   * unconditional clear would take the palette's verbs away for the rest of the
   * session.
   */
  it("lets only the current publisher clear the slot", () => {
    const stale = actions();
    const current = actions();
    publishNestActions(current);
    forgetNestActions(stale);
    assert.equal(nestActions(), current);
    forgetNestActions(current);
    assert.equal(nestActions(), null);
  });
});

/**
 * The rows are registered outside React and run outside the inbox's tree, so
 * each one has to ask the mounted inbox before it is offered. A row that is
 * listed and then does nothing is worse than a row that is not listed.
 */
describe("palette rows", () => {
  it("registers one row per verb", () => {
    const ids = [...app.matchAll(/id: "([a-z-]+)",\s*\n\s*title: "Nest: /g)].map(
      (match) => match[1],
    );
    assert.deepEqual(ids, [
      "settle-thread",
      "snooze-thread",
      "wake-thread",
      "show-needs-you",
    ]);
  });

  it("gates every thread-scoped row on the mounted inbox", () => {
    assert.match(
      app,
      /isAvailable: \(\{ threadId \}\) =>\s*threadId !== null && nestActions\(\)\?\.canPark\(threadId\) === true/,
    );
    assert.match(
      app,
      /isAvailable: \(\{ threadId \}\) =>\s*threadId !== null && nestActions\(\)\?\.isParked\(threadId\) === true/,
    );
    // The view row needs the inbox but no thread.
    assert.match(app, /isAvailable: \(\) => nestActions\(\) !== null/);
  });

  it("routes every run through the bridge rather than around it", () => {
    for (const verb of ["settle", "snoozeUntilTomorrow", "wake", "showNeedsYou"]) {
      assert.match(app, new RegExp(`nestActions\\(\\)\\?\\.${verb}\\(`));
    }
  });

  /**
   * A wake is only meaningful for a thread that is actually parked, and a settle
   * only for one that can be parked — so the two rows are gated on opposite
   * questions. A blanket `hasActions()` on both would offer a settle for a
   * working thread and a wake for a running one.
   */
  it("asks the park rules, not merely whether an inbox exists", () => {
    assert.match(app, /nestActions\(\)\?\.canPark\(threadId\) === true/);
    assert.match(app, /nestActions\(\)\?\.isParked\(threadId\) === true/);
  });

  it("publishes once, so the slot cannot blink to null between renders", () => {
    const publish = inbox.indexOf("publishNestActions(actions)");
    const end = inbox.indexOf("}, []);", publish);
    assert.ok(publish >= 0 && end > publish);
    const effect = inbox.slice(publish, end);
    assert.match(effect, /return \(\) => forgetNestActions\(actions\)/);
    // The empty dep array is the mechanism: republishing per render would run a
    // cleanup first, and the palette's `isAvailable` runs while it is open.
    assert.match(effect, /oxlint-disable-next-line react\/exhaustive-deps/);
  });

  it("refuses to park a thread the list is not drawing", () => {
    assert.match(
      inbox,
      /const thread = currentThreads\.find\(\s*\(candidate\) => candidate\.id === threadId,?\s*\);\s*\n\s*return thread !== undefined && current\.canPark\(thread\)/,
    );
  });

  it("snoozes to the same wake time the row's own button uses", () => {
    assert.match(inbox, /resolveSnoozePresets\(new Date\(\)\)\.find\(/);
    assert.match(inbox, /preset\.id === "tomorrow"/);
  });
});