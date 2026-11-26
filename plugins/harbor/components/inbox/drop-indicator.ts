const activeTargets = new Map<string, HTMLElement>();
const activeDetachers = new Map<string, () => void>();

/** Clears the active drag insertion indicator for `channel`. */
export function clearDropIndicator(channel: string): void {
  activeDetachers.get(channel)?.();
  activeDetachers.delete(channel);
  const current = activeTargets.get(channel);
  if (current !== undefined) {
    current.removeAttribute("data-harbor-drop-position");
    current.style.boxShadow = "";
    activeTargets.delete(channel);
  }
}

/**
 * Shows a before/after primary edge line on a drag-over target element and
 * automatically clears it when the pointer leaves or the drag ends.
 */
export function setDropIndicator(
  channel: string,
  element: HTMLElement,
  position: "before" | "after",
): void {
  const existing = activeTargets.get(channel);
  if (existing !== element) {
    clearDropIndicator(channel);
    activeTargets.set(channel, element);
    const onDragLeave = (leaveEvent: globalThis.DragEvent) => {
      if (
        leaveEvent.relatedTarget instanceof Node &&
        element.contains(leaveEvent.relatedTarget)
      ) {
        return;
      }
      clearDropIndicator(channel);
    };
    const onFinish = () => clearDropIndicator(channel);
    element.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onFinish, { once: true });
    window.addEventListener("dragend", onFinish, { once: true });
    activeDetachers.set(channel, () => {
      element.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onFinish);
      window.removeEventListener("dragend", onFinish);
    });
  }
  element.setAttribute("data-harbor-drop-position", position);
  element.style.boxShadow =
    position === "before"
      ? "inset 0 2px 0 0 var(--primary)"
      : "inset 0 -2px 0 0 var(--primary)";
}
