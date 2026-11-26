import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  OVERLAY_Z_VALUES,
  Z_DIALOG,
  Z_DIALOG_POPOVER,
  Z_HOVER,
  Z_MENU,
  Z_SUBMENU,
} from "../components/ui/overlay-layers.ts";
import {
  bindDismissOnScrollAndDrag,
  createOverlayCoordinator,
  ensureWindowBlurDismiss,
} from "../lib/ui/overlay-coordinator.ts";

function parseZClass(token: string): number {
  const bracketed = /^z-\[(\d+)\]$/u.exec(token);
  if (bracketed !== null && bracketed[1] !== undefined) {
    return Number.parseInt(bracketed[1], 10);
  }
  const plain = /^z-(\d+)$/u.exec(token);
  if (plain !== null && plain[1] !== undefined) {
    return Number.parseInt(plain[1], 10);
  }
  assert.fail(`Unexpected Tailwind z-index token: ${token}`);
}

describe("overlayCoordinator", () => {
  it("keeps at most one hover preview open and dismisses cleanly", () => {
    const coordinator = createOverlayCoordinator();
    assert.equal(coordinator.canOpenHover(), true);

    assert.equal(coordinator.openHover("row-1"), true);
    assert.equal(coordinator.getSnapshot().activeHoverId, "row-1");

    assert.equal(coordinator.openHover("row-2"), true);
    assert.equal(coordinator.getSnapshot().activeHoverId, "row-2");

    coordinator.closeHover("row-1");
    assert.equal(coordinator.getSnapshot().activeHoverId, "row-2");

    coordinator.closeHover("row-2");
    assert.equal(coordinator.getSnapshot().activeHoverId, null);

    assert.equal(coordinator.openHover("row-3"), true);
    coordinator.dismissHover();
    assert.equal(coordinator.getSnapshot().activeHoverId, null);
  });

  it("closes active hover when a menu opens and blocks hover until menu closes", () => {
    const coordinator = createOverlayCoordinator();
    assert.equal(coordinator.openHover("hover-a"), true);

    coordinator.openMenu("menu-1");
    assert.equal(coordinator.getSnapshot().activeHoverId, null);
    assert.equal(coordinator.getSnapshot().activeMenuId, "menu-1");
    assert.equal(coordinator.canOpenHover(), false);
    assert.equal(coordinator.openHover("hover-b"), false);
    assert.equal(coordinator.getSnapshot().activeHoverId, null);

    coordinator.openMenu("menu-2");
    assert.equal(coordinator.getSnapshot().activeMenuId, "menu-2");

    coordinator.closeMenu("menu-1");
    assert.equal(coordinator.getSnapshot().activeMenuId, "menu-2");
    assert.equal(coordinator.canOpenHover(), false);

    coordinator.closeMenu("menu-2");
    assert.equal(coordinator.getSnapshot().activeMenuId, null);
    assert.equal(coordinator.canOpenHover(), true);
    assert.equal(coordinator.openHover("hover-b"), true);
    assert.equal(coordinator.getSnapshot().activeHoverId, "hover-b");
  });

  it("closes active hover and menu on dialog open and respects nested dialog counts", () => {
    const coordinator = createOverlayCoordinator();
    assert.equal(coordinator.openHover("hover-1"), true);
    coordinator.openMenu("menu-1");

    coordinator.openDialog();
    assert.equal(coordinator.getSnapshot().activeHoverId, null);
    assert.equal(coordinator.getSnapshot().activeMenuId, null);
    assert.equal(coordinator.getSnapshot().activeDialogCount, 1);
    assert.equal(coordinator.canOpenHover(), false);
    assert.equal(coordinator.openHover("hover-2"), false);

    coordinator.openDialog();
    assert.equal(coordinator.getSnapshot().activeDialogCount, 2);

    coordinator.closeDialog();
    assert.equal(coordinator.getSnapshot().activeDialogCount, 1);
    assert.equal(coordinator.canOpenHover(), false);
    assert.equal(coordinator.openHover("hover-2"), false);

    coordinator.closeDialog();
    assert.equal(coordinator.getSnapshot().activeDialogCount, 0);
    assert.equal(coordinator.canOpenHover(), true);
    assert.equal(coordinator.openHover("hover-2"), true);

    coordinator.closeDialog();
    assert.equal(coordinator.getSnapshot().activeDialogCount, 0);
  });

  it("dismisses hover on scroll, dragstart, and pointerdown until unbound", () => {
    const coordinator = createOverlayCoordinator();
    const target = new EventTarget();
    const unbind = bindDismissOnScrollAndDrag(target, coordinator);

    assert.equal(coordinator.openHover("row-1"), true);
    target.dispatchEvent(new Event("scroll"));
    assert.equal(coordinator.getSnapshot().activeHoverId, null);

    assert.equal(coordinator.openHover("row-1"), true);
    target.dispatchEvent(new Event("dragstart"));
    assert.equal(coordinator.getSnapshot().activeHoverId, null);

    assert.equal(coordinator.openHover("row-1"), true);
    target.dispatchEvent(new Event("pointerdown"));
    assert.equal(coordinator.getSnapshot().activeHoverId, null);

    unbind();
    assert.equal(coordinator.openHover("row-1"), true);
    target.dispatchEvent(new Event("scroll"));
    target.dispatchEvent(new Event("dragstart"));
    assert.equal(coordinator.getSnapshot().activeHoverId, "row-1");

    const noopUnbind = bindDismissOnScrollAndDrag(null, coordinator);
    noopUnbind();
  });

  it("binds window blur dismissal idempotently", () => {
    const coordinator = createOverlayCoordinator();
    const fakeWindow = new EventTarget();
    let listenerCount = 0;
    const originalAdd = fakeWindow.addEventListener.bind(fakeWindow);
    fakeWindow.addEventListener = (
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) => {
      if (type === "blur") listenerCount += 1;
      originalAdd(type, listener, options);
    };

    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", {
      value: fakeWindow,
      configurable: true,
    });
    try {
      ensureWindowBlurDismiss(coordinator);
      ensureWindowBlurDismiss(coordinator);
      assert.equal(listenerCount, 1);

      assert.equal(coordinator.openHover("row-blur"), true);
      fakeWindow.dispatchEvent(new Event("blur"));
      assert.equal(coordinator.getSnapshot().activeHoverId, null);
    } finally {
      if (descriptor === undefined) {
        Reflect.deleteProperty(globalThis, "window");
      } else {
        Object.defineProperty(globalThis, "window", descriptor);
      }
    }
  });

  it("notifies subscribers only when overlay state changes", () => {
    const coordinator = createOverlayCoordinator();
    let notifications = 0;
    const unsubscribe = coordinator.subscribe(() => {
      notifications += 1;
    });

    coordinator.closeDialog();
    coordinator.dismissHover();
    assert.equal(notifications, 0);

    coordinator.openHover("row-1");
    coordinator.openHover("row-1");
    assert.equal(notifications, 1);

    coordinator.openMenu("menu-1");
    assert.equal(notifications, 2);

    unsubscribe();
    coordinator.closeMenu("menu-1");
    assert.equal(notifications, 2);
  });
});

