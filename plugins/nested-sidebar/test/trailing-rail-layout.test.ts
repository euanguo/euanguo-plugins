import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const read = (relative: string) =>
  readFile(new URL(`../${relative}`, import.meta.url), "utf8");

const rowActions = await read("components/inbox/row-actions.tsx");
const threadCard = await read("components/inbox/thread-card.tsx");
const slimRow = await read("components/inbox/slim-row.tsx");
const statusSlot = await read("components/inbox/status-slot.tsx");

describe("trailing rail layout", () => {
  it("does not reserve a generic 64px rail for optional actions", () => {
    assert.doesNotMatch(rowActions, /w-16/);
    assert.doesNotMatch(threadCard, /data-nest-root-metadata=""[\s\S]*min-w-16/);
    assert.doesNotMatch(statusSlot, /STATUS_SLOT_CLASS = "[^"]*w-16/);
    assert.doesNotMatch(slimRow, /STATUS_SLOT_CLASS/);
  });

  it("keeps hover-only menus out of the resting row flow", () => {
    assert.doesNotMatch(rowActions, /ROW_MENU_OVERLAY_CLASS/);
    assert.doesNotMatch(threadCard, /ROW_MENU_OVERLAY_CLASS/);
    assert.match(threadCard, /showRootRail \? \(/);
  });

  it("keeps the trailing cluster free of anything hover changes", () => {
    // The cluster used to end with the hover menu's trigger, which is why the
    // menu had to come first: a right-aligned cluster would shift every glyph to
    // its left the moment it appeared. The menu is a right-click now, and the two
    // things the pointer still changes sit at the head of the cluster — the age
    // for the park buttons, and the pin on a thread that is not pinned — so
    // nothing already drawn moves, and only the width the title has changes.
    assert.doesNotMatch(threadCard, /<ThreadMenu|<RowMenuTrigger/);
    assert.ok(
      threadCard.includes(
        '"pointer-events-none relative min-w-0 flex-1",',
      ),
    );
    assert.match(threadCard, /relative z-10 ml-auto flex shrink-0 items-center/);
  });

  it("ends the branch line with the cluster, so the title owns the width", () => {
    // bb's card ends its branch line with the status, the PR, the children chip
    // and the provider mark. Nest used to keep them in a second column beside
    // the two lines, which spent width on a vertical run of glyphs and squeezed
    // the title into what was left.
    const detailRow = threadCard.slice(
      threadCard.indexOf('data-nest-root-detail-row=""'),
      threadCard.indexOf("</div>", threadCard.indexOf("<RootTrailingCluster", threadCard.indexOf('data-nest-root-detail-row=""'))),
    );
    assert.match(detailRow, /<ThreadLocation thread=\{thread\} \/>/);
    assert.match(detailRow, /<RootTrailingCluster interactive=\{!selectionMode\}>/);
    // The title line carries the cluster only when there is no branch line, and
    // that is one derived fact rather than two expressions that could disagree.
    assert.match(
      threadCard,
      /const branchLineRenders =\n\s+preferences\.rowLayout === "two-line" && showsLocation;/,
    );
    assert.match(threadCard, /const clusterRidesTheTitle = !branchLineRenders;/);
    assert.doesNotMatch(threadCard, /flex-col gap-0\.5/);
  });
});
