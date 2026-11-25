import * as React from "react";
import { createPortal } from "react-dom";

import {
  blurActiveKeyboardInputWithin,
} from "../overlay-trigger.js";
import { usePortalScopeProps } from "../../../lib/ui/portal-scope.js";
import { cn } from "../../../lib/ui/utils.js";
import { usePersistentOverlayFocus } from "./focus-trap.js";
import { usePersistentDrawerDrag } from "./drawer-drag.js";
import {
  resetDrawerKeyboardStyles,
  useDrawerKeyboardInset,
} from "./keyboard-inset.js";

const RESPONSIVE_DRAWER_REALIZE_FALLBACK_MS = 120;

interface ResponsiveDrawerShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  closeOnBackdropClick?: boolean;
  onAfterCloseAutoFocus?: () => void;
  srLabel?: string;
  labelledBy?: string;
  describedBy?: string;
  contentClassName?: string;
  onContentAnimationEnd?: (open: boolean) => void;
  children: React.ReactNode;
}

export function useResponsiveDrawerRealization({
  open,
  enabled = true,
}: {
  open: boolean;
  enabled?: boolean;
}): { isContentRealized: boolean; realizeContent: () => void } {
  const [isContentRealized, setIsContentRealized] = React.useState(false);
  const realizeContent = React.useCallback(
    () => setIsContentRealized(true),
    [],
  );

  React.useEffect(() => {
    if (!enabled || !open || isContentRealized) {
      return;
    }

    let firstFrame: number | null = null;
    let secondFrame: number | null = null;
    firstFrame = window.requestAnimationFrame(() => {
      firstFrame = null;
      secondFrame = window.requestAnimationFrame(() => {
        secondFrame = null;
        realizeContent();
      });
    });
    const fallback = window.setTimeout(
      realizeContent,
      RESPONSIVE_DRAWER_REALIZE_FALLBACK_MS,
    );

    return () => {
      if (firstFrame !== null) {
        window.cancelAnimationFrame(firstFrame);
      }
      if (secondFrame !== null) {
        window.cancelAnimationFrame(secondFrame);
      }
      window.clearTimeout(fallback);
    };
  }, [enabled, isContentRealized, open, realizeContent]);

  return {
    isContentRealized: enabled && isContentRealized,
    realizeContent,
  };
}

export function ResponsiveDrawerShell({
  open,
  onOpenChange,
  onAfterCloseAutoFocus,
  closeOnBackdropClick = true,
  srLabel,
  labelledBy,
  describedBy,
  contentClassName,
  onContentAnimationEnd,
  children,
}: ResponsiveDrawerShellProps) {
  const { isContentRealized } = useResponsiveDrawerRealization({ open });

  if (!open && !isContentRealized) {
    return null;
  }

  return (
    <PersistentResponsiveDrawerShell
      open={open}
      onOpenChange={onOpenChange}
      onAfterCloseAutoFocus={onAfterCloseAutoFocus}
      closeOnBackdropClick={closeOnBackdropClick}
      srLabel={srLabel}
      labelledBy={labelledBy}
      describedBy={describedBy}
      contentClassName={contentClassName}
      onContentAnimationEnd={onContentAnimationEnd}
    >
      {isContentRealized ? (
        children
      ) : (
        <div
          aria-hidden="true"
          className="min-h-32"
          data-responsive-drawer-placeholder=""
        />
      )}
    </PersistentResponsiveDrawerShell>
  );
}

interface PersistentResponsiveDrawerShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  closeOnBackdropClick?: boolean;
  onAfterCloseAutoFocus?: () => void;
  srLabel?: string;
  labelledBy?: string;
  describedBy?: string;
  contentClassName?: string;
  motionDurationMs?: number;
  onContentAnimationEnd?: (open: boolean) => void;
  children: React.ReactNode;
}

const PERSISTENT_DRAWER_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";

