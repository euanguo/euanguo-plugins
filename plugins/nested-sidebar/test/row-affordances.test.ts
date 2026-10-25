import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const read = (relative: string) =>
  readFile(new URL(`../components/inbox/${relative}`, import.meta.url), "utf8");

const groupRow = await read("group-section.tsx");
const projectRow = await read("project-node.tsx");
const treeRows = await read("tree-rows.tsx");
const card = await read("thread-card.tsx");
const controls = await read("row-controls.tsx");
const slimRow = await read("slim-row.tsx");
const threadMenu = await read("thread-menu-items.tsx");
const rowMenu = await read("row-context-menu.tsx");
const rowActions = await read("row-actions.tsx");
const tabs = await read("group-tabs.tsx");
const groupManager = await read("group-manager-dialog.tsx");

/**
 * The four levels have to behave the same way, because they are one tree. These
 * pin the shared shape — one menu, opened by right-clicking the row, with one
 * frequent action keeping its own button outside it.
 *
 * This replaces a hover-revealed `⋯` trigger per level, which is a deliberate
 * reversal: four triggers meant four hover states, four places for the menu to
 * drift, and a row whose width changed as the pointer crossed it.
 */
describe("row affordances across the four levels", () => {
  it("opens the same menu from every level, and only by right-click", () => {
    // The thread rows go through `ThreadRowMenu`, which is the same surface with
    // the thread items already wired; the other three build their items inline.
    for (const [level, source, expected] of [
      ["group", groupRow, /<RowMenu\b/],
      ["project", projectRow, /<RowMenu\b/],
      ["worktree", treeRows, /<RowMenu\b/],
      ["thread", card, /<ThreadRowMenu\b/],
    ] as const) {
      assert.match(source, expected, `${level} opens the shared menu`);
      assert.doesNotMatch(
        source,
        /<RowMenuTrigger|<Menu\b/,
        `${level} has no trigger button of its own`,
      );
    }
    // The parked shelf is a thread row too, and it opens the same menu.
    assert.match(slimRow, /<ThreadRowMenu\b/);
    // One renderer for every item in the sidebar.
    assert.match(rowMenu, /export function RowMenu\(/);
    assert.match(rowMenu, /export type RowMenuItem = RowMenuAction \| RowMenuSubmenu;/);
    assert.doesNotMatch(rowActions, /RowMenuTrigger/);
  });

  it("keeps an arrow on every row that opens", () => {
    // The menu trigger used to double as the disclosure — a chevron at rest, the
    // three dots under the pointer. Removing the trigger removed the only thing
    // that said a row was open, so the arrow is its own control now, and it is
    // never swapped for anything.
    assert.match(rowActions, /export function RowDisclosure\(/);
    assert.match(rowActions, /name="ChevronDown"/);
    assert.match(rowActions, /expanded && "rotate-180"/);
    for (const [level, source] of [
      ["group", groupRow],
      ["project", projectRow],
      ["worktree", treeRows],
    ] as const) {
      assert.match(source, /<RowDisclosure/, `${level} shows its arrow`);
      assert.match(source, /aria-controls=\{listId\}/, `${level} points at its list`);
      assert.match(source, /controls=\{listId\}/, `${level} wires the arrow to its list`);
    }
  });

  it("positions every row that hosts a full-bleed target", () => {
    // A row's click target is `absolute inset-0`, and an absolutely positioned
    // element resolves against the nearest *positioned* ancestor rather than its
    // parent. A row that is not itself positioned therefore stretches its own
    // target across whatever ancestor above it happens to be positioned — and
    // then takes the pointer for rows it does not belong to: a hover anywhere in
    // that area opened another row's card, and a click toggled that row.
    const sites: Array<[string, RegExp, string]> = [
      [card, /"group\/root @container relative flex/, "thread card"],
      [card, /"group\/child @container relative flex/, "child row"],
      [treeRows, /"group\/ws relative flex/, "worktree row"],
      [projectRow, /"group\/project relative flex/, "project row"],
      [slimRow, /"group\/slim relative flex/, "parked row"],
    ];
    for (const [source, pattern, level] of sites) {
      assert.match(source, /absolute inset-0/, `${level} has a full-bleed target`);
      assert.match(source, pattern, `${level} is positioned`);
    }
  });

  it("draws the worktree row as a title line and a branch line", () => {
    // The same shape a thread card has, one level up: the alias owns its line,
    // and the branch line carries the branch's icon and name on the left with
    // the row's controls at its right end.
    const stackedBranchLine = treeRows.slice(
      treeRows.indexOf("The branch line, the shape a thread card's branch line"),
      treeRows.indexOf("{workspaceRowActions}", treeRows.indexOf("The branch line, the shape a thread card's branch line")),
    );
    assert.match(stackedBranchLine, /node\.ref\.kind === "git-worktree" \? "FolderGit" : "GitBranch"/);
    assert.match(stackedBranchLine, /\{rowLabel\.detail\}/);
    assert.match(stackedBranchLine, /font-mono text-2xs text-muted-foreground\/80/);
    // The controls ride the last line, whichever line that is.
    assert.equal(
      treeRows.match(/\{workspaceRowActions\}/g)?.length,
      2,
      "the cluster rides the branch line and the single line",
    );
    assert.match(treeRows, /className="pointer-events-auto"/);
    // A row with a branch line is a worktree, and the branch icon says so, so the
    // kind icon is not repeated above it.
    assert.doesNotMatch(
      stackedBranchLine,
      /project-checkout" \? "Folder"/,
    );
  });

  it("marks a worktree branch the same way at both levels", () => {
    // bb-sidebar's rule: a worktree branch is a folder that is a branch, a plain
    // branch is just a branch.
    assert.match(controls, /name=\{isWorktree \? "FolderGit" : "GitBranch"\}/);
    assert.match(controls, /displayKind === "managed-worktree" \|\| displayKind === "unmanaged-worktree"/);
    assert.match(treeRows, /"FolderGit" : "GitBranch"/);
  });

  it("describes every level's actions as the same kind of thing", () => {
    // A project item and a thread item are both `RowMenuItem`s: same key, same
    // label, same icon, same divider rule.
    for (const [level, source] of [
      ["group", groupRow],
      ["project", projectRow],
      ["worktree", treeRows],
    ] as const) {
      assert.match(source, /const items: RowMenuItem\[\] = \[/, `${level} builds items`);
      assert.match(source, /key: "/, `${level} keys its items`);
      assert.match(source, /icon: "/, `${level} icons its items`);
    }
    // The thread items are described once and drawn by the same surface, so a
    // family, a child row and a parked row cannot disagree.
    assert.match(threadMenu, /export type ThreadMenuItem = RowMenuItem;/);
    assert.match(threadMenu, /export function ThreadRowMenu\(/);
    assert.match(threadMenu, /<RowMenu\b/);
  });

  it("drops the divider the same way everywhere, without a bare separator", () => {
    // `separatorBefore` is the whole vocabulary; nobody hand-rolls a separator.
    for (const [level, source] of [
      ["group", groupRow],
      ["project", projectRow],
      ["worktree", treeRows],
    ] as const) {
      assert.doesNotMatch(source, /<MenuSeparator/, `${level} has no bare separator`);
    }
  });

  it("keeps the frequent new-thread button on project and worktree rows", () => {
    // Both levels start work in a known place, so both keep the button outside
    // the menu; the menu carries the rarer "new worktree" decision.
    for (const source of [projectRow, treeRows]) {
      assert.match(source, /<RowActionButton/);
      assert.match(source, /icon="Add"/);
    }
    assert.match(projectRow, /label: "New worktree…"/);
    assert.match(treeRows, /label: "New thread here"/);
  });

  /**
   * The personal project has no checkout, and the worktree environment provider
   * requires one (`requires: { gitCheckout: true }`) — so a worktree there is
   * not a thing that can be created, and offering the item opens a composer
   * with no worktree in it.
   */
  it("keeps the worktree entry off the project that has no checkout", () => {
    assert.match(projectRow, /isPersonal=\{node\.project\.isPersonal\}/);
    assert.match(
      projectRow,
      /isPersonal=\{node\.project\.isPersonal\}[\s\S]*?!isPersonal[\s\S]*?label: "New worktree…"/,
    );
  });

  it("keeps rename reachable from every level", () => {
    assert.match(projectRow, /label: "Rename…"/);
    // A worktree renames the environment, which is what its alias is.
    assert.match(treeRows, /"Rename worktree…"/);
    // The group row menu mirrors bb's own section menu, which offers rename
    // and remove next to the disclosure toggle.
    assert.match(groupRow, /label: "Rename…"/);
    assert.match(groupRow, /label: "Remove group"/);
    assert.match(card, /useThreadMenuActions|ThreadRowMenu/);
    // Renaming is one dialog at every level, on the operator's decision: a
    // thread renames through `ThreadRenameDialog`, the way a project and a group
    // already do. An inline field lived here briefly and was removed for that
    // reason, so this pins the dialog rather than merely permitting it.
    assert.match(threadMenu, /<ThreadRenameDialog/);
  });

  it("keeps group editing available from the row and the manager", () => {
    assert.doesNotMatch(groupRow, /GroupNameField/);
    assert.match(groupManager, /GroupNameEditor/);
  });

  it("gives the thread menu bb's full set, on the one surface", () => {
    // bb's own thread menu offers open-in-split, copy link, read, pin, rename,
    // archive, and delete. The id copy is additive; the rest must be present.
    for (const label of [
      "Open in split",
      "Copy thread link",
      "Copy thread ID",
      // The ellipsis promises a dialog, and renaming opens one — the same
      // dialog a project and a group rename through.
      "Rename…",
      "Archive",
      "Delete…",
    ]) {
      assert.match(threadMenu, new RegExp(`label: "${label}"`), label);
    }
    assert.match(threadMenu, /Mark read/);
    assert.match(threadMenu, /Unpin/);
  });

  it("tags each group tab with its own status so the strip can dot it", () => {
    assert.match(tabs, /statusKind: FamilyStatusKind \| null/);
    assert.match(tabs, /familyStatusPresentation\(tab\.statusKind\)/);
    assert.doesNotMatch(tabs, /tab\.count/);
  });

  it("opens a hover card from aggregate levels, not thread rows", () => {
    for (const source of [groupRow, projectRow, treeRows]) {
      assert.match(source, /<InfoCard/);
    }
    assert.doesNotMatch(card, /<InfoCard/);
    assert.match(projectRow, /<InfoCard trigger=\{projectRow\}/);
  });

  it("keeps the provider at the trailing edge and inserts actions in flow", () => {
    assert.match(card, /data-nest-root-metadata=""[\s\S]*className="flex h-4/);
    assert.doesNotMatch(card, /ROW_MENU_OVERLAY_CLASS/);
    assert.match(card, /showRootRail \? \(/);
    // Hover state survives in exactly one place now: the root card, where the
    // park buttons replace the age while the pointer is on it. They stay mounted
    // so a row moving under a stationary pointer can be clicked immediately.
    assert.match(
      card,
      /rootParkActionsAvailable\s*=\s*canPark && !selectionMode && showRowDetails/,
    );
    assert.match(card, /data-nest-park-actions=""/);
    // Hidden means hidden: `opacity-0` alone left the pair clickable, so a tap
    // on an apparently empty row wrote a snooze. The reveal state now owns both
    // halves of that, and a coarse pointer reveals them unconditionally because
    // there is no hover there to do it.
    assert.match(
      card,
      /rowActionsRevealed \? "opacity-100" : "pointer-events-none opacity-0"/,
    );
    assert.match(rowActions, /revealed: coarse \|\| pointer \|\| focus/);    assert.equal(card.match(/useRowReveal<HTMLDivElement>\(\)/g)?.length, 1);
    for (const [level, source] of [
      ["group", groupRow],
      ["project", projectRow],
      ["worktree", treeRows],
    ] as const) {
      assert.doesNotMatch(source, /useRowReveal/, `${level} has no hover state`);
    }
  });

  it("renders icon previews directly instead of blank deferred placeholders", () => {
    assert.match(groupManager, /<IconPicker/);
    assert.doesNotMatch(groupManager, /GroupIcon name=\{icon\} className="size-4" ariaHidden defer/);
    assert.match(groupManager, /<PopoverContent/);
    assert.ok(groupManager.includes('aria-label={label + " picker"}'));
  });
});
