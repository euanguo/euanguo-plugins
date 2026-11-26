/**
 * Centralized z-index stacking ladder for every portaled Harbor overlay.
 *
 * All floating surfaces portal to `document.body`, so z-index ordering is
 * resolved in the root stacking context. Never hardcode ad-hoc `z-50` values
 * inside individual overlay components.
 *
 * Menus and everything above them start at 80. BB's own `@bb-ui` primitives
 * portal context menus at `z-[70]`, and the host's sticky sidebar tiers sit at
 * 50-60 with `isolation: isolate`. A z-index on the menu content alone is not
 * enough: Radix portals it inside a `position: fixed` wrapper whose z-index is
 * `auto`, and that wrapper is the node competing with the sidebar. Its matching
 * rule lives in `components/inbox/sidebar-geometry.css`. Hover previews stay
 * below that band by design.
 */
export const OVERLAY_Z_VALUES = {
  hover: 40,
  menu: 80,
  submenu: 85,
  dialog: 90,
  dialogPopover: 100,
} as const;

export const Z_HOVER = "z-[40]";
export const Z_MENU = "z-[80]";
export const Z_SUBMENU = "z-[85]";
export const Z_DIALOG = "z-[90]";
export const Z_DIALOG_POPOVER = "z-[100]";
