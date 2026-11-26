/**
 * Centralized z-index stacking ladder for every portaled Harbor overlay.
 *
 * All floating surfaces portal to `document.body`, so z-index ordering is
 * resolved in the root stacking context. Never hardcode ad-hoc `z-50` values
 * inside individual overlay components.
 */
export const OVERLAY_Z_VALUES = {
  hover: 40,
  menu: 50,
  submenu: 55,
  dialog: 60,
  dialogPopover: 70,
} as const;

export const Z_HOVER = "z-[40]";
export const Z_MENU = "z-[50]";
export const Z_SUBMENU = "z-[55]";
export const Z_DIALOG = "z-[60]";
export const Z_DIALOG_POPOVER = "z-[70]";
