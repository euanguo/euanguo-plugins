import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import {
  TOGGLE_OFF_CLASS,
  TOGGLE_ON_CLASS,
} from "../components/inbox/control-styles.ts";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [viewMenu, featureSelector, inboxChrome, groupManager] = await Promise.all([
  read("components/inbox/view-menu.tsx"),
  read("components/inbox/feature-selector.tsx"),
  read("components/inbox/inbox-chrome.tsx"),
  read("components/inbox/group-manager-dialog.tsx"),
]);

/**
 * A control that is on must stay on under the pointer.
 *
 * The generic hover treatment is a neutral fill; applying it unconditionally
 * turned the blue "this is active" state off exactly when the user reached for
 * it. The on state keeps its tint and deepens it instead, and the off state is
 * the only one that goes neutral.
 */
describe("held-on controls keep their tint on hover", () => {
  it("deepens the on state rather than replacing it", () => {
    assert.match(TOGGLE_ON_CLASS, /bg-primary\/10/);
    assert.match(TOGGLE_ON_CLASS, /text-primary/);
    assert.match(TOGGLE_ON_CLASS, /hover:bg-primary\/15/);
    assert.match(TOGGLE_ON_CLASS, /hover:text-primary/);
    assert.match(TOGGLE_ON_CLASS, /focus-visible:bg-primary\/15/);
    assert.match(TOGGLE_ON_CLASS, /focus-visible:text-primary/);
    // The neutral hover must never appear in the on state.
    assert.doesNotMatch(TOGGLE_ON_CLASS, /hover:bg-sidebar-accent/);
    assert.doesNotMatch(TOGGLE_ON_CLASS, /hover:text-foreground/);
  });

  it("keeps the neutral treatment for the off state", () => {
    assert.match(TOGGLE_OFF_CLASS, /hover:bg-sidebar-accent/);
    assert.match(TOGGLE_OFF_CLASS, /hover:text-foreground/);
  });

  it("uses the split in every toggle that has an on state", () => {
    assert.match(viewMenu, /active \? TOGGLE_ON_CLASS : TOGGLE_OFF_CLASS/);
    assert.match(featureSelector, /allShown \? TOGGLE_OFF_CLASS : TOGGLE_ON_CLASS/);
    assert.match(inboxChrome, /selection\.active \? TOGGLE_ON_CLASS : TOGGLE_OFF_CLASS/);
  });

  it("keeps the selected icon's tint in the group dialog", () => {
    assert.match(groupManager, /value === icon[\s\S]{0,120}hover:bg-primary\/15/);
    assert.doesNotMatch(
      groupManager,
      /"hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",/,
      "the neutral hover is not unconditional",
    );
  });

  /**
   * The view menu keeps `:focus-visible` after its menu closes; a neutral focus
   * fill made a still-active trigger look off.
   */
  it("does not repaint a focused active trigger neutrally", () => {
    assert.doesNotMatch(
      viewMenu,
      /focus-visible:bg-sidebar-accent focus-visible:text-foreground/,
    );
  });
});
