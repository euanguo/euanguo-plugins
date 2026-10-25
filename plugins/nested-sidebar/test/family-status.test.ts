import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  familyStatus,
  STALE_AFTER_MS,
  type FamilyStatusThread,
} from "../lib/family-status.ts";

const NOW = 20 * STALE_AFTER_MS;

function thread(
  overrides: Partial<FamilyStatusThread> = {},
): FamilyStatusThread {
  return {
    indicator: "none",
    hasPendingInteraction: false,
    isUnread: false,
    updatedAt: NOW - 60_000,
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
    },
    ...overrides,
  };
}

describe("familyStatus", () => {
  it("projects every explicit state and the exact stale boundary", () => {
    assert.equal(familyStatus([thread({ indicator: "unread-error" })], NOW).kind, "failed");
    assert.equal(familyStatus([thread({ hasPendingInteraction: true })], NOW).kind, "needs-you");
    assert.equal(familyStatus([thread({ indicator: "runtime" })], NOW).kind, "working");
    assert.equal(familyStatus([thread({ isUnread: true })], NOW).kind, "unread");
    assert.equal(familyStatus([thread()], NOW).kind, "inactive");
    assert.equal(
      familyStatus([thread({ updatedAt: NOW - STALE_AFTER_MS })], NOW).kind,
      "stale",
    );
    assert.equal(
      familyStatus([thread({ updatedAt: NOW - STALE_AFTER_MS + 1 })], NOW).kind,
      "inactive",
    );
  });

  it("uses stable attention precedence across root and children", () => {
    const status = familyStatus(
      [
        thread({ isUnread: true }),
        thread({ indicator: "runtime" }),
        thread({ hasPendingInteraction: true }),
        thread({ indicator: "unread-error" }),
      ],
      NOW,
    );
    assert.equal(status.kind, "failed");
    assert.equal(status.label, "Failed");
    assert.equal(status.icon, "CircleX");
  });

  it("uses the newest family member for inactivity and never exposes Done", () => {
    const status = familyStatus(
      [
        thread({ updatedAt: NOW - 10 * STALE_AFTER_MS }),
        thread({ updatedAt: NOW - 1_000 }),
      ],
      NOW,
    );
    assert.equal(status.kind, "inactive");
    assert.equal(status.receded, true);
    assert.doesNotMatch(status.label, /done/i);
  });

  it("keeps all six labels, shapes, and color roles distinct", () => {
    const rows = [
      thread({ indicator: "unread-error" }),
      thread({ hasPendingInteraction: true }),
      thread({ indicator: "runtime" }),
      thread({ isUnread: true }),
      thread(),
      thread({ updatedAt: NOW - STALE_AFTER_MS }),
    ].map((row) => familyStatus([row], NOW));
    assert.equal(new Set(rows.map((row) => row.label)).size, 6);
    assert.equal(new Set(rows.map((row) => row.icon)).size, 6);
    assert.equal(new Set(rows.map((row) => row.colorRole)).size, 6);
  });

  it("keeps the actual live activity type visible by shape and color", () => {
    const rows = [
      thread({ indicator: "runtime" }),
      thread({ indicator: "workflow" }),
      thread({ indicator: "background-agent" }),
      thread({ indicator: "background-command" }),
      thread({ indicator: "plan-mode" }),
      thread({ indicator: "goal" }),
    ].map((row) => familyStatus([row], NOW));
    assert.ok(rows.every((row) => row.label === "Working"));
    assert.equal(new Set(rows.map((row) => row.icon)).size, 6);
    assert.equal(new Set(rows.map((row) => row.colorRole)).size, 6);
  });
});
