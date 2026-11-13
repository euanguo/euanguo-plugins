import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  readInboxModules,
  readThreadCardModules,
} from "./_sources.ts";

const read = (relative: string) =>
  readFile(new URL(`../${relative}`, import.meta.url), "utf8");

const inbox = await readInboxModules();
const threadCard = await readThreadCardModules();
const familyStatus = await read("components/inbox/family-status.tsx");
const rowMetadata = await read("components/inbox/row-metadata.tsx");
const providerGlyph = await read("components/inbox/provider-glyph.tsx");
const geometryCss = await read("components/inbox/sidebar-geometry.css");

/**
 * The scroll area's geometry, pinned.
 *
 * A scrollbar is laid out between the padding box and the border, so it is taken
 * out of the content box rather than out of the padding. Every row is full width,
 * so one appearing used to narrow each row by the bar's width and push everything
 * pinned to a row's right edge sideways. The bar is hidden instead: no lane to
 * reserve, no narrowing to happen, and the rows sit the same distance from either
 * edge because the padding is the only inset they have. The area clips
 * horizontally so that a decoration poking past a row cannot grow a horizontal
 * bar either.
 *
 * Read from the constant both occupants use — the tree, and bb's own list when
 * the user asks for it — because the contract is about the box, not about which
 * list happens to be in it. Verified in the running app: giving the fallback its
 * own literal is how it lost the gutter in the first place.
 */
const scrollLine = () => {
  const match = inbox.match(/const TREE_SCROLL_CLASS =\s*\n?\s*"([^"]*)"/);
  assert.ok(match, "the scroll area's class is still one constant");
  return match[1];
};

describe("sidebar scroll geometry", () => {
  it("turns off bb's outer gutter because the tree owns scrolling", () => {
    assert.match(
      geometryCss,
      /\[data-sidebar="content"\]:has\(\[data-nest-scroll\]\)/,
    );
    assert.match(geometryCss, /overflow: hidden/);
    assert.match(geometryCss, /scrollbar-gutter: auto/);
    assert.match(inbox, /data-nest-scroll=""/);
  });

  it("lets the host wrapper go back to scrolling bb's list on its own", () => {
    // A layout effect that re-hid the wrapper could be undone by a remount of
    // bb's sidebar shell, and the second lane would come back. The rule only
    // matches while the tree is mounted, so unmounting restores the wrapper
    // without anything having to run.
    assert.doesNotMatch(inbox, /scrollbarGutter =/);
    assert.doesNotMatch(inbox, /\.closest<HTMLElement>/);
  });

  it("hides the bar instead of reserving a lane for it", () => {
    // A lane — mirrored on both edges or not — costs the list more width than
    // the margin it is meant to be. Hidden, there is no lane to reserve and none
    // to appear, so the rows keep the scrollport's own 6px and never narrow.
    const line = scrollLine();
    assert.doesNotMatch(line, /scrollbar-gutter/);
    assert.match(geometryCss, /\[data-nest-scroll\] \{\s*scrollbar-width: none;/);
    assert.match(geometryCss, /\[data-nest-scroll\]::-webkit-scrollbar \{\s*display: none;/);
    assert.match(line, /overflow-y-auto/);
  });

  it("clips horizontally so no decoration can grow a horizontal bar", () => {
    // `overflow-y: auto` computes `overflow-x` to `auto`, which turns any
    // single pixel of horizontal overflow into a scrollbar that then eats its
    // own strip of height.
    assert.match(scrollLine(), /overflow-x-clip/);
  });

  it("pads the tree's two edges by the same amount", () => {
    const line = scrollLine();
    assert.match(line, /px-1\.5/);
    assert.doesNotMatch(line, /\bpl-/);
    assert.doesNotMatch(line, /\bpr-/);
  });

  it("keeps the chrome above the tree on the tree's line", () => {
    // The chrome is outside the scrollport and has no bar of its own, so the
    // same 6px is all it needs to put its rows and its tab strip on the column
    // the avatars sit on.
    assert.match(inbox, /const CHROME_EDGE_CLASS = "px-1\.5"/);
    assert.match(inbox, /CHROME_EDGE_CLASS/);
    assert.doesNotMatch(inbox, /pl-1\.5 pr-0\.5/);
  });

  it("bounds every sideways decoration by the row it hangs off", () => {
    for (const [name, source] of [
      ["thread card", threadCard],
      ["family status", familyStatus],
      ["pull request metadata", rowMetadata],
      ["provider glyph", providerGlyph],
    ] as const) {
      const tooltips = source.match(/role="tooltip"/g)?.length ?? 0;
      const bounded =
        source.match(/max-w-\[min\(\d+rem,calc\(100cqw-1rem\)\)\]/g)?.length ??
        0;
      assert.ok(tooltips > 0, `${name} still has tooltips`);
      assert.equal(bounded, tooltips, `${name} bounds each of its tooltips`);
    }
  });

  it("makes the rows that host them query containers", () => {
    // `100cqw` resolves against the nearest container; without one it falls
    // back to the viewport, which is why the rows carry the container.
    assert.match(threadCard, /group\/root @container relative flex/);
    assert.match(threadCard, /group\/child @container relative flex/);
  });

  // Every occupant of the box: the tree and the flat recovery list. The
  // feature view is drawn inside the tree's own panel rather than beside it, so
  // it cannot grow a scroll container of its own and scroll in a second place.
  it("gives the flat recovery list the same box as the tree", () => {
    const uses = inbox.match(/className=\{TREE_SCROLL_CLASS\}/g) ?? [];
    assert.equal(uses.length, 2);
    assert.match(inbox, /<FlatThreadFallback/);
  });
});
