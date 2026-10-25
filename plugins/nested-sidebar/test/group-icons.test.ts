import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import {
  GROUP_ICON_OPTIONS,
  canonicalGroupIcon,
  normalizeGroupIconName,
  validGroupIcon,
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
  it("offers a short emoji set with no duplicates", () => {
    // A picker, not a library. The 6,025-name catalogue and its 6.9 MB of
    // artwork are gone; what is left has to stay small enough to scan by eye.
    assert.ok(GROUP_ICON_OPTIONS.length >= 48);
    assert.ok(GROUP_ICON_OPTIONS.length <= 128);
    assert.equal(new Set(GROUP_ICON_OPTIONS).size, GROUP_ICON_OPTIONS.length);
    // A Hugeicons name written by an older build still means something.
    assert.equal(normalizeGroupIconName("Layer"), "📁");
    assert.equal(canonicalGroupIcon("not-an-icon"), "📁");
  });

  it("accepts an emoji the picker does not offer, and refuses anything else", () => {
    // The picker is a shortcut, not the vocabulary: a user who types an emoji
    // gets it, because the stored value is what they chose.
    assert.equal(normalizeGroupIconName("🦄"), "🦄");
    assert.equal(validGroupIcon("🦄"), true);
    // ASCII would let a stored row smuggle markup-shaped text into a label.
    assert.equal(normalizeGroupIconName("<b>"), null);
    assert.equal(normalizeGroupIconName(""), null);
    assert.equal(normalizeGroupIconName("   "), null);
    // And an unbounded length would let an icon move a row's layout.
    assert.equal(normalizeGroupIconName("🦄".repeat(40)), null);
    assert.equal(validGroupIcon(42), false);
  });

  it("keeps icons independent for separate groups", () => {
    const { db, store } = createStore();
    try {
      store.create("group-a", "Alpha", "🚀");
      store.create("group-b", "Beta", "🧪");
      assert.deepEqual(
        store.list().map((group) => [group.id, group.icon]),
        [
          ["group-a", "🚀"],
          ["group-b", "🧪"],
        ],
      );

      store.rename("group-a", "Alpha", "Layer");
      assert.equal(store.list().find((group) => group.id === "group-a")?.icon, "📁");
      assert.equal(store.list().find((group) => group.id === "group-b")?.icon, "🧪");
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
          icon: "🎯",
        },
      ]);
    } finally {
      db.close();
    }
  });
});
