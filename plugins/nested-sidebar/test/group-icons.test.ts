import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import {
  GROUP_ICON_OPTIONS,
  canonicalGroupIcon,
  normalizeGroupIconName,
} from "../lib/groups.ts";
import {
  GROUP_MIGRATION,
  createGroupStore,
} from "../lib/group-store.ts";

function createStore() {
  const db = new Database(":memory:");
  db.exec(GROUP_MIGRATION);
  db.exec("ALTER TABLE project_groups ADD COLUMN icon TEXT NOT NULL DEFAULT 'Layer'");
  return { db, store: createGroupStore(db) };
}

describe("group icon catalog and persistence", () => {
  it("exposes the complete free catalog without duplicate names", () => {
    assert.ok(GROUP_ICON_OPTIONS.length >= 6000);
    assert.equal(new Set(GROUP_ICON_OPTIONS).size, GROUP_ICON_OPTIONS.length);
    assert.equal(normalizeGroupIconName("Layer"), "LayerIcon");
    assert.equal(canonicalGroupIcon("not-an-icon"), "LayerIcon");
  });

  it("keeps icons independent for separate groups and stores canonical names", () => {
    const { db, store } = createStore();
    try {
      store.create("group-a", "Alpha", "AArrowDownIcon");
      store.create("group-b", "Beta", "AArrowUpIcon");
      assert.deepEqual(
        store.list().map((group) => [group.id, group.icon]),
        [
          ["group-a", "AArrowDownIcon"],
          ["group-b", "AArrowUpIcon"],
        ],
      );

      store.rename("group-a", "Alpha", "Layer");
      assert.equal(store.list().find((group) => group.id === "group-a")?.icon, "LayerIcon");
      assert.equal(store.list().find((group) => group.id === "group-b")?.icon, "AArrowUpIcon");
    } finally {
      db.close();
    }
  });

  it("normalizes legacy rows when they are read", () => {
    const { db, store } = createStore();
    try {
      db.prepare(
        "INSERT INTO project_groups (id, name, position, updated_at, icon) VALUES (?, ?, ?, ?, ?)",
      ).run("legacy", "Legacy", 0, 1, "Target");
      assert.deepEqual(store.list(), [
        {
          id: "legacy",
          name: "Legacy",
          position: 0,
          icon: "Target02Icon",
        },
      ]);
    } finally {
      db.close();
    }
  });
});
