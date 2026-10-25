import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { scrollFadeStyle } from "@/lib/scroll-fade";

interface ScrollMetrics {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}

const EMPTY_METRICS: ScrollMetrics = {
  scrollLeft: 0,
  scrollWidth: 0,
  clientWidth: 0,
};

/**
 * A horizontally scrolling strip that never shows a scrollbar.
 *
 * Three behaviours, all in service of the same thing — the strip must advertise
 * that it scrolls without spending a single pixel of height doing it:
 *
 * 1. The bar is hidden with bb's own `no-scrollbar` utility rather than a
 *    bespoke rule, so the strip's height is the same whether or not it
 *    overflows. Nothing else on the row can shift when the last tab appears.
 * 2. The edges fade, but only where content is actually cut off, so the first
 *    tab is never veiled when the strip is already at its start.
 * 3. A vertical wheel scrolls it sideways. A strip that only responds to a
 *    sideways gesture is one most pointers can never drive; mapping the
 *    dominant axis means an ordinary wheel works, while a genuine sideways
 *    swipe is still left to the browser.
 *
 * The wheel listener is registered by hand and non-passive: React attaches
 * `wheel` passively at the root, where `preventDefault` is ignored, and
 * swallowing the gesture is what keeps the page from scrolling underneath.
 */
export function ScrollStrip({
  className,
  style,
  children,
  onOverflowChange,
  onContainerResize,
  ...rest
}: {
  className?: string;
  style?: React.CSSProperties;
  children: ReactNode;
  /** Notifies callers when content crosses the horizontal overflow boundary. */
  onOverflowChange?: (overflowing: boolean) => void;
  /** Called when the available strip width changes, such as sidebar resize. */
  onContainerResize?: () => void;
} & Omit<React.ComponentPropsWithoutRef<"div">, "className" | "style" | "children" | "ref">) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState<ScrollMetrics>(EMPTY_METRICS);
  const frame = useRef<number | null>(null);
  const previousClientWidth = useRef<number | null>(null);

  const measure = useCallback(() => {
    const element = innerRef.current;
    if (element === null) return;
    const next: ScrollMetrics = {
      scrollLeft: element.scrollLeft,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    };
    if (previousClientWidth.current !== null && previousClientWidth.current !== next.clientWidth) {
      onContainerResize?.();
    }
    previousClientWidth.current = next.clientWidth;
    setMetrics((previous) =>
      previous.scrollLeft === next.scrollLeft &&
      previous.scrollWidth === next.scrollWidth &&
      previous.clientWidth === next.clientWidth
        ? previous
        : next,
    );
    onOverflowChange?.(next.scrollWidth - next.clientWidth > 1);
  }, [onContainerResize, onOverflowChange]);

  /**
   * Re-measure on scroll and whenever the strip or its contents change size.
   * Observing the children as well as the strip matters: adding a tab changes
   * `scrollWidth` without changing the strip's own box, so a strip-only
   * observer would never notice the fade becoming due.
   */
  useEffect(() => {
    const element = innerRef.current;
    if (element === null) return;
    measure();
    const observer = new ResizeObserver(() => measure());
    observer.observe(element);
    for (const child of Array.from(element.children)) observer.observe(child);
    const mutations = new MutationObserver(() => {
      for (const child of Array.from(element.children)) observer.observe(child);
      measure();
    });
    mutations.observe(element, { childList: true, characterData: true, subtree: true });
    return () => {
      observer.disconnect();
      mutations.disconnect();
    };
  }, [measure]);

  useEffect(() => {
    const element = innerRef.current;
    if (element === null) return;

    const onWheel = (event: WheelEvent) => {
      // A sideways gesture is the browser's to handle; only the vertical one
      // needs translating.
      if (event.deltaY === 0) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const overflow = element.scrollWidth - element.clientWidth;
      if (overflow <= 1) return;
      const before = element.scrollLeft;
      element.scrollLeft = before + event.deltaY;
      // Only swallow the gesture when it actually moved something, so wheel
      // scrolling still chains to the page at either end of the strip.
      if (element.scrollLeft !== before) event.preventDefault();
    };

    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  const handleScroll = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      measure();
    });
  }, [measure]);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  return (
    <div
      {...rest}
      ref={innerRef}
      onScroll={handleScroll}
      style={{ ...style, ...scrollFadeStyle(metrics) }}
      className={cn("no-scrollbar", className)}
      data-nest-scroll-strip=""
    >
      {children}
    </div>
  );
}
