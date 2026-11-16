import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import {
  VIEW_PREFERENCE_MIGRATION,
  createViewPreferenceStore,
} from "../lib/stores/view-preference-store.ts";

function createStore() {
  const db = new Database(":memory:");
  db.exec(VIEW_PREFERENCE_MIGRATION);
  return { db, store: createViewPreferenceStore(db) };
}

describe("view preference store", () => {
  it("defaults to the manual order", () => {
    const { db, store } = createStore();
    try {
      assert.deepEqual(store.get(), {
        projectSort: "manual",
        threadSort: "manual",
        worktreeSort: "manual",
        organizationMode: "project",
        sidebarMode: "threads",
        scopeStrip: "auto",
      });
    } finally {
      db.close();
    }
  });

  it("writes each key independently and returns the whole record", () => {
    const { db, store } = createStore();
    try {
      assert.deepEqual(store.set({ projectSort: "status" }), {
        projectSort: "status",
        threadSort: "manual",
        worktreeSort: "manual",
        organizationMode: "project",
        sidebarMode: "threads",
        scopeStrip: "auto",
      });
      assert.deepEqual(store.set({ threadSort: "updated-desc" }), {
        projectSort: "status",
        threadSort: "updated-desc",
        worktreeSort: "manual",
        organizationMode: "project",
        sidebarMode: "threads",
        scopeStrip: "auto",
      });
      assert.deepEqual(store.set({ worktreeSort: "threads-desc" }), {
        projectSort: "status",
        threadSort: "updated-desc",
        worktreeSort: "threads-desc",
        organizationMode: "project",
        sidebarMode: "threads",
        scopeStrip: "auto",
      });
      // The one key that changes what the tree *is* rather than how it reads,
      // and it writes like every other: independently, and returned whole.
      assert.deepEqual(store.set({ organizationMode: "machine" }), {
        projectSort: "status",
        threadSort: "updated-desc",
        worktreeSort: "threads-desc",
        organizationMode: "machine",
        sidebarMode: "threads",
        scopeStrip: "auto",
      });
      assert.deepEqual(store.get(), {
        projectSort: "status",
        threadSort: "updated-desc",
        worktreeSort: "threads-desc",
        organizationMode: "machine",
        sidebarMode: "threads",
        scopeStrip: "auto",
      });
      // The one key that is a standing choice about a single control rather
      // than the tree's order, and it writes like every other.
      assert.deepEqual(store.set({ scopeStrip: "labels" }), {
        projectSort: "status",
        threadSort: "updated-desc",
        worktreeSort: "threads-desc",
        organizationMode: "machine",
        sidebarMode: "threads",
        scopeStrip: "labels",
      });
    } finally {
      db.close();
    }
  });

  it("ignores a value this build does not know", () => {
    const { db, store } = createStore();
    try {
      const insert = db.prepare(
        `INSERT INTO view_preferences (key, value, updated_at) VALUES (?, ?, ?)`,
      );
      insert.run("projectSort", "nonsense", 0);
      assert.equal(store.get().projectSort, "manual");
      insert.run("organizationMode", "by-vibes", 0);
      assert.equal(store.get().organizationMode, "project");
    } finally {
      db.close();
    }
  });
});
