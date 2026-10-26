import { useLayoutEffect, type RefObject } from "react";

export const SIDEBAR_CONTENT_SELECTOR = '[data-sidebar="content"]';

/**
 * Let Nest's tree own scrolling inside bb's thread-list slot.
 *
 * bb wraps every thread list in a scrolling SidebarContent with a stable
 * scrollbar gutter. Nest adds its own stable-gutter scrollport below the pinned
 * rows and scope strip, so leaving both enabled reserves two lanes at the right
 * edge. The outer wrapper has nothing to scroll once Nest fills it; temporarily
 * disabling that wrapper's scrollport leaves the inner lane as the only one.
 */
export function useSidebarScrollOwner(
  anchorRef: RefObject<HTMLElement | null>,
) {
  useLayoutEffect(() => {
    const host =
      anchorRef.current?.closest<HTMLElement>(SIDEBAR_CONTENT_SELECTOR) ?? null;
    if (host === null) return;

    const previousOverflow = host.style.overflow;
    const previousScrollbarGutter = host.style.scrollbarGutter;

    host.style.overflow = "hidden";
    host.style.scrollbarGutter = "auto";
    host.dataset.nestScrollOwner = "";

    return () => {
      host.style.overflow = previousOverflow;
      host.style.scrollbarGutter = previousScrollbarGutter;
      delete host.dataset.nestScrollOwner;
    };
  }, [anchorRef]);
}
