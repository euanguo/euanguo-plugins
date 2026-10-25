import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldShowUngroupedTab } from "../lib/groups.ts";

describe("the Ungrouped tab", () => {
  it("stays away until groups exist, because it would duplicate All", () => {
    assert.equal(shouldShowUngroupedTab(0, 3, 3), false);
  });

  it("stays away while nothing is ungrouped, because its tree is empty", () => {
    assert.equal(shouldShowUngroupedTab(2, 0, 2), false);
  });

  it("shows once groups exist and a project is in it", () => {
    assert.equal(shouldShowUngroupedTab(1, 1, 1), true);
    assert.equal(shouldShowUngroupedTab(9, 4, 13), true);
  });

  it("stays away while the view has no projects, even with a stale group snapshot", () => {
    assert.equal(shouldShowUngroupedTab(4, 0, 0), false);
    assert.equal(shouldShowUngroupedTab(4, 2, 0), false);
  });

  it("shows when the only ungrouped project has no thread or workspace yet", () => {
    assert.equal(shouldShowUngroupedTab(4, 1, 13), true);
  });
});
