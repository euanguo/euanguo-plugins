import * as React from "react";

const PERSISTENT_DRAWER_CLOSE_RATIO = 0.25;
const PERSISTENT_DRAWER_CLOSE_VELOCITY_PX_PER_SEC = 450;

type PersistentDrawerDrag = {
  pointerId: number;
  startY: number;
  lastY: number;
  lastTimeMs: number;
  velocityY: number;
  height: number;
};

interface UsePersistentDrawerDragArgs {
  open: boolean;
  panelRef: React.RefObject<HTMLDivElement | null>;
  backdropRef: React.RefObject<HTMLDivElement | null>;
  transition: string;
  backdropTransition: string;
  requestClose: () => void;
}

export function usePersistentDrawerDrag({
  open,
  panelRef,
  backdropRef,
  transition,
  backdropTransition,
  requestClose,
}: UsePersistentDrawerDragArgs) {
  const dragRef = React.useRef<PersistentDrawerDrag | null>(null);

  const setDragPosition = React.useCallback(
    (offsetY: number, height: number, animate: boolean) => {
      const panel = panelRef.current;
      const backdrop = backdropRef.current;
      if (panel === null || backdrop === null) {
        return;
      }
      panel.style.transition = animate ? transition : "none";
      panel.style.transform = `translate3d(0, ${offsetY}px, 0)`;
      backdrop.style.transition = animate ? backdropTransition : "none";
      backdrop.style.opacity = String(
        Math.max(0, Math.min(1, 1 - offsetY / height)),
      );
    },
    [backdropTransition, transition],
  );

  const handleDragStart = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!open || event.button !== 0) {
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      const nowMs = Date.now();
      const height = Math.max(panelRef.current?.clientHeight ?? 0, 1);
      dragRef.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        lastY: event.clientY,
        lastTimeMs: nowMs,
        velocityY: 0,
        height,
      };
      setDragPosition(0, height, false);
      event.preventDefault();
    },
    [open, setDragPosition],
  );

  const handleDragMove = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (drag === null || drag.pointerId !== event.pointerId) {
        return;
      }
      const nowMs = Date.now();
      const elapsedMs = nowMs - drag.lastTimeMs;
      if (elapsedMs > 0) {
        drag.velocityY = ((event.clientY - drag.lastY) / elapsedMs) * 1000;
        drag.lastY = event.clientY;
        drag.lastTimeMs = nowMs;
      }
      setDragPosition(
        Math.max(0, event.clientY - drag.startY),
        drag.height,
        false,
      );
      event.preventDefault();
    },
    [setDragPosition],
  );

  const finishDrag = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
      const drag = dragRef.current;
      if (drag === null || drag.pointerId !== event.pointerId) {
        return;
      }
      dragRef.current = null;
      const offsetY = Math.max(0, event.clientY - drag.startY);
      const shouldClose =
        !cancelled &&
        (offsetY >= drag.height * PERSISTENT_DRAWER_CLOSE_RATIO ||
          drag.velocityY >= PERSISTENT_DRAWER_CLOSE_VELOCITY_PX_PER_SEC);
      if (shouldClose) {
        setDragPosition(drag.height, drag.height, true);
        requestClose();
      } else {
        setDragPosition(0, drag.height, true);
      }
      event.preventDefault();
    },
    [requestClose, setDragPosition],
  );

  return {
    handleDragStart,
    handleDragMove,
    finishDrag,
  };
}
