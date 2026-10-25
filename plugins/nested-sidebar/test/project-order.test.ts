import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyProjectOrder,
  decodeProjectOrder,
  keyboardProjectMove,
  moveProject,
  PROJECT_ORDER_STORAGE_KEY,
  readProjectOrder,
  writeProjectOrder,
  type ProjectOrderStorage,
} from "../lib/project-order.ts";
import type { ProjectThreadGroup } from "../lib/inbox.ts";

class MemoryStorage implements ProjectOrderStorage {
  value: string | null = null;
  getItem(key: string) { assert.equal(key, PROJECT_ORDER_STORAGE_KEY); return this.value; }
  setItem(key: string, value: string) { assert.equal(key, PROJECT_ORDER_STORAGE_KEY); this.value = value; }
}

function group(id: string): ProjectThreadGroup {
  return {
    project: {
      id,
      name: id,
      isPersonal: false,
      href: `/projects/${id}`,
      settingsHref: `/projects/${id}/settings`,
    },
    families: [],
  };
}

describe("project order", () => {
  it("round-trips, applies stored ranks, and preserves new projects", () => {
    const storage = new MemoryStorage();
    assert.equal(writeProjectOrder(["b", "a"], storage), true);
    assert.deepEqual(readProjectOrder(storage), ["b", "a"]);
    assert.deepEqual(
      applyProjectOrder([group("a"), group("new"), group("b")], ["b", "a"]).map((item) => item.project.id),
      ["b", "a", "new"],
    );
  });

  it("fails closed for malformed, duplicate, and controlled values", () => {
    assert.deepEqual(decodeProjectOrder("nope"), []);
    assert.deepEqual(decodeProjectOrder(JSON.stringify(["a", "a"])), []);
    assert.deepEqual(decodeProjectOrder(JSON.stringify(["bad\n"])), []);
  });

  it("moves complete project orders by drag and keyboard", () => {
    assert.deepEqual(
      moveProject({ projectIds: ["a", "b", "c"], sourceProjectId: "c", targetProjectId: "a", position: "before" }),
      { ok: true, order: ["c", "a", "b"] },
    );
    assert.deepEqual(keyboardProjectMove(["a", "b", "c"], "b", 1), {
      ok: true,
      order: ["a", "c", "b"],
    });
  });
});
