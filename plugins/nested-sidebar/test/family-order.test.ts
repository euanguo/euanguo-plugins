import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyFamilyOrder,
  decodeFamilyOrder,
  FAMILY_ORDER_STORAGE_KEY,
  keyboardFamilyMove,
  MAX_ORDER_ROOTS,
  moveProjectFamily,
  readFamilyOrder,
  withProjectFamilyOrder,
  writeFamilyOrder,
  type FamilyOrderStorage,
} from "../lib/family-order.ts";
import type { ThreadFamily } from "../lib/inbox.ts";

function family(id: string, isPinned = false): ThreadFamily {
  return { root: { id, isPinned } as ThreadFamily["root"], children: [] };
}

class MemoryStorage implements FamilyOrderStorage {
  value: string | null = null;
  getItem(key: string) {
    assert.equal(key, FAMILY_ORDER_STORAGE_KEY);
    return this.value;
  }
  setItem(key: string, value: string) {
    assert.equal(key, FAMILY_ORDER_STORAGE_KEY);
    this.value = value;
  }
}

describe("family order persistence", () => {
  it("round-trips bounded project-local root order", () => {
    const storage = new MemoryStorage();
    assert.equal(writeFamilyOrder({ p1: ["a", "b"] }, storage), true);
    assert.deepEqual(readFamilyOrder(storage), { p1: ["a", "b"] });
  });

  it("fails closed for malformed, duplicate, controlled, and oversized data", () => {
    assert.deepEqual(decodeFamilyOrder("nope"), {});
    assert.deepEqual(
      decodeFamilyOrder(JSON.stringify({ version: 1, projects: { p: ["a", "a"] } })),
      {},
    );
    assert.deepEqual(
      decodeFamilyOrder(JSON.stringify({ version: 1, projects: { p: ["bad\n"] } })),
      {},
    );
    assert.equal(
      withProjectFamilyOrder({}, "p", Array.from({ length: MAX_ORDER_ROOTS + 1 }, (_, i) => `r${i}`)),
      null,
    );
  });

  it("keeps pinned roots leading and merges new roots canonically", () => {
    const ordered = applyFamilyOrder(
      [family("p1", true), family("p2", true), family("a"), family("new"), family("b")],
      ["p2", "p1", "b", "a"],
    );
    assert.deepEqual(ordered.map((item) => item.root.id), ["p2", "p1", "b", "a", "new"]);
  });
});

describe("family reorder validation", () => {
  const base = {
    projectId: "p1",
    sourceProjectId: "p1",
    targetProjectId: "p1",
    rootIds: ["pin", "a", "b", "c"],
    pinnedRootIds: ["pin"],
    sourceRootId: "c",
    targetRootId: "a",
    position: "before" as const,
  };

  it("moves a complete root family order and supports keyboard moves", () => {
    assert.deepEqual(moveProjectFamily(base), {
      ok: true,
      order: ["pin", "c", "a", "b"],
    });
    assert.deepEqual(
      keyboardFamilyMove("p1", ["pin", "a", "b"], ["pin"], "b", -1),
      { ok: true, order: ["pin", "b", "a"] },
    );
  });

  it("rejects cross-project, missing, duplicate, and pinned-boundary moves", () => {
    assert.equal(moveProjectFamily({ ...base, targetProjectId: "p2" }).ok, false);
    assert.equal(moveProjectFamily({ ...base, rootIds: ["pin", "a", "a"] }).ok, false);
    assert.equal(moveProjectFamily({ ...base, sourceRootId: "missing" }).ok, false);
    assert.deepEqual(
      moveProjectFamily({ ...base, sourceRootId: "pin", targetRootId: "a" }),
      { ok: false, reason: "pinned-boundary" },
    );
  });
});
