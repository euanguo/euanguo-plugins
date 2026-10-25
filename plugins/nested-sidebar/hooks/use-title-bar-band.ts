import { useLayoutEffect, useRef, useState } from "react";

const TITLE_BAR = '[data-testid="app-window-title-bar"]';
const PLUGIN_OVERLAYS = "[data-bb-plugin-app-overlays]";
const OUR_OVERLAY = "[data-nest-title-attention]";
const CONTROLS = 'button, a, [role="button"], [role="link"], input';

export interface TitleBarBand {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The empty run between the title bar's own controls.
 *
 * bb leaves this strip empty and keeps the rest draggable. Measuring the
 * controls lets the chips land in the gap without covering them, and watching
 * only the title bar and the overlay layer keeps chat streaming from causing a
 * layout read on every token.
 */
function measureBand(): TitleBarBand | null {
  const bar = document.querySelector<HTMLElement>(TITLE_BAR);
  if (bar === null) return null;
  const rect = bar.getBoundingClientRect();
  if (rect.width < 80 || rect.height < 8) return null;

  const center = rect.left + rect.width / 2;
  let left = rect.left;
  let right = rect.right - 12;
  const controls = [
    ...bar.querySelectorAll<HTMLElement>(CONTROLS),
    ...document.querySelectorAll<HTMLElement>(
      `${PLUGIN_OVERLAYS} :is(${CONTROLS})`,
    ),
  ];
  for (const control of controls) {
    if (control.closest(OUR_OVERLAY)) continue;
    const box = control.getBoundingClientRect();
    if (box.width === 0 || box.bottom <= rect.top || box.top >= rect.bottom) {
      continue;
    }
    if (box.right <= center) {
      left = Math.max(left, box.right);
    } else {
      right = Math.min(right, box.left);
    }
  }

  left += 16;
  right -= 16;
  if (right - left < 72) return null;
  return {
    top: Math.round(rect.top),
    left,
    width: right - left,
    height: rect.height,
  };
}

function sameBand(
  left: TitleBarBand | null,
  right: TitleBarBand | null,
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.top === right.top &&
      left.left === right.left &&
      left.width === right.width &&
      left.height === right.height)
  );
}

export function useTitleBarBand(): TitleBarBand | null {
  const [band, setBand] = useState<TitleBarBand | null>(null);
  const updateRef = useRef(() => undefined as void);
  updateRef.current = () => {
    setBand((current) => {
      const next = measureBand();
      return sameBand(current, next) ? current : next;
    });
  };

  useLayoutEffect(() => {
    let targets: readonly Element[] = [];
    let frame = 0;
    let rebindTimer = 0;
    const local = new MutationObserver(schedule);
    const resize = new ResizeObserver(schedule);

    function schedule() {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        updateRef.current();
      });
    }

    function bind() {
      rebindTimer = 0;
      const next = [
        document.querySelector(TITLE_BAR),
        document.querySelector(PLUGIN_OVERLAYS),
      ].filter((element): element is Element => element !== null);
      if (
        next.length === targets.length &&
        next.every((element, index) => element === targets[index])
      ) {
        return;
      }
      targets = next;
      local.disconnect();
      resize.disconnect();
      for (const element of targets) {
        local.observe(element, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["class", "style", "hidden"],
        });
        resize.observe(element);
      }
      schedule();
    }

    const structure = new MutationObserver(() => {
      if (!rebindTimer) rebindTimer = window.setTimeout(bind, 250);
    });
    structure.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", schedule);
    bind();
    schedule();

    return () => {
      structure.disconnect();
      local.disconnect();
      resize.disconnect();
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
      if (rebindTimer) window.clearTimeout(rebindTimer);
    };
  }, []);

  return band;
}
