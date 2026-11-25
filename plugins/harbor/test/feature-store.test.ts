import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";

import { FEATURE_STORE_MIGRATIONS, createFeatureStore } from "../lib/stores/feature-store.ts";

/** A database that ran the whole journal, the way bb runs it. */
function createStore() {
  const db = new Database(":memory:");
  for (const statement of FEATURE_STORE_MIGRATIONS) db.exec(statement);
  return { db, store: createFeatureStore(db) };
}

const base = {
  rootPath: "/home/u/HarborFeatures/x",
  hostId: "host_a",
};

describe("feature store", () => {
  it("creates a feature with its folder and lists it", () => {
    const { db, store } = createStore();
    try {
      const created = store.create({ ...base, id: "f_1", name: "AI 助手", slug: "ai-voice" });
      assert.equal(created?.state, "active");
      assert.equal(created?.rootPath, base.rootPath);
      assert.deepEqual(
        store.list().map((feature) => [feature.id, feature.name, feature.slug]),
        [["f_1", "AI 助手", "ai-voice"]],
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

  it("skips corrupted rows without a valid slug when listing", () => {
    const { db, store } = createStore();
    try {
      db.prepare(
        `INSERT INTO features (id, name, slug, state, group_id, position, updated_at, root_path, host_id)
         VALUES (?, ?, ?, 'active', NULL, 0, 0, ?, ?)`,
      ).run("feat_bad", "Bad Slug", "Not Valid", "/home/u/HarborFeatures/feat_bad", "host_a");
      assert.deepEqual(store.list(), []);
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

  /** A container outlives its features, so its path is remembered separately. */
  it("remembers every container path, once", () => {
    const { db, store } = createStore();
    try {
      store.recordContainer("/Users/u/.bb/features");
      store.recordContainer("/Users/u/.bb/features");
      store.recordContainer("/Users/u/HarborFeatures");
      assert.deepEqual(store.containers().sort(), [
        "/Users/u/.bb/features",
        "/Users/u/HarborFeatures",
      ]);
    } finally {
      db.close();
    }
  });

  it("answers the current root of every machine", () => {
    const { db, store } = createStore();
    try {
      store.setFeaturesRoot("host_a", "/Users/u/.bb/features", "bb-data-v1");
      store.setFeaturesRoot("host_b", "/home/u/features", "bb-data-v1");
      assert.deepEqual(
        store.featuresRoots().sort((left, right) => left.hostId.localeCompare(right.hostId)),
        [
          { hostId: "host_a", rootPath: "/Users/u/.bb/features" },
          { hostId: "host_b", rootPath: "/home/u/features" },
        ],
      );
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
