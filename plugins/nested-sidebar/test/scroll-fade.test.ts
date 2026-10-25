import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scrollFadeState, scrollFadeStyle, SCROLL_FADE_REM } from "../lib/scroll-fade.ts";

const metrics = (
  scrollLeft: number,
  scrollWidth: number,
  clientWidth: number,
) => ({ scrollLeft, scrollWidth, clientWidth });

describe("scrollFadeState", () => {
  it("does not fade a strip that does not overflow", () => {
    // The whole point: a strip that fits shows no hint of hidden content.
    assert.equal(scrollFadeState(metrics(0, 200, 200)), "none");
    assert.equal(scrollFadeState(metrics(0, 150, 200)), "none");
  });

  it("fades only the leading edge when scrolled past the start", () => {
    // Flush with the start: only the trailing edge hides anything.
    assert.equal(scrollFadeState(metrics(0, 400, 200)), "end");
    // Part way through: both edges hide content.
    assert.equal(scrollFadeState(metrics(50, 400, 200)), "both");
    assert.equal(scrollFadeState(metrics(100, 400, 200)), "both");
  });

  it("fades only the trailing edge while flush with the start", () => {
    assert.equal(scrollFadeState(metrics(0, 400, 200)), "end");
  });

  it("fades only the leading edge once flush with the end", () => {
    assert.equal(scrollFadeState(metrics(200, 400, 200)), "start");
    // Overscroll (rubber banding) must not flip the state back.
    assert.equal(scrollFadeState(metrics(240, 400, 200)), "start");
  });

  it("tolerates sub-pixel offsets at the extremes", () => {
    // A half-pixel of scroll at the start would otherwise light up the leading
    // fade on a strip that is effectively flush.
    assert.equal(scrollFadeState(metrics(0.5, 400, 200)), "end");
    // Same at the other end: half a pixel short of the end is flush enough.
    assert.equal(scrollFadeState(metrics(199.5, 400, 200)), "start");
    // A pixel of genuinely hidden content still counts.
    assert.equal(scrollFadeState(metrics(198, 400, 200)), "both");
  });
});

describe("scrollFadeStyle", () => {
  it("returns no style when nothing is hidden", () => {
    assert.equal(scrollFadeStyle(metrics(0, 200, 200)), undefined);
  });

  it("carries both the standard and prefixed mask", () => {
    const style = scrollFadeStyle(metrics(0, 400, 200));
    assert.ok(style !== undefined);
    assert.equal(typeof style.maskImage, "string");
    assert.equal(style.maskImage, style.WebkitMaskImage);
    assert.match(String(style.maskImage), /linear-gradient\(to right/);
  });

  it("fades into the sidebar surface rather than a literal colour", () => {
    const style = scrollFadeStyle(metrics(0, 400, 200));
    assert.match(String(style?.maskImage), /var\(--sidebar/);
  });

  it("uses the same band width as bb's own fade utility", () => {
    assert.equal(SCROLL_FADE_REM, 1.5);
    const style = scrollFadeStyle(metrics(0, 400, 200));
    assert.match(String(style?.maskImage), /1\.5rem/);
  });
});
