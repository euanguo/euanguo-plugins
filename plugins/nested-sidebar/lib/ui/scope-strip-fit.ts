/**
 * Which layout the scope strip draws, decided from what the labels *need*.
 *
 * The strip used to decide by measuring what was on screen: labels overflowed,
 * so it drew tiles, and tiles fitted, so it kept them. Anything that asked it to
 * look again — a one-pixel sidebar resize did — showed a frame of labels before
 * the tiles came back, which is what made the boundary flicker. The measurement
 * now comes from a layer that always draws the labels, so what is on screen
 * cannot change the answer.
 *
 * A single threshold would still flip at ±1px, so there are two: an overflow
 * has to reach `ENTER_SLACK_PX` before the tiles win, and the labels only come
 * back once the strip has `LEAVE_BAND_PX` of room to spare. Between the two the
 * strip keeps whatever it is already showing.
 */
export type ScopeStripLayout = "labels" | "compact";

/** Overflow below this is a subpixel rounding artefact, not a reason to switch. */
export const ENTER_SLACK_PX = 2;

/** The room the labels need before a compact strip gives them back. */
export const LEAVE_BAND_PX = 16;

export function nextScopeStripLayout(input: {
  current: ScopeStripLayout;
  /** Width the label layout asks for. */
  needed: number;
  /** Width the strip has. */
  available: number;
}): ScopeStripLayout {
  const { current, needed, available } = input;
  // Nothing has been laid out yet: the first pass with real numbers decides.
  if (available <= 0 || needed <= 0) return current;
  if (current === "compact") {
    return needed <= available - LEAVE_BAND_PX ? "labels" : "compact";
  }
  return needed > available + ENTER_SLACK_PX ? "compact" : "labels";
}
