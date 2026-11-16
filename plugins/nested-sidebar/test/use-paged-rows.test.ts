import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_PAGE_SIZE } from "../lib/domain/paging.ts";
import { pagedRows } from "../hooks/use-paged-rows.ts";

const PAGE = DEFAULT_PAGE_SIZE;

describe("pagedRows", () => {
  it("draws the first page, and the next click adds a page", () => {
    const first = pagedRows({ total: 40, pageSize: PAGE, searching: false, pages: 1 });
    assert.equal(first.visibleCount, PAGE);
    assert.equal(first.hasMore, true);
    assert.equal(first.remaining, PAGE);
    assert.equal(first.page, 1);

    const second = pagedRows({ total: 40, pageSize: PAGE, searching: false, pages: 2 });
    assert.equal(second.visibleCount, PAGE * 2);
    assert.equal(second.remaining, PAGE);
    assert.equal(second.page, 2);
  });

  it("counts the last page's leftover rows, never past the list", () => {
    const secondToLast = pagedRows({ total: 42, pageSize: PAGE, searching: false, pages: 8 });
    assert.equal(secondToLast.hasMore, true);
    assert.equal(secondToLast.remaining, 2);

    const last = pagedRows({ total: 42, pageSize: PAGE, searching: false, pages: 9 });
    assert.equal(last.hasMore, false);
    assert.equal(last.remaining, 0);
  });

  it("draws every match while a search is running", () => {
    const searched = pagedRows({ total: 40, pageSize: PAGE, searching: true, pages: 1 });
    assert.equal(searched.visibleCount, Infinity);
    assert.equal(searched.hasMore, false);
    assert.equal(searched.remaining, 0);
  });

  it("asks nothing of an empty list", () => {
    const empty = pagedRows({ total: 0, pageSize: PAGE, searching: false, pages: 1 });
    assert.equal(empty.hasMore, false);
    assert.equal(empty.remaining, 0);
  });
});
