import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const read = (relative: string) =>
  readFile(new URL(`../${relative}`, import.meta.url), "utf8");

const viewMenu = await read("components/inbox/view-menu.tsx");
const groupTabs = await read("components/inbox/group-tabs.tsx");
const inbox = await read("components/inbox/thread-inbox.tsx");
const app = await read("app.tsx");

describe("view menu contract", () => {
  it("exposes filtering and both orderings as submenus that report their value", () => {
    assert.match(viewMenu, /label="Filter"/);
    assert.match(viewMenu, /label="Sort projects"/);
    assert.match(viewMenu, /label="Sort threads"/);
    assert.match(viewMenu, /hint={filterLabel}/);
    assert.match(viewMenu, /hint={projectSortLabel}/);
    assert.match(viewMenu, /hint={threadSortLabel}/);
    assert.match(viewMenu, /MenuRadioGroup/);
  });

  it("marks the trigger when anything is off its default", () => {
    assert.match(viewMenu, /const active =/);
    // Every lens counts, not just the ones the menu opened with.
    for (const clause of [
      'filter !== "all"',
      'projectSort !== "manual"',
      'threadSort !== "manual"',
      'worktreeSort !== "manual"',
    ]) {
      assert.ok(viewMenu.includes(clause), clause);
    }
  });

  it("offers collapse-all and a reset back to the defaults", () => {
    assert.match(inbox, /const collapseAll =/);
    assert.match(inbox, /const resetView =/);
    assert.match(inbox, /viewPreferences\.setProjectSort\("manual"\)/);
    assert.match(inbox, /viewPreferences\.setThreadSort\("manual"\)/);
  });

  it("uses a focus fill instead of a ring on the strip's icon controls", () => {
    // A `:focus-visible` ring reads as a stray blue border on a 24px square,
    // and a dropdown trigger keeps that state after its menu closes.
    assert.doesNotMatch(viewMenu, /focus-visible:ring-1/);
    assert.match(viewMenu, /focus-visible:bg-sidebar-accent/);
    assert.match(groupTabs, /focus-visible:bg-sidebar-accent/);
    assert.match(inbox, /focus-visible:bg-sidebar-accent/);
  });

  it("routes display settings through a footer shortcut, not a second store", () => {
    assert.match(app, /sidebarFooterAction\(/);
    assert.match(app, /run: \(context\) => context\.openSettings\(\)/);
  });
});
