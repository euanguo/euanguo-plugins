import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const read = (relative: string) =>
  readFile(new URL(relative, import.meta.url), "utf8");

const inbox = await read("../components/inbox/thread-inbox.tsx");
const project = await read("../components/inbox/project-node.tsx");
const rows = await read("../components/inbox/tree-rows.tsx");
const controls = await read("../components/inbox/page-controls.tsx");
const preferences = await read("../lib/preferences.ts");
const server = await read("../server.ts");

const SITES = [
  ["thread-inbox", inbox, "settledPages"],
  ["project-node", project, "flatPages"],
  ["tree-rows", rows, "familyPages"],
] as const;

/** The settled shelf's own opening tag, so the snoozed one can be checked too. */
function parkedShelfTag(label: string): string {
  const at = inbox.indexOf(`label="${label}"`);
  assert.notEqual(at, -1, `no ParkedShelf labelled ${label}`);
  return inbox.slice(at, inbox.indexOf("/>", at));
}

describe("the paged lists", () => {
  it("share one set of controls rather than three copies of them", () => {
    assert.match(controls, /export function PageControls\(/);
    assert.match(controls, /Load \{remaining\} more/);
    assert.match(controls, /Show less/);
    for (const [name, source] of SITES) {
      assert.match(
        source,
        /from "@\/components\/inbox\/page-controls"/,
        `${name} does not use the shared controls`,
      );
      assert.match(source, /<PageControls/, `${name} does not render them`);
    }
  });

  it("puts Show less to the right of Load more, in one row", () => {
    // `lastIndexOf` on the label, because the doc comment names Show less too.
    const load = controls.indexOf("Load {remaining} more");
    const less = controls.lastIndexOf("Show less");
    assert.ok(load !== -1 && less !== -1 && load < less);
    assert.match(controls, /"mt-1 flex items-center gap-1"/);
  });

  it("offers Show less only once there is more than one page drawn", () => {
    // One page is the resting state; there is nothing to put away.
    assert.match(controls, /\{page > 1 \? \(/);
    assert.match(controls, /\{hasMore \? \(/);
  });

  it("puts the list away in one click rather than one page at a time", () => {
    for (const [name, source, state] of SITES) {
      assert.match(
        source,
        new RegExp(`onShowLess=\\{\\(\\) => set\\w+\\(1\\)\\}`),
        `${name} does not reset to the first page`,
      );
      assert.match(source, new RegExp(`page=\\{${state}\\}`), `${name} no page`);
    }
  });

  it("hides both controls while a search is drawing every match", () => {
    // A control that cannot change what is on screen is worse than no control.
    assert.match(project, /\{expanded && !handlers\.searching && \(flatHasMore \|\| flatPages > 1\) \? \(/);
    assert.match(rows, /\{expanded && !handlers\.searching && \(familyHasMore \|\| familyPages > 1\) \? \(/);
    assert.match(inbox, /const paged = shelf === "settled" && !searching;/);
    assert.match(inbox, /\{expanded && paged && onLoadMore && onShowLess/);
  });

  it("draws only as much as the page size allows, everywhere", () => {
    // One setting, read from preferences, so the surfaces cannot drift.
    for (const [name, source, expected] of [
      ["thread-inbox", inbox, /settledPages \* preferences\.pageSize/],
      ["project-node", project, /flatPages\) \*\n\s+handlers\.preferences\.pageSize/],
      ["tree-rows", rows, /familyPages\) \*\n\s+handlers\.preferences\.pageSize/],
    ] as const) {
      assert.match(source, expected, `${name} does not derive its limit`);
    }
  });

  it("counts pages, so a page-size change re-scales what is on screen", () => {
    for (const [name, source, state] of SITES) {
      assert.match(
        source,
        new RegExp(`const \\[${state}, set\\w+\\] = useState\\(1\\);`),
        `${name} does not hold a page count`,
      );
      // A stored row count would keep meaning the old page size after a change.
      assert.doesNotMatch(source, /useState\(DEFAULT_PAGE_SIZE\)/);
    }
  });

  it("asks for the next page by adding a page, not a row", () => {
    assert.match(inbox, /setSettledPages\(\(pages\) => pages \+ 1\)/);
    assert.match(project, /setFlatPages\(\(pages\) => pages \+ 1\)/);
    assert.match(rows, /setFamilyPages\(\(pages\) => pages \+ 1\)/);
  });

  it("asks for the next page in the same words everywhere", () => {
    assert.match(
      controls,
      /"rounded px-1\.5 py-1 text-2xs font-medium text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"/,
    );
  });

  it("draws every match while a search is running", () => {
    assert.match(project, /handlers\.searching \? Number\.MAX_SAFE_INTEGER : flatPages/);
    assert.match(rows, /handlers\.searching \? Number\.MAX_SAFE_INTEGER : familyPages/);
    assert.match(rows, /\n  readonly searching: boolean;/);
  });

  it("keeps the open row, and asks each list what its row id is", () => {
    assert.match(
      inbox,
      /visibleRows\(\n\s+threads,\n\s+limit,\n\s+activeThreadId,\n\s+\(thread\) => thread\.id,\n\s+\)/,
    );
    assert.match(project, /\(family\) => family\.root\.id,/);
    assert.match(rows, /\(family\) => family\.root\.id,/);
  });

  it("counts the list's own rows when deciding there is more", () => {
    assert.match(inbox, /hasMoreRows\(threads\.length, limit\)/);
    assert.match(project, /hasMoreRows\(node\.families\.length, flatLimit\)/);
    assert.match(rows, /hasMoreRows\(node\.families\.length, familyLimit\)/);
  });

  it("still calls an empty list empty", () => {
    // The empty state reads the whole list, never the page, or a paged list
    // would claim to have no threads.
    assert.match(rows, /\{node\.families\.length === 0 \? \(/);
    assert.match(project, /node\.families\.length === 0 \? \(/);
  });

  it("pages the settled shelf and leaves the snoozed one whole", () => {
    const settled = parkedShelfTag("Settled");
    assert.match(settled, /settledLimit=\{settledLimit\}/);
    assert.match(settled, /settledPageSize=\{preferences\.pageSize\}/);
    assert.match(settled, /searching=\{searching\}/);
    assert.match(settled, /onShowLess=/);

    const snoozed = parkedShelfTag("Snoozed");
    assert.doesNotMatch(snoozed, /settledLimit/);
    assert.doesNotMatch(snoozed, /onLoadMore/);
    assert.doesNotMatch(snoozed, /onShowLess/);
  });

  it("exposes the page size as a real setting, bounded on read", () => {
    assert.match(server, /pageSize: \{/);
    assert.match(server, /type: "number"/);
    assert.match(server, /default: DEFAULT_PAGE_SIZE,/);
    assert.match(preferences, /pageSize: number;/);
    assert.match(preferences, /pageSize: resolvePageSize\(values\?\.pageSize\)/);
  });
});
