import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const read = (relative: string) =>
  readFile(new URL(`../${relative}`, import.meta.url), "utf8");

const app = await read("app.tsx");
const chip = await read("components/inbox/children-chip.tsx");
const parentChip = await read("components/inbox/parent-chip.tsx");
const menu = await read("components/ui/menu.tsx");

/**
 * The two chips in bb's thread header, and the one thing each of them is for.
 *
 * The header action slot is a row, not a slot for one component: the collector
 * keeps an array and asks only that each id be unique. So the pair coexists, and
 * the direction that was missing for so long — into a thread's children, from
 * inside the thread itself — is the one this covers.
 */
describe("the thread header's chips", () => {
  it("registers both directions, side by side", () => {
    assert.match(
      app,
      /experimental_threadHeaderAction\(\{\s*id: "parent",\s*title: "Parent thread",\s*component: ParentChip,/,
    );
    assert.match(
      app,
      /experimental_threadHeaderAction\(\{\s*id: "children",\s*title: "Child threads",\s*component: ChildrenChip,/,
    );
  });

  it("draws each chip in the other's idiom", () => {
    // Two chips in one header row that did not match would read as two features.
    for (const source of [chip, parentChip]) {
      assert.match(source, /flex h-7 max-w-full items-center gap-1\.5 rounded-full border border-border text-2xs text-muted-foreground/);
      assert.match(source, /hover:bg-accent hover:text-foreground/);
      assert.match(source, /isCompactViewport \? "px-1\.5" : "px-2"/);
      assert.match(source, /isCompactViewport \? null :/);
    }
  });

  it("opens the panel this sidebar already has, not a second one", () => {
    // The chip's predecessor drew its own `rounded-xl` panel and its own rows.
    // That is exactly the drift the row menus were rebuilt to remove, so this
    // one uses the shared surface and the menu module grows a row shape for it.
    assert.match(chip, /import \{ Menu, MenuLabel, MenuRow \} from "@\/components\/ui\/menu"/);
    assert.match(chip, /<Menu\b/);
    assert.match(chip, /<MenuRow key=\{child\.id\} onSelect=\{\(\) => actions\.open\(child\.id\)\}>/);
    assert.doesNotMatch(chip, /rounded-xl|<ul|<li|role="menu"/);
    // The row shape it needed is the module's, so the next caller does not reach
    // past it to the primitive.
    assert.match(menu, /export function MenuRow\(/);
    assert.match(menu, /className=\{cn\(MENU_ITEM_CLASS, "items-start gap-2", className\)\}/);
  });

  it("says a child is waiting in the palette's own words", () => {
    // A state, so it reads from the palette rather than from a hue — the same
    // rule the rows follow, and the same word the sidebar uses.
    assert.match(chip, /child\.hasPendingInteraction/);
    assert.match(chip, /familyStatusPresentation\("needs-you"\)/);
    assert.match(chip, /style=\{needsYou \? \{ color: familyStatusColor\(status\) \} : undefined\}/);
    assert.doesNotMatch(chip, /bg-amber-|text-amber-|bg-red-|text-red-/);
  });

  it("lists what a child is, where it is, and how it is doing", () => {
    assert.match(chip, /<DiscCluster threads=\{children\} max=\{MAX_DISCS\} \/>/);
    assert.match(chip, /<Disc thread=\{child\} \/>/);
    assert.match(chip, /threadDisplayTitle\(child\)/);
    assert.match(chip, /child\.originKind \?\? "thread"/);
    assert.match(chip, /<StatusGlyph\s+indicator=\{child\.indicator\}\s+label=\{child\.indicatorLabel\}/);
  });

  it("draws nothing for a thread with no children", () => {
    // The header is bb's, and a chip that says nothing is worse than no chip.
    assert.match(chip, /if \(children\.length === 0\) return null;/);
  });
});
