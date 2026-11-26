import { useCallback, useSyncExternalStore } from "react";

export interface OverlayState {
  readonly activeHoverId: string | null;
  readonly activeMenuId: string | null;
  readonly activeDialogCount: number;
}

export interface OverlayCoordinator {
  getSnapshot: () => OverlayState;
  subscribe: (listener: () => void) => () => void;
  canOpenHover: () => boolean;
  openHover: (id: string) => boolean;
  closeHover: (id?: string) => void;
  dismissHover: () => void;
  openMenu: (id: string) => void;
  closeMenu: (id?: string) => void;
  openDialog: () => void;
  closeDialog: () => void;
  reset: () => void;
}

const INITIAL_STATE: OverlayState = {
  activeHoverId: null,
  activeMenuId: null,
  activeDialogCount: 0,
};

/**
 * Create a lightweight external store enforcing mutual exclusion across
 * hover previews, menus/popovers, and modal dialogs.
 */
export function createOverlayCoordinator(): OverlayCoordinator {
  let state: OverlayState = INITIAL_STATE;
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  const canOpenHover = (): boolean =>
    state.activeMenuId === null && state.activeDialogCount === 0;

  const openHover = (id: string): boolean => {
    if (!canOpenHover()) return false;
    if (state.activeHoverId === id) return true;
    state = { ...state, activeHoverId: id };
    notify();
    return true;
  };

  const closeHover = (id?: string): void => {
    if (state.activeHoverId === null) return;
    if (id !== undefined && state.activeHoverId !== id) return;
    state = { ...state, activeHoverId: null };
    notify();
  };

  const dismissHover = (): void => {
    closeHover();
  };

  const openMenu = (id: string): void => {
    if (state.activeMenuId === id && state.activeHoverId === null) return;
    state = {
      ...state,
      activeHoverId: null,
      activeMenuId: id,
    };
    notify();
  };

  const closeMenu = (id?: string): void => {
    if (state.activeMenuId === null) return;
    if (id !== undefined && state.activeMenuId !== id) return;
    state = { ...state, activeMenuId: null };
    notify();
  };

  const openDialog = (): void => {
    state = {
      activeHoverId: null,
      activeMenuId: null,
      activeDialogCount: state.activeDialogCount + 1,
    };
    notify();
  };

  const closeDialog = (): void => {
    if (state.activeDialogCount === 0) return;
    state = {
      ...state,
      activeDialogCount: Math.max(0, state.activeDialogCount - 1),
    };
    notify();
  };

  const reset = (): void => {
    if (
      state.activeHoverId === null &&
      state.activeMenuId === null &&
      state.activeDialogCount === 0
    ) {
      return;
    }
    state = INITIAL_STATE;
    notify();
  };

  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    canOpenHover,
    openHover,
    closeHover,
    dismissHover,
    openMenu,
    closeMenu,
    openDialog,
    closeDialog,
    reset,
  };
}

export const overlayCoordinator = createOverlayCoordinator();

let windowBlurBound = false;

/**
 * Ensure the global window `blur` listener is registered at most once so
 * floating hover previews dismiss whenever the window loses focus.
 */
export function ensureWindowBlurDismiss(
  coordinator: Pick<OverlayCoordinator, "dismissHover"> = overlayCoordinator,
): void {
  if (windowBlurBound || typeof window === "undefined") return;
  if (typeof window.addEventListener !== "function") return;
  windowBlurBound = true;
  window.addEventListener("blur", () => {
    coordinator.dismissHover();
  });
}

ensureWindowBlurDismiss();

export interface EventTargetLike {
  addEventListener: (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) => void;
  removeEventListener: (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ) => void;
}

/**
 * Dismiss active hover previews whenever the container scrolls, begins a drag,
 * or receives a pointer press. Returns an idempotent cleanup callback.
 */
export function bindDismissOnScrollAndDrag(
  element: EventTargetLike | null | undefined,
  coordinator: Pick<OverlayCoordinator, "dismissHover"> = overlayCoordinator,
): () => void {
  if (element === null || element === undefined) {
    return () => {};
  }
  const onDismiss: EventListener = () => {
    coordinator.dismissHover();
  };
  const captureEvents = ["scroll", "dragstart", "pointerdown"] as const;
  for (const eventName of captureEvents) {
    element.addEventListener(eventName, onDismiss, {
      capture: true,
      passive: true,
    });
  }
  return () => {
    for (const eventName of captureEvents) {
      element.removeEventListener(eventName, onDismiss, { capture: true });
    }
  };
}

export function useIsHoverActive(id: string): boolean {
  const getSnapshot = useCallback(
    () => overlayCoordinator.getSnapshot().activeHoverId === id,
    [id],
  );
  return useSyncExternalStore(
    overlayCoordinator.subscribe,
    getSnapshot,
    () => false,
  );
}

export function useIsHoverSuppressed(): boolean {
  return useSyncExternalStore(
    overlayCoordinator.subscribe,
    () => !overlayCoordinator.canOpenHover(),
    () => false,
  );
}

export function useIsMenuActive(id: string): boolean {
  const getSnapshot = useCallback(
    () => overlayCoordinator.getSnapshot().activeMenuId === id,
    [id],
  );
  return useSyncExternalStore(
    overlayCoordinator.subscribe,
    getSnapshot,
    () => false,
  );
}

export function useIsDialogOpen(): boolean {
  return useSyncExternalStore(
    overlayCoordinator.subscribe,
    () => overlayCoordinator.getSnapshot().activeDialogCount > 0,
    () => false,
  );
}
