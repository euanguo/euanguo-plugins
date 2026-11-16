import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  nextScopeStripLayout,
  type ScopeStripLayout,
} from "@/lib/ui/scope-strip-fit";

/** How long the strip's width has to hold still before the layout is re-decided. */
export const SCOPE_STRIP_SETTLE_MS = 120;

/**
 * The scope strip's layout, held still.
 *
 * `probe` is a layer that always draws the labels, off to the side and out of
 * sight; `box` is the strip's own width. Comparing the two decides the layout
 * without looking at what is currently rendered, which is what keeps a resize
 * from flipping the strip back and forth at the boundary.
 *
 * The first decision is made in a layout effect, before paint, so a strip that
 * opens overflowing does not flash its labels first. Later ones wait for the
 * width to settle: dragging the sidebar changes the width on every frame, and
 * deciding each time is the flicker this exists to remove.
 *
 * `enabled` false means the user asked for names; the geometry is not consulted
 * at all then, which is also why no observer runs.
 */
export function useScopeStripFit({
  box,
  probe,
  enabled,
}: {
  box: React.RefObject<HTMLElement | null>;
  probe: React.RefObject<HTMLElement | null>;
  enabled: boolean;
}): ScopeStripLayout {
  const [layout, setLayout] = useState<ScopeStripLayout>("labels");
  const current = useRef<ScopeStripLayout>("labels");

  const decide = useCallback(() => {
    const boxElement = box.current;
    const probeElement = probe.current;
    if (boxElement === null || probeElement === null) return;
    const next = nextScopeStripLayout({
      current: current.current,
      needed: probeElement.scrollWidth,
      available: boxElement.clientWidth,
    });
    if (next === current.current) return;
    current.current = next;
    setLayout(next);
  }, [box, probe]);

  useLayoutEffect(() => {
    if (!enabled) {
      current.current = "labels";
      setLayout("labels");
      return;
    }
    decide();
  }, [decide, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const boxElement = box.current;
    const probeElement = probe.current;
    if (boxElement === null || probeElement === null) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const settle = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        decide();
      }, SCOPE_STRIP_SETTLE_MS);
    };

    const observer = new ResizeObserver(settle);
    // The strip's width, and the width the labels ask for. Watching the probe
    // rather than the strip's contents is the point: adding a scope changes
    // both what is rendered and what is needed, and only the latter decides.
    observer.observe(boxElement);
    observer.observe(probeElement);
    return () => {
      observer.disconnect();
      if (timer !== null) clearTimeout(timer);
    };
  }, [box, decide, enabled, probe]);

  return enabled ? layout : "labels";
}
