import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const read = (relative: string) =>
  readFile(new URL(`../${relative}`, import.meta.url), "utf8");

const modal = await read("components/ui/modal.tsx");
const repositories = await read("components/inbox/feature-repositories-dialog.tsx");
const create = await read("components/inbox/feature-create-dialog.tsx");
const picker = await read("components/inbox/repository-picker.tsx");

/**
 * The dialog's body scrolls vertically, and `overflow-y: auto` computes
 * `overflow-x` to `auto`. A member row used to be a single flex line: a long
 * branch name plus two nowrap buttons made it wider than the box, so a
 * horizontal bar appeared at the bottom and the actions on the right were cut
 * off. Pinned here rather than only in the layout: the same trap is already
 * pinned for the sidebar's own scroll area in `scroll-geometry.test.ts`.
 */
describe("the repositories dialog stays inside its box", () => {
  it("clips the body sideways unless its panels must escape", () => {
    assert.match(modal, /allowOverflow \? "overflow-visible" : "overflow-x-clip overflow-y-auto"/u);
  });

  it("keeps the member row one line with its actions together on the right", () => {
    assert.match(repositories, /flex min-w-0 items-center gap-2/u);
    assert.match(repositories, /flex shrink-0 items-center gap-1/u);
    // The branch is the only part that gives way; the actions never do.
    assert.match(repositories, /min-w-0 flex-1 font-mono/u);
    assert.doesNotMatch(repositories, /max-w-\[45%\]/u);
  });

  it("keeps the distinguishing tail of a long branch name", () => {
    assert.match(repositories, /from "@\/components\/ui\/truncate-start"/u);
    assert.match(repositories, /<TruncateStart/u);
  });

  it("lets the branch inputs shrink in both dialogs", () => {
    for (const [name, source] of [
      ["repositories dialog", repositories],
      ["create dialog", create],
    ] as const) {
      assert.ok(
        source.includes("grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"),
        `${name} bounds its branch rows`,
      );
      assert.doesNotMatch(source, /w-52 font-mono/u, `${name} has no rigid branch input`);
    }
  });

  it("keeps the picker's own list bounded too", () => {
    assert.match(picker, /grid min-w-0 flex-1/u);
    assert.match(picker, /max-h-64 overflow-y-auto/u);
  });
});