export function PersistentResponsiveDrawerShell({
  open,
  onOpenChange,
  onAfterCloseAutoFocus,
  closeOnBackdropClick = true,
  srLabel,
  labelledBy,
  describedBy,
  contentClassName,
  motionDurationMs = 220,
  onContentAnimationEnd,
  children,
}: PersistentResponsiveDrawerShellProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const backdropRef = React.useRef<HTMLDivElement>(null);
  const settledStateRef = React.useRef<boolean | null>(null);
  const labelId = React.useId();
  const portalScopeProps = usePortalScopeProps();
  const transition = `transform ${motionDurationMs}ms ${PERSISTENT_DRAWER_EASING}`;
  const backdropTransition = `opacity ${motionDurationMs}ms ${PERSISTENT_DRAWER_EASING}`;
  const onOpenChangeRef = React.useRef(onOpenChange);
  React.useLayoutEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);
  const requestClose = React.useCallback(() => {
    blurActiveKeyboardInputWithin(panelRef.current);
    resetDrawerKeyboardStyles(panelRef.current);
    onOpenChangeRef.current(false);
  }, []);
  const prepareCloseAutoFocus = React.useCallback(() => {
    blurActiveKeyboardInputWithin(panelRef.current);
    resetDrawerKeyboardStyles(panelRef.current);
  }, []);

  usePersistentOverlayFocus({
    onAfterCloseAutoFocus,
    onBeforeCloseAutoFocus: prepareCloseAutoFocus,
    open,
    panelRef,
    requestClose,
  });

  useDrawerKeyboardInset(panelRef, open);

  const reportSettled = React.useCallback(
    (settledOpen: boolean) => {
      if (settledStateRef.current === settledOpen) {
        return;
      }
      settledStateRef.current = settledOpen;
      onContentAnimationEnd?.(settledOpen);
    },
    [onContentAnimationEnd],
  );

  React.useEffect(() => {
    settledStateRef.current = null;
    const timeout = window.setTimeout(
      () => reportSettled(open),
      motionDurationMs + 50,
    );
    return () => window.clearTimeout(timeout);
  }, [motionDurationMs, open, reportSettled]);

  const { handleDragStart, handleDragMove, finishDrag } =
    usePersistentDrawerDrag({
      open,
      panelRef,
      backdropRef,
      transition,
      backdropTransition,
      requestClose,
    });

  const portalTarget = typeof document === "undefined" ? null : document.body;
  if (portalTarget === null) {
    return null;
  }

  return createPortal(
    <>
      <div
        ref={backdropRef}
        {...portalScopeProps}
        aria-hidden="true"
        data-persistent-drawer-backdrop=""
        data-state={open ? "open" : "closed"}
        className="fixed inset-0 z-50 bg-black/40"
        style={{
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: backdropTransition,
        }}
        onClick={closeOnBackdropClick ? requestClose : undefined}
        onTouchMove={(event) => event.preventDefault()}
      />
      <div
        ref={panelRef}
        {...portalScopeProps}
        aria-hidden={!open}
        aria-labelledby={
          labelledBy ?? (srLabel === undefined ? undefined : labelId)
        }
        aria-describedby={describedBy}
        aria-modal={open || undefined}
        data-bb-portaled-overlay=""
        data-persistent-drawer-content=""
        data-state={open ? "open" : "closed"}
        inert={!open}
        role="dialog"
        tabIndex={-1}
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 mt-24 flex max-h-[calc(92dvh-var(--bb-drawer-keyboard-inset,0px))] flex-col rounded-t-xl border bg-background outline-none",
          contentClassName,
        )}
        style={{
          transform: open ? "translate3d(0, 0, 0)" : "translate3d(0, 100%, 0)",
          transition,
          willChange: open ? "transform" : undefined,
        }}
        onTransitionEnd={(event) => {
          if (
            event.currentTarget === event.target &&
            event.propertyName === "transform"
          ) {
            reportSettled(open);
          }
        }}
      >
        <div
          data-persistent-drawer-handle=""
          className="mx-auto flex h-8 w-16 shrink-0 touch-none cursor-grab items-center justify-center active:cursor-grabbing"
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={(event) => finishDrag(event, false)}
          onPointerCancel={(event) => finishDrag(event, true)}
        >
          <div className="h-1 w-10 rounded-full bg-muted-foreground/20" />
        </div>
        {srLabel === undefined ? null : (
          <h2 id={labelId} className="sr-only">
            {srLabel}
          </h2>
        )}
        {children}
      </div>
    </>,
    portalTarget,
  );
}
