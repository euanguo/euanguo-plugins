import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const inbox = await readFile(
  new URL("../components/inbox/thread-inbox.tsx", import.meta.url),
  "utf8",
);
// The gates and the four reorder paths live in the hook now; the inbox wires
// them to rows.
const reorder = await readFile(
  new URL("../hooks/use-reorder.ts", import.meta.url),
  "utf8",
);
const group = await readFile(
  new URL("../components/inbox/project-node.tsx", import.meta.url),
  "utf8",
);
const rows = await readFile(
  new URL("../components/inbox/tree-rows.tsx", import.meta.url),
  "utf8",
);
const card = await readFile(
  new URL("../components/inbox/thread-card.tsx", import.meta.url),
  "utf8",
);
const familyStatus = await readFile(
  new URL("../components/inbox/family-status.tsx", import.meta.url),
  "utf8",
);

describe("family reorder UI contract", () => {
  it("applies the project and family order before filter and search", () => {
    const projects = inbox.indexOf("orderProjectGroups(");
    const families = inbox.indexOf("families: orderFamilies(");
    const filter = inbox.indexOf("filterProjectThreadGroups(");
    const search = inbox.indexOf("searchProjectThreadGroups(", filter);
    assert.ok(projects >= 0);
    assert.ok(families > projects);
    assert.ok(filter > families);
    assert.ok(search > filter);
  });

  it("disables reorder for selection, filters, and host search", () => {
    assert.match(reorder, /selectionMode\s*\? "Exit bulk selection/);
    assert.match(inbox, /filterPreset !== "all"/);
    assert.match(reorder, /searching\s*\? "Clear search/);
    assert.match(inbox, /reorderEnabled,/);
    assert.match(inbox, /onReorder: reorderByDrag,/);
  });

  it("only drags when the mode reads the manual order", () => {
    assert.match(reorder, /viewPreferences\.threadSort !== "manual"/);
    assert.match(reorder, /viewPreferences\.projectSort !== "manual"/);
    assert.match(inbox, /projectReorderDisabledReason/);
  });

  it("scopes a project order to its group and refuses a cross-group drop", () => {
    assert.match(reorder, /projectOrderScope\(/);
    assert.match(reorder, /orderedProjectIds\(/);
    assert.match(reorder, /Projects can only be reordered within their group/);
    assert.match(reorder, /reorderProjects\(/);
    assert.match(reorder, /reorderFamilies\(/);
  });

  it("wires explicit drag and keyboard controls with announcements", () => {
    assert.match(group, /application\/x-nest-family/);
    assert.match(group, /application\/x-nest-project/);
    assert.match(group, /data-nest-project/);
    assert.match(group, /draggable=\{projectReorder.enabled\}/);
    assert.match(rows, /sourceProjectId: dragged\.projectId/);
    assert.match(group, /sourceProjectId: dragged\.projectId/);
    assert.match(rows, /targetProjectId: projectId/);
    assert.match(card, /draggable=\{reorderEnabled\}/);
    assert.match(familyStatus, /aria-keyshortcuts=/);
    assert.doesNotMatch(card, /ReorderHandle|group\/reorder/);
    assert.doesNotMatch(group, /name="Drag|name="Grip|name="Move/);
    assert.match(inbox, /aria-live="polite"/);
    assert.match(reorder, /Thread families cannot move between projects/);
    assert.match(reorder, /Pinned and unpinned thread families cannot cross/);
  });

  /**
   * A drag that lands on the row it started from is the click that drifted into
   * one: the browser starts a drag after about five pixels and then produces no
   * click, so a press with a little wobble opened nothing. Both aggregate
   * levels read that drop as the click it was, instead of announcing that the
   * order had not changed.
   */
  it("reads a drop onto its own row as the click it was", () => {
    assert.match(reorder, /input\.sourceProjectId === input\.targetProjectId/);
    assert.match(reorder, /input\.sourceKey === input\.targetKey/);
    assert.match(reorder, /viewStateApi\.setWorkspaceExpanded\(/);
    assert.match(reorder, /viewStateApi\.setProjectCollapsed\(/);
  });

  /**
   * All three levels are dropped only under the manual order. A drag writes the
   * *drawn* order as the arrangement, so under a lens it would both lose the
   * user's arrangement and leave a row that looks draggable while a click that
   * wobbled is spent on a reorder. The worktree level was the one missed when
   * its lens was added.
   */
  it("gates every level's drag on its own manual order", () => {
    assert.match(reorder, /viewPreferences\.projectSort !== "manual"/);
    assert.match(reorder, /viewPreferences\.threadSort !== "manual"/);
    assert.match(reorder, /viewPreferences\.worktreeSort !== "manual"/);
    assert.match(reorder, /Choose the Manual worktree sort to drag worktrees\./);
  });

  it("keeps navigation split props and bulk selection overlays independent", () => {
    assert.match(card, /\.\.\.splitProps/);
    assert.match(card, /data-nest-selection-target/);
    assert.match(card, /onReorderDragStart/);
    assert.match(card, /onToggleSelected/);
  });
});
