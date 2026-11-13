/**
 * The sidebar's horizontal geometry, in one place.
 *
 * The column is padded by exactly one value: 6px on the tree's scrollport,
 * which the rows repeat inside themselves, so every avatar lands on the same
 * left line. The scrollbar does not add to it — the scrollport hides its bar
 * rather than reserving a lane it would then have to mirror on the other edge,
 * because a reserve that wide reads as a wider column rather than as a margin.
 *
 * Anything drawn above the tree is outside that scrollport, so it pads by the
 * same 6px and its rows join the same line.
 */
export const CHROME_EDGE_CLASS = "px-1.5";

export const EMPTY_STATE_CLASS =
  "px-2 py-6 text-center text-xs text-muted-foreground";

export const TREE_SCROLL_CLASS =
  "min-h-0 flex-1 overflow-y-auto overflow-x-clip px-1.5 pb-2";
