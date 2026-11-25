import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { readInboxModules } from "./_sources.ts";
import {
  forgetHarborActions,
  harborActions,
  publishHarborActions,
  type PublishedHarborActions,
} from "../lib/ui/palette-bridge.ts";

const app = await readFile(new URL("../app.tsx", import.meta.url), "utf8");
const inbox = await readInboxModules();

function actions(
  overrides: Partial<PublishedHarborActions> = {},
): PublishedHarborActions {
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
  // A user who has pinned bb's own list has no Harbor inbox. That is a normal
  // state, so every reader answers rather than throwing.
  it("reads as empty before anything is published", () => {
    assert.equal(harborActions(), null);
  });

  it("hands back what the mounted inbox published", () => {
    const published = actions({ canPark: () => true });
    publishHarborActions(published);
    assert.equal(harborActions(), published);
    assert.equal(harborActions()?.canPark("thr_1"), true);
    forgetHarborActions(published);
  });

  it("replaces one publisher with the next", () => {
    const first = actions();
    const second = actions();
    publishHarborActions(first);
    publishHarborActions(second);
    assert.equal(harborActions(), second);
    forgetHarborActions(second);
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
    publishHarborActions(current);
    forgetHarborActions(stale);
    assert.equal(harborActions(), current);
    forgetHarborActions(current);
    assert.equal(harborActions(), null);
  });
});

/**
 * The rows are registered outside React and run outside the inbox's tree, so
 * each one has to ask the mounted inbox before it is offered. A row that is
 * listed and then does nothing is worse than a row that is not listed.
 */
describe("palette rows", () => {
  it("registers one row per verb", () => {
    const ids = [...app.matchAll(/id: "([a-z-]+)",\s*\n\s*title: "Harbor: /g)].map(
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
      /isAvailable: \(\{ threadId \}\) =>\s*threadId !== null && harborActions\(\)\?\.canPark\(threadId\) === true/,
    );
    assert.match(
      app,
      /isAvailable: \(\{ threadId \}\) =>\s*threadId !== null && harborActions\(\)\?\.isParked\(threadId\) === true/,
    );
    // The view row needs the inbox but no thread.
    assert.match(app, /isAvailable: \(\) => harborActions\(\) !== null/);
  });

  it("routes every run through the bridge rather than around it", () => {
    for (const verb of ["settle", "snoozeUntilTomorrow", "wake", "showNeedsYou"]) {
      assert.match(app, new RegExp(`harborActions\\(\\)\\?\\.${verb}\\(`));
    }
  });

  /**
   * A wake is only meaningful for a thread that is actually parked, and a settle
   * only for one that can be parked — so the two rows are gated on opposite
   * questions. A blanket `hasActions()` on both would offer a settle for a
   * working thread and a wake for a running one.
   */
  it("asks the park rules, not merely whether an inbox exists", () => {
    assert.match(app, /harborActions\(\)\?\.canPark\(threadId\) === true/);
    assert.match(app, /harborActions\(\)\?\.isParked\(threadId\) === true/);
  });

  it("publishes once, so the slot cannot blink to null between renders", () => {
    const publish = inbox.indexOf("publishHarborActions(actions)");
    const end = inbox.indexOf("}, []);", publish);
    assert.ok(publish >= 0 && end > publish);
    const effect = inbox.slice(publish, end);
    assert.match(effect, /return \(\) => forgetHarborActions\(actions\)/);
    assert.match(inbox.slice(end, end + 20), /^\}, \[\]\);/);
  });

  it("refuses to park a thread the list is not drawing", () => {
    assert.match(
      inbox,
      /const thread = threads\.find\(\s*\(candidate\) => candidate\.id === threadId,?\s*\);\s*\n\s*return thread !== undefined && lifecycle\.canPark\(thread\)/,
    );
  });

  it("snoozes to the same wake time the row's own button uses", () => {
    assert.match(inbox, /resolveSnoozePresets\(new Date\(\)\)\.find\(/);
    assert.match(inbox, /preset\.id === "tomorrow"/);
  });
});
