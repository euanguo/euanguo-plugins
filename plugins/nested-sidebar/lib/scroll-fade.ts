import type { CSSProperties } from "react";

/**
 * Fade edges for a horizontally scrolling strip.
 *
 * The scope strip scrolls sideways, but a scrollbar there would cost height on
 * every render and a permanently reserved one would cost it even when nothing
 * overflows. Hiding the bar and fading the edges is the same trick bb ships as
 * `.fade-clip-right`: a `mask-image` that fades the content itself, so it costs
 * no layout height and the strip's height never changes.
 *
 * The difference from bb's utility is that each fade has to be *earned*. A
 * gradient pinned to both ends veils the first tab when the strip is already at
 * the start, which reads as "there is more to the left" when there is not. So an
 * edge fades only while it still hides content.
 *
 * Returned as inline style rather than utility classes: the gradient references
 * the sidebar's own background token, and arbitrary Tailwind values cannot carry
 * `var()` through the class extractor reliably.
 */

export interface ScrollFadeOffsets {
  /** Scroll amount still hidden behind the leading edge. */
  readonly start: number;
  /** Scroll amount still hidden ahead of the trailing edge. */
  readonly end: number;
}

/** How wide each fade band is. Matches bb's own `.fade-clip-right`. */
export const SCROLL_FADE_REM = 1.5;

/** The sidebar's surface, so the fade dissolves into the panel behind it. */
const OPAQUE = "var(--sidebar, var(--background, #000))";
const CLEAR = "transparent";
const BAND = `${SCROLL_FADE_REM}rem`;

const MASKS: Readonly<Record<"none" | "start" | "end" | "both", string>> = {
  none: "",
  // Leading edge only: fade in over the first band, then stay opaque.
  start: `linear-gradient(to right, ${CLEAR} 0, ${OPAQUE} ${BAND})`,
  // Trailing edge only: opaque until the last band, then fade out.
  end: `linear-gradient(to right, ${OPAQUE} calc(100% - ${BAND}), ${CLEAR} 100%)`,
  // Both: a transparent run at each end with the band width in between.
  both: `linear-gradient(to right, ${CLEAR} 0, ${OPAQUE} ${BAND}, ${OPAQUE} calc(100% - ${BAND}), ${CLEAR} 100%)`,
};

/**
 * Which edges still hide something.
 *
 * A one-pixel slack absorbs sub-pixel scroll offsets at the extremes, which
 * would otherwise leave a fade flickering on an edge that is actually flush.
 * Null means the strip does not overflow at all, so neither edge should fade.
 */
export function scrollFadeState(
  metrics: {
    readonly scrollLeft: number;
    readonly scrollWidth: number;
    readonly clientWidth: number;
  },
  slack = 1,
): "none" | "start" | "end" | "both" {
  const overflow = metrics.scrollWidth - metrics.clientWidth;
  if (overflow <= slack) return "none";
  const showStart = metrics.scrollLeft > slack;
  const showEnd = metrics.scrollLeft < overflow - slack;
  if (showStart && showEnd) return "both";
  if (showStart) return "start";
  if (showEnd) return "end";
  return "none";
}

/** The mask style for a metrics snapshot, or undefined when nothing fades. */
export function scrollFadeStyle(
  metrics: {
    readonly scrollLeft: number;
    readonly scrollWidth: number;
    readonly clientWidth: number;
  },
  slack = 1,
): CSSProperties | undefined {
  const state = scrollFadeState(metrics, slack);
  if (state === "none") return undefined;
  const mask = MASKS[state];
  // Both spellings: WebKit still needs the prefixed form, and React does not
  // polyfill it.
  return {
    maskImage: mask,
    WebkitMaskImage: mask,
  };
}
