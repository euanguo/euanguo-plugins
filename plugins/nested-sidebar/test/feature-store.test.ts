import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";

import { FEATURE_MIGRATIONS, createFeatureStore } from "../lib/feature-store.ts";

/** A database that ran the whole journal, the way bb runs it. */
function createStore() {
  const db = new Database(":memory:");
  for (const statement of FEATURE_MIGRATIONS) db.exec(statement);
  return { db, store: createFeatureStore(db) };
}

const base = {
  rootPath: "/home/u/NestFeatures/x",
  hostId: "host_a",
};

describe("feature store", () => {
  it("creates a feature with its folder and lists it", () => {
    const { db, store } = createStore();
    try {
      const created = store.create({ ...base, id: "f_1", name: "AI 语音", slug: "ai-voice" });
      assert.equal(created?.state, "active");
      assert.equal(created?.rootPath, base.rootPath);
      assert.deepEqual(
        store.list().map((feature) => [feature.id, feature.name, feature.slug]),
        [["f_1", "AI 语音", "ai-voice"]],
      );
    } finally {
      db.close();
    }
  });

  it("refuses a duplicate id, a duplicate slug, a bad slug and a missing folder", () => {
    const { db, store } = createStore();
    try {
      assert.notEqual(store.create({ ...base, id: "f_a", name: "A", slug: "a1" }), null);
      assert.equal(store.create({ ...base, id: "f_a", name: "B", slug: "b1" }), null);
      assert.equal(store.create({ ...base, id: "f_b", name: "B", slug: "a1" }), null);
      assert.equal(store.create({ ...base, id: "f_c", name: "C", slug: "Not OK" }), null);
      assert.equal(store.create({ ...base, id: "f_d", name: "D", slug: "d1", rootPath: " " }), null);
    } finally {
      db.close();
    }
  });

  /**
   * A database written by the previous build: no slug column values, a CJK id,
   * and a draft state that no longer exists. It must read as a working feature
   * with a stable slug, and keep that slug once written down.
   */
  it("reads and backfills a row an older build wrote", () => {
    const { db, store } = createStore();
    try {
      db.prepare(
        `INSERT INTO features (id, name, state, group_id, position, updated_at, root_path, host_id)
         VALUES (?, ?, 'draft', NULL, 0, 0, ?, ?)`,
      ).run("feat_消息回调", "消息回调", "/home/u/NestFeatures/feat_消息回调", "host_a");
      const before = store.list()[0];
      assert.equal(before?.state, "active");
      assert.ok(before !== undefined && /^f-[a-z0-9]+$/u.test(before.slug));
      assert.equal(store.list()[0]?.slug, before?.slug, "derived the same way on every read");
      assert.equal(store.backfillSlugs(), 1);
      assert.equal(store.backfillSlugs(), 0);
      assert.equal(store.list()[0]?.slug, before?.slug);
    } finally {
      db.close();
    }
  });

  it("adopts an outside worktree and forgets the label with the feature", () => {
    const { db, store } = createStore();
    try {
      store.create({ ...base, id: "f_a", name: "A", slug: "a1" });
      assert.equal(store.adopt("env_1", "f_a"), true);
      assert.deepEqual(store.adoptions(), { env_1: "f_a" });
      assert.equal(store.adopt("env_1", "f_missing"), false);
      assert.equal(store.remove("f_a"), true);
      assert.deepEqual(store.adoptions(), {});
    } finally {
      db.close();
    }
  });

  /** A finish removes the worktrees, so the delete that follows needs this record. */
  it("remembers the branches a feature created, and forgets them with it", () => {
    const { db, store } = createStore();
    try {
      store.create({ ...base, id: "f_a", name: "A", slug: "a1" });
      const branch = { featureId: "f_a", repositoryPath: "/code/x", hostId: "host_a", branch: "feat/a1" };
      store.recordBranch(branch);
      store.recordBranch(branch);
      assert.deepEqual(store.branches("f_a"), [{ repositoryPath: "/code/x", hostId: "host_a", branch: "feat/a1" }]);
      store.remove("f_a");
      assert.deepEqual(store.branches("f_a"), []);
    } finally {
      db.close();
    }
  });

  it("archives and reopens", () => {
    const { db, store } = createStore();
    try {
      store.create({ ...base, id: "f_a", name: "A", slug: "a1" });
      assert.equal(store.setState("f_a", "archived"), true);
      assert.equal(store.find("f_a")?.state, "archived");
      assert.equal(store.setState("f_a", "active"), true);
      assert.equal(store.find("f_a")?.state, "active");
    } finally {
      db.close();
    }
  });
});
