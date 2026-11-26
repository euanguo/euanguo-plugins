/**
 * Centralized z-index stacking ladder for every portaled Harbor overlay.
 *
 * All floating surfaces portal to `document.body`, so z-index ordering is
 * resolved in the root stacking context. Never hardcode ad-hoc z-index values
 * inside individual overlay components.
 *
 * Dialogs stay on BB's native `z-50` rung (`@bb-ui/dialog` paints both
 * `DialogOverlay` and `DialogContent` at `z-50`). Keeping modals at `50` lets
 * host-owned surfaces rendered inside a modal — such as `NewThreadComposer`'s
 * model, project, environment, and branch popovers or a nested host dialog —
 * stack cleanly above the modal by portal DOM order instead of being buried
 * behind it. `overlayCoordinator.openDialog()` dismisses active sidebar menus
 * before a modal opens, and hover previews stay below dialogs at `40`.
 *
 * Menus, submenus, and Harbor's own dialog popovers sit above BB's `z-[70]`
 * context-menu baseline and the host's sticky sidebar tiers (50-60 with
 * `isolation: isolate`). Matching Harbor-scoped wrapper rules live in
 * `components/inbox/sidebar-geometry.css` so Radix's `position: fixed` popper
 * wrapper always carries the same rung even when its content is `position: static`.
 */
export const OVERLAY_Z_VALUES = {
  hover: 40,
  dialog: 50,
  menu: 80,
  submenu: 85,
  dialogPopover: 100,
} as const;

export const Z_HOVER = "z-[40]";
export const Z_DIALOG = "z-50";
export const Z_MENU = "z-[80]";
export const Z_SUBMENU = "z-[85]";
export const Z_DIALOG_POPOVER = "z-[100]";
