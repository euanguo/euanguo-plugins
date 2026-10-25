import { useCallback } from "react";
import { autoAnimate } from "@formkit/auto-animate";
import { publishRowLayoutChanged } from "@/lib/row-pointer";

/**
 * The list transitions for the tree's row containers.
 *
 * Ported from BB Sidebar (`src/ThreadInbox.tsx`, `useListAutoAnimate`); see
 * THIRD_PARTY_NOTICES.md.
 *
 * The upstream hook also keeps a module-level registry of live controllers and
 * a counted suspend/resume, because its reorder drag reads insertion position
 * from row geometry while rows may be mid-flight, and an animating rect reports
 * where a row WAS rather than the slot the order has already given it.
 *
 * Nest does not need either. It reorders with native HTML5 drag-and-drop: no
 * row moves in the DOM during the gesture, and `before`/`after` is decided in
 * the drop handler from the target row's own (static) box. There is nothing to
 * hold still, so the registry and both functions are dropped rather than
 * ported as dead weight. The exit sweep below is added rather than ported.
 */

/**
 * auto-animate's own marker for a row it is taking out. Read here because it is
 * the one thing that tells a row auto-animate abandoned apart from a row React
 * owns — see `sweepAbandonedExits`.
 */
const ABANDONED_MARKER = "__aa_del";

/** The three inline styles `remove` applies to a row it floats out. */
const EXIT_STYLE = {
  position: "absolute",
  zIndex: "100",
  pointerEvents: "none",
} as const;

/** auto-animate's `remove` runs for this long; see the callback below. */
const EXIT_MS = 150;
/** Long enough for an exit to finish, short enough that a stuck one is not seen. */
const SWEEP_DELAY_MS = EXIT_MS + 150;

/**
 * Delete a row auto-animate left floating.
 *
 * Its `remove` pulls the leaving row out of flow — `position: absolute` at the
 * row's old coordinates, `zIndex: 100`, `pointerEvents: none` — and waits for
 * the animation's `finish` event to run `cleanUp`, which is what finally takes
 * the element out of the document. When that event does not arrive the row
 * stays for good, drawn over the list it left and over whatever has since taken
 * its place. That is the overlap that shows up when an expand lands on the
 * heels of a collapse: the previous collapse's rows are still floating exactly
 * where the new rows are being drawn.
 *
 * Upstream, open: <https://github.com/formkit/auto-animate/issues/231> —
 * "Deleted elements are not removed from the document but instead overlay
 * existing elements".
 *
 * The test is deliberately narrow, because a false positive would delete a row
 * React still owns:
 *
 * - a direct child of this container,
 * - carrying all three of `remove`'s exit styles,
 * - still marked as being deleted. `cleanUp` is what clears that mark, so the
 *   combination can only mean a removal that never finished.
 * - and with nothing animating. A row on its way out is left alone; this waits
 *   for the exit to have had its full run first.
 */
function sweepAbandonedExits(node: HTMLElement) {
  // `children` is a *live* collection and this loop removes from it, so it is
  // copied first: iterating it directly would skip every element that follows a
  // removal, which is exactly the element this sweep exists to reach.
  for (const row of Array.from(node.children)) {
    if (!(row instanceof HTMLElement)) continue;
    if (
      row.style.position !== EXIT_STYLE.position ||
      row.style.zIndex !== EXIT_STYLE.zIndex ||
      row.style.pointerEvents !== EXIT_STYLE.pointerEvents
    ) {
      continue;
    }
    if (!(ABANDONED_MARKER in row)) continue;
    if (row.getAnimations().some((animation) => animation.playState === "running")) {
      continue;
    }
    row.remove();
  }
}

/**
 * auto-animate floats a leaving row over the list until its exit finishes.
 * Even with `pointer-events: none` on the row, descendants can still win the
 * browser's hit test. `inert` removes the whole subtree from hit testing and
 * focus while the animation owns it.
 */
function disableExitPointerTargets(node: HTMLElement) {
  for (const row of Array.from(node.children)) {
    if (!(row instanceof HTMLElement)) continue;
    if (row.style.position !== EXIT_STYLE.position) continue;
    if (row.style.zIndex !== EXIT_STYLE.zIndex) continue;
    row.inert = true;
    row.style.setProperty("pointer-events", EXIT_STYLE.pointerEvents, "important");
  }
}

export function useListAutoAnimate<T extends HTMLElement>() {
  return useCallback((node: T | null) => {
    // A DOM the tests build has no `matchMedia`, and auto-animate needs it — so
    // the container is simply left unanimated rather than throwing on mount.
    if (!node || typeof window.matchMedia !== "function") return;
    const animation = autoAnimate(node, {
      duration: EXIT_MS,
      easing: "ease-out",
    });

    // A leaving row is only ever abandoned by a mutation — the one that removed
    // it, or one that interrupts its exit — so a sweep scheduled after each
    // batch is enough to catch it. One timer per batch rather than a debounce,
    // so a burst of changes cannot keep pushing the sweep out.
    const timers = new Set<number>();
    const layoutTimers = new Set<number>();
    const observer = new MutationObserver(() => {
      disableExitPointerTargets(node);
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        sweepAbandonedExits(node);
      }, SWEEP_DELAY_MS);
      timers.add(timer);

      // The first check covers removals without an exit animation. The second
      // lands after auto-animate has moved the surviving rows into place.
      publishRowLayoutChanged();
      const layoutTimer = window.setTimeout(() => {
        layoutTimers.delete(layoutTimer);
        publishRowLayoutChanged();
      }, EXIT_MS + 16);
      layoutTimers.add(layoutTimer);
    });
    observer.observe(node, { childList: true });

    return () => {
      observer.disconnect();
      for (const timer of timers) window.clearTimeout(timer);
      timers.clear();
      for (const timer of layoutTimers) window.clearTimeout(timer);
      layoutTimers.clear();
      // Dropping our reference is not enough: auto-animate holds the parent in
      // its own registry and keeps observers and a polling interval alive until
      // it is told to let go.
      animation.destroy?.();
    };
  }, []);
}
