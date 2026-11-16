import { ROW_LAYOUT_CHANGED_EVENT } from "../domain/row-pointer.ts";

export function publishRowLayoutChanged(): void {
  if (typeof document === "undefined") return;
  document.dispatchEvent(new Event(ROW_LAYOUT_CHANGED_EVENT));
}
