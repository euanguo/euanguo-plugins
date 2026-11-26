export const TAB_CLASS =
  "group/tab relative flex h-7 max-w-56 min-w-0 shrink-0 items-center gap-1 rounded-md px-2 text-xs [@media(pointer:coarse)]:h-9";
export const ACTIVE_TAB_CLASS = "text-foreground bg-sidebar-accent";
export const CLOSE_CLASS =
  "relative z-10 inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-subtle-foreground opacity-0 hover:bg-state-hover hover:text-foreground group-hover/tab:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:size-6 [@media(pointer:coarse)]:opacity-100";

/**
 * Invisible grid companion that supplies an automatic minimum width capped at
 * 6.5rem (104px text + ~56px pill chrome = ~160px pill floor) for long titles,
 * while letting shorter titles stay at their natural fit-content width.
 */
export const TAB_FLOOR_SIZER_CLASS =
  "invisible col-start-1 row-start-1 h-0 max-w-26 overflow-clip whitespace-nowrap";

/**
 * Returns the flex/min-width override classes for a workspace tab pill.
 *
 * Pinned tabs stay unshrunk; a single unpinned scrolling tab may shrink cleanly
 * to 0; multiple scrolling tabs shrink down to a content-bounded readable floor.
 */
export function workspaceTabSizingClass({
  isPinned,
  singleScrollingTab,
}: {
  isPinned: boolean;
  singleScrollingTab: boolean;
}): string {
  if (isPinned) return "";
  return singleScrollingTab ? "shrink" : "shrink min-w-auto";
}
