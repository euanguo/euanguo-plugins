import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const rootSource = await readFile(
  new URL("../components/inbox/thread-card.tsx", import.meta.url),
  "utf8",
);
const modelSource = await readFile(
  new URL("../hooks/use-thread-card-model.ts", import.meta.url),
  "utf8",
);
const childSource = await readFile(
  new URL("../components/inbox/thread-child-row.tsx", import.meta.url),
  "utf8",
);
const partsSource = await readFile(
  new URL("../components/inbox/thread-row-parts.tsx", import.meta.url),
  "utf8",
);
const controls = await readFile(
  new URL("../components/inbox/row-controls.tsx", import.meta.url),
  "utf8",
);
const familyStatusSource = await readFile(
  new URL("../components/inbox/family-status.tsx", import.meta.url),
  "utf8",
);

describe("compact root card contract", () => {
  it("lets metadata fall through while the full child summary is the disclosure control", () => {
    const trailing = partsSource.slice(
      partsSource.indexOf("export function RootTrailingCluster"),
      partsSource.indexOf("export function ChildThreadChip"),
    );
    const childChip = partsSource.slice(
      partsSource.indexOf("export function ChildThreadChip"),
    );

    assert.match(trailing, /"pointer-events-none/);
    assert.match(trailing, /\[&_button\]:pointer-events-auto/);
    assert.match(trailing, /\[&_a\]:pointer-events-auto/);
    assert.match(childChip, /return \(\s*<button/);
    assert.match(childChip, /data-nest-child-status=\{status\.kind\}/);
    assert.match(childChip, /aria-expanded=\{expanded\}/);
    assert.match(childChip, /pointer-events-auto/);
  });

  it("keeps zero-child and no-PR roots on the same two-row skeleton", () => {
    assert.match(rootSource, /data-nest-root-title-row/);
    assert.match(rootSource, /data-nest-root-detail-row/);
    assert.match(rootSource, /data-nest-root-time/);
    assert.match(rootSource, /data-nest-root-metadata/);
    assert.match(
      rootSource,
      /data-nest-root-metadata=""[\s\S]*className="flex h-4 min-w-0 items-center gap-1 whitespace-nowrap leading-none"/,
    );
    assert.match(rootSource, /relative flex min-w-0 items-center gap-x-1/);
    assert.match(rootSource, /rounded-md pl-1\.5 pr-2\.5/);
    // The skeleton is two rows by default and one row under the one-line
    // layout, so both must stay present and selectable at runtime.
    assert.match(rootSource, /min-h-5/);
    assert.match(rootSource, /min-h-10/);
    assert.match(rootSource, /preferences\.rowLayout === "one-line"/);
    assert.match(modelSource, /preferences\.rowLayout === "two-line"/);
    // One card, no box around it. The row is a tint that moves with hover and
    // with being open, the way bb's own list draws it; an outlined family box
    // on top of a row that also tints read as two nested panels.
    assert.match(
      rootSource,
      /rounded-md pl-1\.5 pr-2\.5 transition-colors duration-150 ease-out motion-reduce:transition-none/,
    );
    assert.doesNotMatch(rootSource, /rounded-xl border/);
    assert.doesNotMatch(rootSource, /bg-sidebar-accent\/35/);
    assert.doesNotMatch(rootSource, /Done/);
  });

  it("co-locates root PR and multiple-child controls in row two", () => {
    const metadataStart = rootSource.indexOf("data-nest-root-metadata");
    const pullRequestStart = rootSource.indexOf(
      "<PullRequestMetadata",
      metadataStart,
    );
    const disclosureStart = rootSource.indexOf(
      "childThreads.length > 0 &&",
      metadataStart,
    );

    assert.ok(metadataStart >= 0);
    assert.ok(pullRequestStart > metadataStart);
    assert.ok(disclosureStart > pullRequestStart);
  });

  it("looks up PR data only for the parent and never on child rows", () => {
    assert.equal(
      rootSource.match(/useSidebarThreadPullRequest\(thread\.id\)/g)
        ?.length,
      1,
    );
    assert.doesNotMatch(childSource, /useSidebarThreadPullRequest/);
    assert.doesNotMatch(childSource, /PullRequestMetadata/);
  });

  it("truncates long title and branch text without reserving hover actions", () => {
    // The title truncates at one size in both layouts, and the branch carries
    // its own size rather than inheriting the row's (which has none).
    //
    // `text-sm` is a deliberate reversal: the card used to hold every row at
    // `text-xs` to stay denser than bb's own list, and that is now the wrong
    // call — the card is bb's borderless tint, so there is no longer a box
    // around the title to justify a smaller one.
    assert.match(rootSource, /"min-w-0 flex-1 truncate text-sm text-foreground"/);
    // The child row stays a size down, which is what carries the hierarchy
    // once the family box is gone.
    assert.match(childSource, /"min-w-0 flex-1 truncate text-xs text-foreground"/);
    // The location line lives with the controls that draw it.
    assert.match(
      controls,
      /gap-1 truncate text-2xs text-muted-foreground/,
    );
    assert.match(controls, /truncate text-2xs text-muted-foreground/);
    assert.match(controls, /className="truncate font-mono"/);
    assert.match(controls, /\{branch\}/);
    // One cluster, right aligned, and only the two places a line can end: the
    // title line (one-line layout, or details in the hover card) and the branch
    // line. The second column beside the two lines is gone.
    assert.match(partsSource, /relative z-10 ml-auto flex shrink-0 items-center/);
    assert.doesNotMatch(rootSource, /flex-col gap-0\.5/);
    assert.equal(
      rootSource.match(/<RootTrailingCluster interactive=\{!selectionMode\}>/g)
        ?.length,
      2,
    );
    assert.match(
      modelSource,
      /rootQuickActionsAvailable\s*=\s*input\.canPark &&[\s\S]*?showRowDetails &&[\s\S]*?preferences\.showPinAction/,
    );
    assert.match(
      modelSource,
      /rowActionsRevealed\s*=\s*rootQuickActionsAvailable && input\.revealRevealed/,
    );
  });

  it("uses normal foreground text for thread titles", () => {
    const rootTitleStart = rootSource.indexOf("title={threadDisplayTitle(thread)}");
    const rootTitleEnd = rootSource.indexOf("</span>", rootTitleStart);
    const rootTitle = rootSource.slice(rootTitleStart, rootTitleEnd);
    const childTitleStart = childSource.indexOf("title={threadDisplayTitle(thread)}");
    const childTitleEnd = childSource.indexOf("</span>", childTitleStart);
    const childTitle = childSource.slice(childTitleStart, childTitleEnd);

    assert.match(rootTitle, /text-foreground/);
    assert.match(childTitle, /text-foreground/);
    assert.doesNotMatch(rootTitle, /font-(medium|semibold|bold)/);
    assert.doesNotMatch(childTitle, /font-(medium|semibold|bold)/);
    assert.doesNotMatch(rootTitle, /text-muted-foreground/);
    assert.doesNotMatch(childTitle, /text-muted-foreground/);
  });

  it("does not mount an empty trailing rail when a row has no tail content", () => {
    assert.match(modelSource, /const showRootRail =/);
    assert.ok(rootSource.includes("showRootRail ? ("));
    assert.match(childSource, /const showChildRail =/);
    assert.ok(childSource.includes("showChildRail ? ("));
  });

  it("keeps semantic, disclosure, provider, and reorder help keyboard-readable", () => {
    assert.match(rootSource, /<FamilyStatusIcon/);
    // The marker keeps its tooltip and drag/keyboard contract in both variants.
    assert.match(rootSource, /variant=\{preferences\.statusDisplay\}/);
    assert.match(familyStatusSource, /variant === "dot"/);
    assert.match(rootSource, /role="tooltip"/);
    assert.match(rootSource, /reorderHelp=/);
    assert.match(familyStatusSource, /aria-keyshortcuts=/);
    assert.match(rootSource, /application\/x-nest-family|onReorderDragStart/);
    assert.match(rootSource, /interactive=\{false\}/);
    assert.doesNotMatch(rootSource, /function ReorderHandle|group\/reorder/);
    assert.match(familyStatusSource, /w-14/);
    assert.match(familyStatusSource, /px-0/);
  });

  it("keeps child status and disclosure-provider help keyboard-readable", () => {
    assert.match(modelSource, /childProviderNames/);
    assert.match(modelSource, /providers: \$\{childProviderNames\}/);
    assert.match(childSource, /<ThreadStateGlyph thread=\{thread\}/);
    assert.match(controls, /Inactive: no active work in this child thread/);
    assert.match(controls, /group\/child-status/);
    assert.match(controls, /tabIndex=\{0\}/);
    assert.match(controls, /role="tooltip"/);
  });
});
