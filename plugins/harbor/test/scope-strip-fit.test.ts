import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ENTER_SLACK_PX,
  LEAVE_BAND_PX,
  nextScopeStripLayout,
} from "../lib/ui/scope-strip-fit.ts";

const decide = (
  current: "labels" | "compact",
  needed: number,
  available: number,
) => nextScopeStripLayout({ current, needed, available });

describe("scope strip layout", () => {
  it("keeps the names while they fit", () => {
    assert.equal(decide("labels", 300, 320), "labels");
  });

  it("falls back to tiles once the names overflow", () => {
    assert.equal(decide("labels", 340, 320), "compact");
  });

  it("ignores an overflow inside the slack", () => {
    // A rounding artefact is not a reason to redraw the strip.
    assert.equal(decide("labels", 320 + ENTER_SLACK_PX, 320), "labels");
    assert.equal(decide("labels", 320 + ENTER_SLACK_PX + 1, 320), "compact");
  });

  it("gives the names back once there is room to spare", () => {
    assert.equal(decide("compact", 300, 320), "labels");
    assert.equal(decide("compact", 300, 300 + LEAVE_BAND_PX + 1), "labels");
  });

  it("holds still inside the band, whichever way it arrived", () => {
    // The two thresholds do not meet on purpose: a width that fits the names
    // but barely is left alone rather than becoming a fifth of a second of
    // flicker on every resize.
    const barelyFits = 320 - LEAVE_BAND_PX + 1;
    assert.equal(decide("compact", barelyFits, 320), "compact");
    assert.equal(decide("labels", barelyFits, 320), "labels");
  });

  it("waits for a measurement before changing anything", () => {
    assert.equal(decide("labels", 0, 0), "labels");
    assert.equal(decide("compact", 0, 320), "compact");
    assert.equal(decide("compact", 300, 0), "compact");
  });
});
