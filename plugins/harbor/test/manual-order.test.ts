import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  UNGROUPED_ORDER_SCOPE,
  normalizeOrderMap,
  parseItemIds,
  serializeItemIds,
  validOrderItems,
  validOrderMap,
} from "../lib/domain/manual-order.ts";
import { UNGROUPED_SCOPE_KEY } from "../lib/ui/view-state.ts";

describe("manual order map", () => {
  it("keeps the ungrouped scope key in step with the view state", () => {
    // The server bundle must not import the frontend view state, so the two
    // constants are declared separately and pinned here instead.
    assert.equal(UNGROUPED_ORDER_SCOPE, UNGROUPED_SCOPE_KEY);
  });

  it("rejects duplicates, blanks, and control characters", () => {
    assert.equal(validOrderItems(["a", "b"]), true);
    assert.equal(validOrderItems([]), true);
    assert.equal(validOrderItems(["a", "a"]), false);
    assert.equal(validOrderItems(["bad\n"]), false);
    assert.equal(validOrderItems([" lead"]), false);
    assert.equal(validOrderItems("nope"), false);
  });

  it("validates a whole map and drops only bad scopes when normalizing", () => {
    assert.equal(validOrderMap({ g1: ["a"] }), true);
    assert.equal(validOrderMap({ g1: ["a", "a"] }), false);
    assert.equal(validOrderMap(null), false);
    assert.deepEqual(
      normalizeOrderMap({ g1: ["a", "b"], "": ["x"], g2: ["c", "c"] }),
      { g1: ["a", "b"] },
    );
  });

  it("round-trips the stored column and fails closed", () => {
    assert.deepEqual(parseItemIds(serializeItemIds(["a", "b"])), ["a", "b"]);
    assert.equal(parseItemIds("nope"), null);
    assert.equal(parseItemIds(JSON.stringify(["a", "a"])), null);
    assert.equal(parseItemIds(null), null);
  });

  it("allows long worktree keys up to 1024 characters", () => {
    const longKey = `ws:host_1:${"/segment".repeat(35)}`;
    assert.ok(longKey.length > 200 && longKey.length <= 1024);
    assert.equal(validOrderItems([longKey]), true);
    assert.equal(validOrderItems(["x".repeat(1025)]), false);
  });
});
