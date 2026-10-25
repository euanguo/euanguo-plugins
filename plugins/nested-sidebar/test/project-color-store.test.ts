import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import {
  PROJECT_COLOR_MIGRATION,
  createProjectColorStore,
} from "../lib/project-color-store.ts";
import { MAX_PROJECT_COLOR_ROWS } from "../lib/project-colors.ts";

function createStore() {
  const db = new Database(":memory:");
  db.exec(PROJECT_COLOR_MIGRATION);
  return { db, store: createProjectColorStore(db) };
}

describe("project color store", () => {
  it("canonicalizes, persists, updates, and resets one project", () => {
    const { db, store } = createStore();
    try {
      assert.deepEqual(store.set("project-a", "#abcdef", 1), {
        projectId: "project-a",
        color: "#ABCDEF",
      });
      assert.deepEqual(store.list(), [
        { projectId: "project-a", color: "#ABCDEF" },
      ]);
      store.set("project-a", "#123456", 2);
      store.set("project-b", "#654321", 3);
      assert.deepEqual(store.list(), [
        { projectId: "project-b", color: "#654321" },
        { projectId: "project-a", color: "#123456" },
      ]);
      assert.equal(store.reset("project-a"), true);
      assert.equal(store.reset("project-a"), false);
      assert.deepEqual(store.list(), [
        { projectId: "project-b", color: "#654321" },
      ]);
    } finally {
      db.close();
    }
  });

  it("contains invalid persisted rows and rejects invalid writes", () => {
    const { db, store } = createStore();
    try {
      db.prepare(
        `INSERT INTO project_badge_colors (project_id, color, updated_at)
         VALUES (?, ?, ?)`,
      ).run("project-a", "var(--bad)", 1);
      assert.deepEqual(store.list(), []);
      assert.throws(() => store.set("project-b", "#fff"), /Invalid/);
      assert.throws(() => store.set("project\nb", "#112233"), /Invalid/);
    } finally {
      db.close();
    }
  });

  it("bounds new rows while allowing updates at the limit", () => {
    const { db, store } = createStore();
    try {
      const insert = db.prepare(
        `INSERT INTO project_badge_colors (project_id, color, updated_at)
         VALUES (?, '#112233', ?)`,
      );
      const seed = db.transaction(() => {
        for (let index = 0; index < MAX_PROJECT_COLOR_ROWS; index += 1) {
          insert.run(`project-${index}`, index);
        }
      });
      seed();
      assert.equal(store.list().length, MAX_PROJECT_COLOR_ROWS);
      assert.throws(
        () => store.set("one-too-many", "#445566"),
        /limit reached/,
      );
      assert.equal(store.set("project-1", "#AABBCC").color, "#AABBCC");
    } finally {
      db.close();
    }
  });
});
