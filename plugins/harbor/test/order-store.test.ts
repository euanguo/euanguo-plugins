import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import {
  MANUAL_ORDER_MIGRATION,
  ORDER_REVISION_MIGRATION,
  ORDER_REVISION_SEED,
  createOrderStore,
} from "../lib/stores/order-store.ts";

function createStore() {
  const db = new Database(":memory:");
  db.exec(MANUAL_ORDER_MIGRATION);
  db.exec(ORDER_REVISION_MIGRATION);
  db.prepare(ORDER_REVISION_SEED).run();
  return { db, store: createOrderStore(db) };
}

describe("manual order store", () => {
  it("round-trips one scope per kind and drops rows on delete", () => {
    const { db, store } = createStore();
    try {
      assert.equal(store.setProjectOrder("g1", ["p2", "p1"], 0).ok, true);
      assert.equal(store.setFamilyOrder("p1", ["t2", "t1"], 1).ok, true);
      assert.deepEqual(store.list(), {
        projects: { g1: ["p2", "p1"] },
        families: { p1: ["t2", "t1"] },
        workspaces: {},
      });
      store.removeGroup("g1");
      store.removeProject("p1");
      assert.deepEqual(store.list(), {
        projects: {},
        families: {},
        workspaces: {},
      });

      // The worktrees of a project are their own scope, beside its threads.
      const afterRemovals = store.revision();
      assert.equal(
        store.setWorkspaceOrder("p1", ["env_a", "env_b"], afterRemovals).ok,
        true,
      );
      assert.deepEqual(store.list().workspaces, { p1: ["env_a", "env_b"] });
      assert.equal(
        store.setWorkspaceOrder(
          "p1",
          ["env_b", "env_a"],
          store.revision(),
        ).ok,
        true,
      );
      assert.deepEqual(store.list().workspaces, { p1: ["env_b", "env_a"] });
      assert.equal(
        store.setWorkspaceOrder("p1", ["env_a", "env_a"], store.revision()).ok,
        false,
      );
    } finally {
      db.close();
    }
  });

  it("rejects duplicate ids and blank scopes", () => {
    const { db, store } = createStore();
    try {
      assert.equal(store.setProjectOrder("g1", ["p1", "p1"], 0).ok, false);
      assert.equal(store.setProjectOrder("", ["p1"], 0).ok, false);
      assert.equal(store.setFamilyOrder("p1", ["t1", "t1"], 0).ok, false);
      assert.deepEqual(store.list(), {
        projects: {},
        families: {},
        workspaces: {},
      });
    } finally {
      db.close();
    }
  });

  it("skips a stored column this build cannot read", () => {
    const { db, store } = createStore();
    try {
      db.prepare(
        `INSERT INTO manual_order (scope_kind, scope_id, item_ids, updated_at)
         VALUES (?, ?, ?, ?)`,
      ).run("group", "g1", "not json", 0);
      assert.deepEqual(store.list().projects, {});
    } finally {
      db.close();
    }
  });
});

/**
 * The arrangement is shared — it follows the user across machines — and two
 * clients holding it at once is the normal case, not the exotic one: the sidebar
 * is open on a desktop and in a browser. Without a revision the second window's
 * drag silently discards the first's, and the user watches their arrangement
 * revert for no reason they can name.
 */
