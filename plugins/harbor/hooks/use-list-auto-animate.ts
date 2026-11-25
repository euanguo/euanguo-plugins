import { useCallback } from "react";
import { autoAnimate } from "@formkit/auto-animate";
import { publishRowLayoutChanged } from "@/lib/ui/row-pointer-events";

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
 * Harbor does not need either. It reorders with native HTML5 drag-and-drop: no
 * row moves in the DOM during the gesture, and `before`/`after` is decided in
 * the drop handler from the target row's own (static) box. There is nothing to
 * hold still, so the registry and both functions are dropped rather than
 * ported as dead weight. The exit sweep below is added rather than ported.
 */

/** The three inline styles `remove` applies to a row it floats out. */
const EXIT_STYLE = {
  position: "absolute",
  zIndex: "100",
  pointerEvents: "none",
} as const;

/** auto-animate's `remove` runs for this long; see the callback below. */
const EXIT_MS = 150;
/** Long enough for an exit to finish, short enough that a stuck one is not seen. */
const SWEEP_DELAY_MS = EXIT_MS + 90;

/**
 * Delete a row auto-animate left floating.
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
