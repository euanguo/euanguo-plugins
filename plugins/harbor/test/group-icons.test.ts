import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import {
  DEFAULT_GROUP_ICON,
  GROUP_ICON_LABELS,
  GROUP_ICON_OPTIONS,
  canonicalGroupIcon,
  normalizeGroupIconName,
  validGroupIcon,
} from "../lib/domain/group-icons.ts";
import {
  GROUP_MIGRATION,
  createGroupStore,
} from "../lib/stores/group-store.ts";

function createStore() {
  const db = new Database(":memory:");
  db.exec(GROUP_MIGRATION);
  return { db, store: createGroupStore(db) };
}

describe("group icon catalog and persistence", () => {
  it("offers a curated set of monochrome vector icons with labels and no duplicates", () => {
    assert.ok(GROUP_ICON_OPTIONS.length >= 16);
    assert.ok(GROUP_ICON_OPTIONS.length <= 48);
    assert.equal(new Set(GROUP_ICON_OPTIONS).size, GROUP_ICON_OPTIONS.length);
    for (const icon of GROUP_ICON_OPTIONS) {
      assert.ok(GROUP_ICON_LABELS[icon].length > 0);
      assert.equal(normalizeGroupIconName(icon), icon);
    }
    assert.equal(DEFAULT_GROUP_ICON, "Folder");
  });

  it("maps legacy Hugeicons names and emoji values onto monochrome BB icons while rejecting unsafe strings", () => {
    assert.equal(normalizeGroupIconName("Layer"), "Folder");
    assert.equal(normalizeGroupIconName("⚙️"), "Settings");
    assert.equal(normalizeGroupIconName("💰"), "Home");
    assert.equal(normalizeGroupIconName("💡"), "Puzzle");
    assert.equal(normalizeGroupIconName("IdCard"), "Home");
    assert.equal(normalizeGroupIconName("🦄"), "Folder");
    assert.equal(validGroupIcon("🦄"), true);
    assert.equal(canonicalGroupIcon("not-an-icon"), "Folder");
    assert.equal(normalizeGroupIconName("<b>"), null);
    assert.equal(normalizeGroupIconName(""), null);
    assert.equal(normalizeGroupIconName("   "), null);
    assert.equal(normalizeGroupIconName("🦄".repeat(40)), null);
    assert.equal(validGroupIcon(42), false);
  });

  it("keeps icons independent for separate groups", () => {
    const { db, store } = createStore();
    try {
      store.create("group-a", "Alpha", "Workflow");
      store.create("group-b", "Beta", "Puzzle");
      assert.deepEqual(
        store.list().map((group) => [group.id, group.icon]),
        [
          ["group-a", "Workflow"],
          ["group-b", "Puzzle"],
        ],
      );

      store.rename("group-a", "Alpha", "Layer");
      assert.equal(store.list().find((group) => group.id === "group-a")?.icon, "Folder");
      assert.equal(store.list().find((group) => group.id === "group-b")?.icon, "Puzzle");
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
          icon: "Target",
        },
      ]);
    } finally {
      db.close();
    }
  });
});
