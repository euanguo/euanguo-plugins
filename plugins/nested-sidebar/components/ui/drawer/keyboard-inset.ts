import * as React from "react";

const DRAWER_KEYBOARD_INSET_PROPERTY = "--bb-drawer-keyboard-inset";
const DRAWER_KEYBOARD_MIN_OVERLAP_PX = 80;

export function resetDrawerKeyboardStyles(
  drawerElement: HTMLElement | null,
): void {
  if (drawerElement === null) return;

  drawerElement.style.height = "";
  drawerElement.style.bottom = "";
  drawerElement.style.removeProperty(DRAWER_KEYBOARD_INSET_PROPERTY);
}

export function measureDrawerKeyboardOverlap({
  layoutViewportHeight,
  visualViewportHeight,
  visualViewportOffsetTop,
}: {
  layoutViewportHeight: number;
  visualViewportHeight: number;
  visualViewportOffsetTop: number;
}): number {
  const overlap = Math.round(
    layoutViewportHeight - (visualViewportHeight + visualViewportOffsetTop),
  );
  return overlap >= DRAWER_KEYBOARD_MIN_OVERLAP_PX ? overlap : 0;
}

export function useDrawerKeyboardInset(
  panelRef: React.RefObject<HTMLElement | null>,
  open: boolean,
): void {
  React.useEffect(() => {
    const panel = panelRef.current;
    const visualViewport = window.visualViewport;
    if (panel === null || !open || !visualViewport) return;

    let animationFrame: number | null = null;
    const applyInset = () => {
      animationFrame = null;
      if (visualViewport.scale !== 1) {
        resetDrawerKeyboardStyles(panel);
        return;
      }
      const overlap = measureDrawerKeyboardOverlap({
        layoutViewportHeight: panel.ownerDocument.documentElement.clientHeight,
        visualViewportHeight: visualViewport.height,
        visualViewportOffsetTop: visualViewport.offsetTop,
      });
      if (overlap === 0) {
        panel.style.bottom = "";
        panel.style.removeProperty(DRAWER_KEYBOARD_INSET_PROPERTY);
        return;
      }
      panel.style.bottom = `${overlap}px`;
      panel.style.setProperty(DRAWER_KEYBOARD_INSET_PROPERTY, `${overlap}px`);
    };
    const scheduleUpdate = () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      animationFrame = window.requestAnimationFrame(applyInset);
    };

    applyInset();
    visualViewport.addEventListener("resize", scheduleUpdate);
    visualViewport.addEventListener("scroll", scheduleUpdate);

    return () => {
      visualViewport.removeEventListener("resize", scheduleUpdate);
      visualViewport.removeEventListener("scroll", scheduleUpdate);
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      resetDrawerKeyboardStyles(panel);
    };
  }, [open, panelRef]);
}
