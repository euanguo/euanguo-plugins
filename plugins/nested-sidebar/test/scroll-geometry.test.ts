import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const read = (relative: string) =>
  readFile(new URL(`../${relative}`, import.meta.url), "utf8");

const inbox = await read("components/inbox/thread-inbox.tsx");
const threadCard = await read("components/inbox/thread-card.tsx");
const familyStatus = await read("components/inbox/family-status.tsx");
const rowMetadata = await read("components/inbox/row-metadata.tsx");
const providerGlyph = await read("components/inbox/provider-glyph.tsx");
const scrollOwner = await read("hooks/use-sidebar-scroll-owner.ts");

/**
 * The scroll area's geometry, pinned.
 *
 * A scrollbar is laid out between the padding box and the border, so it is taken
 * out of the content box rather than out of the padding. Every row is full width,
 * so one appearing used to narrow each row by the bar's width and push everything
 * pinned to a row's right edge sideways. The lane is reserved instead, and the
 * area clips horizontally so that a decoration poking past a row cannot grow a
 * horizontal bar either.
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
      scrollOwner,
      /closest<HTMLElement>\(SIDEBAR_CONTENT_SELECTOR\)/,
    );
    assert.match(scrollOwner, /host\.style\.overflow = "hidden"/);
    assert.match(scrollOwner, /host\.style\.scrollbarGutter = "auto"/);
    assert.match(inbox, /useSidebarScrollOwner\(inboxRef\)/);
  });

  it("restores the host wrapper when Nest unmounts", () => {
    assert.match(scrollOwner, /previousOverflow/);
    assert.match(scrollOwner, /previousScrollbarGutter/);
    assert.match(scrollOwner, /return \(\) => \{/);
  });

  it("reserves the scrollbar's lane on the tree's scroll area", () => {
    const line = scrollLine();
    assert.match(line, /\[scrollbar-gutter:stable\]/);
    assert.match(line, /overflow-y-auto/);
  });

  it("clips horizontally so no decoration can grow a horizontal bar", () => {
    // `overflow-y: auto` computes `overflow-x` to `auto`, which turns any
    // single pixel of horizontal overflow into a scrollbar that then eats its
    // own strip of height.
    assert.match(scrollLine(), /overflow-x-clip/);
  });

  it("keeps a token gap beside the lane instead of a roomy inset", () => {
    const line = scrollLine();
    assert.match(line, /pr-0\.5 /);
    assert.doesNotMatch(line, /pr-3/);
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

  // Both occupants of the box, so the flat fallback cannot arrive without the lane
  // and the clip the tree is documented to have.
  it("gives the flat recovery list the same box as the tree", () => {
    const uses = inbox.match(/className=\{TREE_SCROLL_CLASS\}/g) ?? [];
    assert.equal(uses.length, 2);
    assert.match(inbox, /<FlatThreadFallback/);
  });
});
