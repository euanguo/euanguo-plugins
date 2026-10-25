import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MIN_PAGE_SIZE,
  hasMoreRows,
  nextPageSize,
  resolvePageSize,
  visibleRows,
} from "../lib/paging.ts";

const PAGE = DEFAULT_PAGE_SIZE;

function threads(count: number): { id: string }[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `thr_${index}`,
  }));
}

/** A thread family, as the tree draws it — its id is its root's. */
function families(count: number): { root: { id: string } }[] {
  return Array.from({ length: count }, (_, index) => ({
    root: { id: `thr_${index}` },
  }));
}

const threadId = (row: { id: string }) => row.id;
const familyId = (row: { root: { id: string } }) => row.root.id;

describe("visibleRows", () => {
  it("draws the first page in the order it was given", () => {
    const all = threads(40);
    const visible = visibleRows(all, PAGE, null, threadId);

    assert.equal(visible.length, PAGE);
    assert.deepEqual(
      visible.map(threadId),
      all.slice(0, PAGE).map(threadId),
    );
  });

  it("keeps the open row past the limit, whatever the row is", () => {
    assert.equal(
      visibleRows(threads(40), PAGE, "thr_30", threadId).at(-1)?.id,
      "thr_30",
    );
    // The families are the reason the id is asked for rather than assumed.
    assert.equal(
      visibleRows(families(40), PAGE, "thr_30", familyId).at(-1)?.root.id,
      "thr_30",
    );
  });

  it("does not draw an open row twice when it is already inside the limit", () => {
    const visible = visibleRows(threads(40), PAGE, "thr_3", threadId);

    assert.equal(visible.length, PAGE);
    assert.equal(visible.filter((row) => row.id === "thr_3").length, 1);
  });

  it("draws everything once the limit has caught up", () => {
    const all = threads(12);
    assert.equal(visibleRows(all, 25, null, threadId).length, 12);
    assert.equal(visibleRows(all, 12, null, threadId).length, 12);
  });

  it("draws nothing for an empty list", () => {
    assert.deepEqual(visibleRows([], PAGE, null, threadId), []);
    assert.deepEqual(visibleRows([], PAGE, "thr_gone", threadId), []);
  });
});

describe("hasMoreRows", () => {
  it("is true only while rows are held back", () => {
    assert.equal(hasMoreRows(40, PAGE), true);
    assert.equal(hasMoreRows(PAGE, PAGE), false);
    assert.equal(hasMoreRows(PAGE - 1, PAGE), false);
    assert.equal(hasMoreRows(0, PAGE), false);
  });
});

describe("nextPageSize", () => {
  it("adds a whole page while more than a page remains", () => {
    assert.equal(nextPageSize(40, PAGE, PAGE), PAGE);
    assert.equal(nextPageSize(40, 2 * PAGE, 25), 25);
  });

  it("adds only the remainder on the last page", () => {
    assert.equal(nextPageSize(7, PAGE, PAGE), 2);
    assert.equal(nextPageSize(11, 2 * PAGE, PAGE), 1);
  });

  it("adds nothing once everything is drawn", () => {
    assert.equal(nextPageSize(35, 35, PAGE), 0);
    assert.equal(nextPageSize(4, 35, PAGE), 0);
  });

  it("never adds more than the page it was given", () => {
    assert.equal(nextPageSize(100, 0, 3), 3);
  });
});

describe("resolvePageSize", () => {
  it("draws five rows a page until the user says otherwise", () => {
    assert.equal(DEFAULT_PAGE_SIZE, 5);
    assert.equal(resolvePageSize(undefined), 5);
    assert.equal(resolvePageSize(12), 12);
  });

  it("clamps a stored value into something drawable", () => {
    assert.equal(resolvePageSize(0), MIN_PAGE_SIZE);
    assert.equal(resolvePageSize(-8), MIN_PAGE_SIZE);
    assert.equal(resolvePageSize(MAX_PAGE_SIZE + 1), MAX_PAGE_SIZE);
    assert.equal(resolvePageSize(7.9), 7);
  });

  it("falls back on a value that is not a number at all", () => {
    // A hand-edited settings row, or an older build's string field.
    assert.equal(resolvePageSize("25"), DEFAULT_PAGE_SIZE);
    assert.equal(resolvePageSize(Number.NaN), DEFAULT_PAGE_SIZE);
    assert.equal(resolvePageSize(Number.POSITIVE_INFINITY), DEFAULT_PAGE_SIZE);
    assert.equal(resolvePageSize(null), DEFAULT_PAGE_SIZE);
  });
});
