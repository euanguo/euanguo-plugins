import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { statusColorRole } from "../lib/status-presentation.ts";

describe("statusColorRole", () => {
  it("separates error, waiting, unread, working, and idle roles", () => {
    assert.equal(statusColorRole("unread-error"), "error");
    assert.equal(statusColorRole("waiting-for-input"), "waiting");
    assert.equal(statusColorRole("unread-success"), "unread");
    for (const indicator of [
      "runtime",
      "workflow",
      "background-agent",
      "background-command",
      "plan-mode",
      "goal",
    ] as const) {
      assert.equal(statusColorRole(indicator), "working");
    }
    assert.equal(statusColorRole("draft"), "inactive");
    assert.equal(statusColorRole("working-draft"), "inactive");
    assert.equal(statusColorRole("none"), null);
  });
});
