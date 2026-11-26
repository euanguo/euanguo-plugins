import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  forgetHarborActions,
  harborActions,
  publishHarborActions,
  type PublishedHarborActions,
} from "../lib/ui/palette-bridge.ts";

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
