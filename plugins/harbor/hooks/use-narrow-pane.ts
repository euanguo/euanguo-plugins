import { useEffect, useLayoutEffect, useState } from "react";
import { nextWorkspaceTabStripCompact } from "@/lib/domain/workspace-tabs";

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

function readObservedWidth(
  element: HTMLElement,
  entry?: ResizeObserverEntry,
): number {
  const borderWidth = entry?.borderBoxSize?.[0]?.inlineSize;
  if (
    typeof borderWidth === "number" &&
    Number.isFinite(borderWidth) &&
    borderWidth > 0
  ) {
    return borderWidth;
  }
  const rectWidth = element.getBoundingClientRect().width;
  if (Number.isFinite(rectWidth) && rectWidth > 0) {
    return rectWidth;
  }
  const contentWidth = entry?.contentRect?.width;
  if (
    typeof contentWidth === "number" &&
    Number.isFinite(contentWidth) &&
    contentWidth > 0
  ) {
    return contentWidth;
  }
  return 0;
}

/**
 * Measures a container via a callback ref so `ResizeObserver` rebinds whenever
 * the observed element mounts or swaps, collapsing/expanding with hysteresis.
 */
export function useNarrowPane() {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [narrow, setNarrow] = useState(false);

  useIsomorphicLayoutEffect(() => {
    if (element === null) return;
    const update = (width: number) => {
      setNarrow((prev) => nextWorkspaceTabStripCompact(prev, width));
    };
    update(readObservedWidth(element));
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      update(readObservedWidth(element, entries[0]));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return { ref: setElement, narrow };
}

/**
 * Measures an element's live width via a callback ref (safe across conditional
 * mounts such as loading -> ready transitions).
 */
export function useElementWidth() {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (element === null) return;
    const initial = readObservedWidth(element);
    if (initial > 0) setWidth(initial);
    if (typeof ResizeObserver === "undefined") return;
    let rafId = 0;
    const observer = new ResizeObserver((entries) => {
      const next = readObservedWidth(element, entries[0]);
      if (next <= 0) return;
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => setWidth(next));
    });
    observer.observe(element);
    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [element]);

  return { ref: setElement, width };
}
