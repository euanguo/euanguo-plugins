/**
 * Portaled content leaves the plugin mount. These attributes restore the
 * plugin style scope and mark the content as an interactive overlay.
 */
import { useLayoutEffect, useState } from "react";

declare const __BB_PLUGIN_ID__: string | undefined;

export function usePortalScopeProps(): {
  "data-bb-portaled-overlay": "";
  "data-bb-plugin-root": "";
  "data-bb-plugin"?: string;
} {
  const pluginId =
    typeof __BB_PLUGIN_ID__ === "string" ? __BB_PLUGIN_ID__ : undefined;
  return {
    "data-bb-portaled-overlay": "",
    "data-bb-plugin-root": "",
    ...(pluginId === undefined ? {} : { "data-bb-plugin": pluginId }),
  };
}

/**
 * Where a floating surface should portal to.
 *
 * Normally the document body — that is what lifts a menu out of the sidebar's
 * own stacking context, which is the whole reason these overlays are portaled
 * at all.
 *
 * A native `<dialog>` opened with `showModal()` breaks that, though: it paints
 * in the top layer, and nothing portaled to the body can appear above it however
 * high its z-index goes. Verified in Chromium — a body-level popover at the
 * maximum z-index still painted underneath the open dialog, while the same
 * popover inside the dialog's subtree painted on top. So while one of this
 * plugin's own dialogs is open, overlays portal *into* it: that puts them in the
 * top layer as well, which is the only thing that reliably wins. A `fixed`
 * element inside the dialog is still positioned against the viewport, so the
 * popover's own placement maths is unaffected.
 *
 * A layout effect rather than an effect so the move happens before the browser
 * paints; otherwise the first frame would show the overlay behind the dialog.
 */
export function useOverlayPortalContainer(): HTMLElement | undefined {
  const [container, setContainer] = useState<HTMLElement>();
  useLayoutEffect(() => {
    // React runs child layout effects before the Modal's own effect calls
    // showModal(), so the freshly-mounted dialog may not have its `open`
    // attribute yet. The mounted dialog is still the correct top-layer
    // container; waiting for `[open]` leaves the first (and often only)
    // Popover render portaled to body, underneath the native dialog.
    const dialog = document.querySelector<HTMLDialogElement>(
      "dialog[data-nest-modal]",
    );
    setContainer(dialog ?? undefined);
  }, []);
  return container;
}