describe("overlay z-index stacking ladder", () => {
  it("aligns dialogs with BB's z-50 host baseline and keeps Harbor menus above host chrome", () => {
    assert.equal(
      OVERLAY_Z_VALUES.dialog,
      50,
      "Harbor modals must match BB's z-50 dialog rung so host composer popovers and nested dialogs stack above them",
    );
    assert.ok(
      OVERLAY_Z_VALUES.menu > 70,
      "Harbor menus must stay above BB's portaled z-[70] baseline",
    );
    assert.ok(OVERLAY_Z_VALUES.hover < OVERLAY_Z_VALUES.dialog);
    assert.ok(OVERLAY_Z_VALUES.dialog < OVERLAY_Z_VALUES.menu);
    assert.ok(OVERLAY_Z_VALUES.menu < OVERLAY_Z_VALUES.submenu);
    assert.ok(OVERLAY_Z_VALUES.submenu < OVERLAY_Z_VALUES.dialogPopover);

    const zHover = parseZClass(Z_HOVER);
    const zDialog = parseZClass(Z_DIALOG);
    const zMenu = parseZClass(Z_MENU);
    const zSubmenu = parseZClass(Z_SUBMENU);
    const zDialogPopover = parseZClass(Z_DIALOG_POPOVER);

    assert.equal(zHover, OVERLAY_Z_VALUES.hover);
    assert.equal(zDialog, OVERLAY_Z_VALUES.dialog);
    assert.equal(zMenu, OVERLAY_Z_VALUES.menu);
    assert.equal(zSubmenu, OVERLAY_Z_VALUES.submenu);
    assert.equal(zDialogPopover, OVERLAY_Z_VALUES.dialogPopover);
    assert.ok(zHover < zDialog);
    assert.ok(zDialog < zMenu);
    assert.ok(zMenu < zSubmenu);
    assert.ok(zSubmenu < zDialogPopover);
  });

  it("scopes popper wrapper z-index rules to Harbor overlays in sync with OVERLAY_Z_VALUES", () => {
    const cssPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../components/inbox/sidebar-geometry.css",
    );
    const css = readFileSync(cssPath, "utf8");

    assert.equal(
      css.includes("[data-radix-menu-content]"),
      false,
      "Wrapper rules must not target unscoped Radix menus owned by the BB host",
    );
    assert.match(
      css,
      new RegExp(
        `\\[data-radix-popper-content-wrapper\\]:has\\(\\[data-harbor-overlay="menu"\\]\\)\\s*\\{\\s*z-index:\\s*${OVERLAY_Z_VALUES.menu}\\s*!important;\\s*\\}`,
      ),
    );
    assert.match(
      css,
      new RegExp(
        `\\[data-radix-popper-content-wrapper\\]:has\\(\\[data-harbor-overlay="submenu"\\]\\)\\s*\\{\\s*z-index:\\s*${OVERLAY_Z_VALUES.submenu}\\s*!important;\\s*\\}`,
      ),
    );
    assert.match(
      css,
      new RegExp(
        `\\[data-radix-popper-content-wrapper\\]:has\\(\\[data-harbor-overlay="dialog-popover"\\]\\)\\s*\\{\\s*z-index:\\s*${OVERLAY_Z_VALUES.dialogPopover}\\s*!important;\\s*\\}`,
      ),
    );
  });
});
