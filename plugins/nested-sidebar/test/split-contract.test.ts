import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const card = await readFile(
  new URL("../components/inbox/thread-card.tsx", import.meta.url),
  "utf8",
);
const menuItems = await readFile(
  new URL("../components/inbox/thread-menu-items.tsx", import.meta.url),
  "utf8",
);
const contextMenu = await readFile(
  new URL("../components/inbox/row-context-menu.tsx", import.meta.url),
  "utf8",
);
const slimRow = await readFile(
  new URL("../components/inbox/slim-row.tsx", import.meta.url),
  "utf8",
);
const familyStatus = await readFile(
  new URL("../components/inbox/family-status.tsx", import.meta.url),
  "utf8",
);

/**
 * `useSidebarThreadSplit` answers two questions and they are not the same one.
 *
 * `isAvailable` is the permission: false on a compact viewport, when the user
 * has turned splits off, and for a thread the host does not know. `layout` is
 * the state: where this thread sits right now, or null when it is not in a
 * pane. Only `isAvailable` may gate an affordance; `layout` may paint a tint.
 * Reading `layout` for both offered "Open in split" on viewports that cannot
 * split and withheld it from threads that could.
 */
describe("split availability contract", () => {
  it("destructures isAvailable alongside layout at every split call site", () => {
    const callSites = card.match(
      /const \{ splitProps, isAvailable, layout \} = useSidebarThreadSplit\(/g,
    );
    // Root card and child row. A third call site must be added here too.
    assert.equal(callSites?.length, 2);
  });

  it("gates every split affordance on isAvailable, never on layout", () => {
    assert.doesNotMatch(card, /splitAvailable=\{layout/);
    const gated = card.match(/splitAvailable=\{isAvailable\}/g);
    // One menu per row — the family's card and a child row — because every row
    // opens the same context menu rather than a dropdown of its own.
    assert.equal(gated?.length, 2);
  });

  it("keeps the pane tint reading layout, which is a different question", () => {
    assert.match(card, /!rootIsActive && layout !== null/);
    assert.match(card, /!isActive && layout !== null/);
  });

  it("still spreads splitProps onto each row's anchor", () => {
    const spreads = card.match(/\.\.\.splitProps/g);
    assert.equal(spreads?.length, 2);
  });

  it("drops the open-in-split item when splits are unavailable", () => {
    // The gate has to survive the hand-off: a boolean that arrives and is
    // ignored would look correct at the call site and do nothing. The one menu
    // surface draws the items it is handed, so the gate belongs to the list.
    assert.match(menuItems, /if \(splitAvailable\)/);
    assert.match(menuItems, /splitAvailable = false/);
    // And the surface itself keeps no opinion, so the gate cannot drift into
    // two places that disagree.
    assert.doesNotMatch(contextMenu, /splitAvailable/);
    assert.match(card, /splitAvailable=\{isAvailable\}/);
  });
});

/**
 * A thread row is two drag sources at once: bb's split gesture, which engages
 * once the pointer leaves the sidebar, and Nest's own reorder, which is an HTML5
 * drag. They coexist because they are grabbed in different places rather than
 * because one yields to the other — and that is easy to break by accident, since
 * making the whole row draggable reads like a simplification.
 */
describe("one row, two drags", () => {
  it("puts the split gesture on the anchor and lets the row's content pass through", () => {
    assert.match(card, /\{\.\.\.splitProps\}/);
    // The title and the metadata are `pointer-events-none`, so a press on them
    // reaches the anchor underneath and starts bb's gesture.
    assert.match(card, /"pointer-events-none relative min-w-0 flex-1"/);
    assert.match(card, /className="absolute inset-0 cursor-pointer/);
  });

  it("keeps the reorder handle above the anchor, so it does not steal the gesture", () => {
    assert.match(card, /<FamilyStatusIcon/);
    assert.match(card, /draggable=\{reorderEnabled\}/);
    // Above the full-bleed anchor: a press on the icon is a press on the icon.
    // The handle is the shared status component, so the rule lives with it.
    assert.match(familyStatus, /relative z-10 inline-flex/);
  });

  it("never spreads splitProps onto the reorder handle", () => {
    // One `splitProps` per anchor, and the handle is not an anchor. A spread
    // here would put both gestures on one element, which is the conflict this
    // layout exists to avoid.
    const handle = card.slice(card.indexOf("<FamilyStatusIcon"));
    assert.doesNotMatch(
      handle.slice(0, handle.indexOf("/>")) ,
      /splitProps/,
    );
  });

  /**
   * The shelves were the one place a thread could not be dragged out to a pane.
   * A parked thread is still a thread: it opens on modifier-click, so it should
   * drag the same way.
   */
  it("makes a parked row a split source too", () => {
    assert.match(slimRow, /useSidebarThreadSplit\(thread\.id\)/);
    assert.match(slimRow, /\{\.\.\.splitProps\}/);
    assert.match(slimRow, /!isActive && layout !== null/);
  });
});