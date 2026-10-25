/**
 * Remember where the pointer is when the row under it can change without a
 * pointer event.
 *
 * Removing a thread row moves the next row under a stationary pointer. The
 * browser does not promise a fresh `pointerenter` for that new hit target, so a
 * reveal state driven only by pointer events goes stale. The list publishes a
 * layout change after each DOM mutation; every row rechecks the remembered
 * point and reveals itself when it is now the hit target.
 */

export interface RowPointerPosition {
  readonly x: number;
  readonly y: number;
}

export const ROW_LAYOUT_CHANGED_EVENT = "nest:row-layout-changed";

let lastPointer: RowPointerPosition | null = null;

export function rememberRowPointer(position: RowPointerPosition): void {
  lastPointer = position;
}

export function lastRowPointer(): RowPointerPosition | null {
  return lastPointer;
}

export function publishRowLayoutChanged(): void {
  if (typeof document === "undefined") return;
  document.dispatchEvent(new Event(ROW_LAYOUT_CHANGED_EVENT));
}
