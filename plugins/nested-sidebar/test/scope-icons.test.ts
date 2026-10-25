import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import {
  DEFAULT_SCOPE_ICONS,
  SCOPE_ICON_KEYS,
  SCOPE_ICON_SCOPES,
} from "../lib/group-scope-icons.ts";
import { validGroupIcon } from "../lib/group-icons.ts";
import {
  SCOPE_ICON_MIGRATION,
  createScopeIconStore,
} from "../lib/scope-icon-store.ts";
import { ALL_SCOPE_KEY, UNGROUPED_SCOPE_KEY } from "../lib/view-state.ts";

function createStore() {
  const db = new Database(":memory:");
  db.exec(SCOPE_ICON_MIGRATION);
  return { db, store: createScopeIconStore(db) };
}

describe("scope icon keys", () => {
  it("keeps the strip's own keys in step with the view state", () => {
    // The server bundle must not import the frontend view state, so the two
    // constants are declared separately and pinned here instead.
    assert.equal(SCOPE_ICON_KEYS.all, ALL_SCOPE_KEY);
    assert.equal(SCOPE_ICON_KEYS.ungrouped, UNGROUPED_SCOPE_KEY);
  });

  it("defaults to icons the picker can actually draw", () => {
    for (const scope of SCOPE_ICON_SCOPES) {
      assert.equal(validGroupIcon(DEFAULT_SCOPE_ICONS[scope]), true, scope);
    }
  });
});

describe("scope icon store", () => {
  it("answers for both scopes before anything is stored", () => {
    const { db, store } = createStore();
    try {
      assert.deepEqual(store.list(), {
        all: DEFAULT_SCOPE_ICONS.all,
        ungrouped: DEFAULT_SCOPE_ICONS.ungrouped,
      });
    } finally {
      db.close();
    }
  });

  it("stores one row per scope and replaces it in place", () => {
    const { db, store } = createStore();
    try {
      assert.equal(store.set("ungrouped", "AbacusIcon", 6), true);
      assert.deepEqual(store.list(), {
        all: DEFAULT_SCOPE_ICONS.all,
        ungrouped: "AbacusIcon",
      });

      store.set("all", "Activity05Icon", 7);
      store.set("all", "AdventureIcon", 8);
      assert.deepEqual(store.list(), {
        all: "AdventureIcon",
        ungrouped: "AbacusIcon",
      });

      const rows = db
        .prepare("SELECT scope_key, updated_at FROM scope_icons ORDER BY scope_key")
        .all() as { scope_key: string; updated_at: number }[];
      assert.deepEqual(rows, [
        { scope_key: SCOPE_ICON_KEYS.all, updated_at: 8 },
        { scope_key: SCOPE_ICON_KEYS.ungrouped, updated_at: 6 },
      ]);
    } finally {
      db.close();
    }
  });

  it("canonicalizes a legacy name and refuses to store a foreign one", () => {
    const { db, store } = createStore();
    try {
      store.set("ungrouped", "FolderTree");
      assert.equal(store.list().ungrouped, "FolderTreeIcon");

      // An unknown name falls back to the default group icon rather than
      // leaving the strip with an icon nothing can draw.
      store.set("all", "NotAnIcon");
      assert.equal(store.list().all, "LayerIcon");
    } finally {
      db.close();
    }
  });
});