describe("the order revision", () => {
  it("starts at zero and advances with every write", () => {
    const { db, store } = createStore();
    try {
      assert.equal(store.revision(), 0);
      assert.equal(store.setProjectOrder("g1", ["p1"], 0).revision, 1);
      assert.equal(store.setFamilyOrder("p1", ["t1"], 1).revision, 2);
      assert.equal(store.setWorkspaceOrder("p1", ["env_a"], 2).revision, 3);
      assert.equal(store.revision(), 3);
    } finally {
      db.close();
    }
  });

  it("refuses a write built on an arrangement someone else changed", () => {
    const { db, store } = createStore();
    try {
      store.setProjectOrder("g1", ["p1"], 0);
      // Another client wrote, so this one's revision is behind.
      const stale = store.setFamilyOrder("p1", ["t1"], 0);
      assert.deepEqual(stale, { ok: false, reason: "stale", revision: 1 });
      // And nothing was written: a refused move is not a partial one.
      assert.deepEqual(store.list().families, {});
    } finally {
      db.close();
    }
  });

  it("accepts the same write once the caller is current again", () => {
    const { db, store } = createStore();
    try {
      store.setProjectOrder("g1", ["p1"], 0);
      assert.equal(store.setFamilyOrder("p1", ["t1"], store.revision()).ok, true);
      assert.deepEqual(store.list().families, { p1: ["t1"] });
    } finally {
      db.close();
    }
  });

  it("reports a refusal's reason, so a stale one is distinguishable", () => {
    const { db, store } = createStore();
    try {
      const invalid = store.setProjectOrder("g1", ["p1", "p1"], 0);
      assert.equal(invalid.ok, false);
      assert.equal(invalid.ok === false && invalid.reason, "invalid");
      // An invalid write does not advance the counter, so the caller's revision
      // is still the one to retry from.
      assert.equal(store.revision(), 0);
    } finally {
      db.close();
    }
  });

  /**
   * A removal changes the arrangement, so it bumps. A client holding the
   * pre-removal revision must not be allowed to write the list it read: the row
   * it is moving may be the one that just went away.
   */
  it("advances when a group or a project is removed", () => {
    const { db, store } = createStore();
    try {
      store.setProjectOrder("g1", ["p1"], 0);
      const before = store.revision();
      store.removeGroup("g1");
      assert.equal(store.revision(), before + 1);
      store.removeProject("p1");
      assert.equal(store.revision(), before + 2);
      const refused = store.setProjectOrder("g1", ["p1"], before);
      assert.equal(refused.ok, false);
      assert.equal(refused.ok === false && refused.reason, "stale");
    } finally {
      db.close();
    }
  });

  it("reads as zero on a database that has no counter row yet", () => {
    const db = new Database(":memory:");
    db.exec(MANUAL_ORDER_MIGRATION);
    db.exec(ORDER_REVISION_MIGRATION);
    try {
      // No seed: the read is a miss rather than a crash, which is what a
      // database from before this table existed would look like.
      assert.equal(createOrderStore(db).revision(), 0);
    } finally {
      db.close();
    }
  });
});

describe("atomic revision guard", () => {
  it("never mutates rows or bumps revision on invalid inputs or stale baseRevision", () => {
    const db = new Database(":memory:");
    db.exec(MANUAL_ORDER_MIGRATION);
    db.exec(ORDER_REVISION_MIGRATION);
    db.prepare(ORDER_REVISION_SEED).run();
    try {
      const store = createOrderStore(db);
      const r0 = store.revision();

      // Invalid scope / duplicate IDs are rejected without bumping revision.
      assert.deepEqual(store.setProjectOrder("", ["proj_1"], r0), {
        ok: false,
        reason: "invalid",
        revision: r0,
      });
      assert.deepEqual(store.setFamilyOrder("proj_1", ["thr_1", "thr_1"], r0), {
        ok: false,
        reason: "invalid",
        revision: r0,
      });
      assert.equal(store.revision(), r0);
      assert.deepEqual(store.list(), { projects: {}, families: {}, workspaces: {} });

      // Valid project order write bumps revision by 1.
      const w1 = store.setProjectOrder("group_a", ["proj_1", "proj_2"], r0);
      assert.deepEqual(w1, { ok: true, revision: r0 + 1 });

      // Stale baseRevision never mutates existing rows or bumps revision.
      const staleProject = store.setProjectOrder("group_a", ["proj_2", "proj_1"], r0);
      assert.deepEqual(staleProject, { ok: false, reason: "stale", revision: r0 + 1 });
      const staleFamily = store.setFamilyOrder("proj_1", ["thr_a"], r0);
      assert.deepEqual(staleFamily, { ok: false, reason: "stale", revision: r0 + 1 });
      const staleWorkspace = store.setWorkspaceOrder("proj_1", ["ws_a"], r0);
      assert.deepEqual(staleWorkspace, { ok: false, reason: "stale", revision: r0 + 1 });
      assert.equal(store.revision(), r0 + 1);
      assert.deepEqual(store.list().projects, { group_a: ["proj_1", "proj_2"] });

      // Sequential valid writes across projects, families, and workspaces bump +1 each.
      const w2 = store.setFamilyOrder("proj_1", ["thr_a", "thr_b"], r0 + 1);
      assert.deepEqual(w2, { ok: true, revision: r0 + 2 });
      const w3 = store.setWorkspaceOrder("proj_1", ["ws_b", "ws_a"], r0 + 2);
      assert.deepEqual(w3, { ok: true, revision: r0 + 3 });

      // Invalid input with valid current revision still leaves revision intact.
      const invalidWorkspace = store.setWorkspaceOrder("proj_1", [" ws_bad "], r0 + 3);
      assert.deepEqual(invalidWorkspace, { ok: false, reason: "invalid", revision: r0 + 3 });
      assert.equal(store.revision(), r0 + 3);
      assert.deepEqual(store.list(), {
        projects: { group_a: ["proj_1", "proj_2"] },
        families: { proj_1: ["thr_a", "thr_b"] },
        workspaces: { proj_1: ["ws_b", "ws_a"] },
      });
    } finally {
      db.close();
    }
  });
});