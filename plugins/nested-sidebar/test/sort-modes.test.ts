import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_PROJECT_SORT,
  DEFAULT_THREAD_SORT,
  PROJECT_SORT_LABELS,
  PROJECT_SORT_MODES,
  THREAD_SORT_LABELS,
  THREAD_SORT_MODES,
  isManualProjectSort,
  isManualThreadSort,
  validProjectSort,
  validThreadSort,
} from "../lib/sort-modes.ts";

describe("sort modes", () => {
  it("defaults to the manual order everywhere", () => {
    // The sidebar's promise is that activity never re-orders the list, so a
    // default that sorted by time would undercut the whole plugin.
    assert.equal(DEFAULT_PROJECT_SORT, "manual");
    assert.equal(DEFAULT_THREAD_SORT, "manual");
    assert.equal(isManualProjectSort(DEFAULT_PROJECT_SORT), true);
    assert.equal(isManualThreadSort(DEFAULT_THREAD_SORT), true);
  });

  it("labels every mode", () => {
    for (const mode of PROJECT_SORT_MODES) {
      assert.equal(typeof PROJECT_SORT_LABELS[mode], "string");
      assert.ok(PROJECT_SORT_LABELS[mode].length > 0);
    }
    for (const mode of THREAD_SORT_MODES) {
      assert.equal(typeof THREAD_SORT_LABELS[mode], "string");
      assert.ok(THREAD_SORT_LABELS[mode].length > 0);
    }
  });

  it("validates a stored mode against its own list", () => {
    assert.equal(validProjectSort("status"), true);
    assert.equal(validProjectSort("created-desc"), false);
    assert.equal(validThreadSort("created-desc"), true);
    assert.equal(validThreadSort("attention-desc"), true);
    assert.equal(validThreadSort("threads-desc"), false);
    assert.equal(validProjectSort(7), false);
    assert.equal(validThreadSort(null), false);
  });
});
