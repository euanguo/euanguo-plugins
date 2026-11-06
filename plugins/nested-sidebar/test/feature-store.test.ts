import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";

import {
  FEATURE_LABEL_MIGRATION,
  FEATURE_HOST_MIGRATION,
  FEATURE_MEMBER_MIGRATION,
  FEATURE_MIGRATION,
  FEATURE_ROOT_MIGRATION,
  createFeatureStore,
} from "../lib/feature-store.ts";

function createStore() {
  const db = new Database(":memory:");
  db.exec(FEATURE_MIGRATION);
  db.exec(FEATURE_LABEL_MIGRATION);
  db.exec(FEATURE_MEMBER_MIGRATION);
  db.exec(FEATURE_ROOT_MIGRATION);
  db.exec(FEATURE_HOST_MIGRATION);
  return { db, store: createFeatureStore(db) };
}

describe("feature store", () => {
  it("creates a draft feature and lists it", () => {
    const { db, store } = createStore();
    try {
      const created = store.create({
        id: "feat_ai",
        name: "AI 语音",
        groupId: null,
      });
      assert.equal(created?.state, "draft");
      assert.deepEqual(
        store.list().map((feature) => [feature.id, feature.name]),
        [["feat_ai", "AI 语音"]],
      );
    } finally {
      db.close();
    }
  });

  it("refuses a duplicate id and an invalid name", () => {
    const { db, store } = createStore();
    try {
      assert.notEqual(store.create({ id: "feat_a", name: "A", groupId: null }), null);
      assert.equal(store.create({ id: "feat_a", name: "B", groupId: null }), null);
      assert.equal(store.create({ id: "feat_b", name: "   ", groupId: null }), null);
    } finally {
      db.close();
    }
  });

  it("labels a workspace and moves the label", () => {
    const { db, store } = createStore();
    try {
      store.create({ id: "feat_a", name: "A", groupId: null });
      store.create({ id: "feat_b", name: "B", groupId: null });
      assert.equal(store.label("env_1", "feat_a"), true);
      assert.deepEqual(store.labels(), { env_1: "feat_a" });
      assert.equal(store.label("env_1", "feat_b"), true);
      assert.deepEqual(store.labels(), { env_1: "feat_b" });
      assert.equal(store.label("env_1", null), true);
      assert.deepEqual(store.labels(), {});
    } finally {
      db.close();
    }
  });

  it("refuses a label for a feature that does not exist", () => {
    const { db, store } = createStore();
    try {
      assert.equal(store.label("env_1", "feat_missing"), false);
      assert.deepEqual(store.labels(), {});
    } finally {
      db.close();
    }
  });

  it("deletes a feature together with the labels pointing at it", () => {
    const { db, store } = createStore();
    try {
      store.create({ id: "feat_a", name: "A", groupId: null });
      store.label("env_1", "feat_a");
      store.label("env_2", "feat_a");
      assert.equal(store.remove("feat_a"), true);
      assert.deepEqual(store.list(), []);
      assert.deepEqual(store.labels(), {});
      const rows = db
        .prepare("SELECT COUNT(*) AS n FROM feature_workspace_labels")
        .get() as { n: number };
      assert.equal(rows.n, 0);
    } finally {
      db.close();
    }
  });

  it("moves a deleted group's features to Ungrouped", () => {
    const { db, store } = createStore();
    try {
      store.create({ id: "feat_a", name: "A", groupId: "grp_im" });
      store.create({ id: "feat_b", name: "B", groupId: "grp_ot" });
      assert.equal(store.releaseGroup("grp_im"), 1);
      assert.deepEqual(
        store.list().map((feature) => [feature.id, feature.groupId]),
        [
          ["feat_a", null],
          ["feat_b", "grp_ot"],
        ],
      );
    } finally {
      db.close();
    }
  });

  it("reorders only features that belong to the named group", () => {
    const { db, store } = createStore();
    try {
      store.create({ id: "feat_a", name: "A", groupId: "grp_im" });
      store.create({ id: "feat_b", name: "B", groupId: "grp_im" });
      store.create({ id: "feat_c", name: "C", groupId: "grp_ot" });
      assert.equal(store.reorder(["feat_b", "feat_a"], "grp_im"), true);
      assert.deepEqual(
        store.list().filter((feature) => feature.groupId === "grp_im").map((f) => f.id),
        ["feat_b", "feat_a"],
      );
    } finally {
      db.close();
    }
  });
});
