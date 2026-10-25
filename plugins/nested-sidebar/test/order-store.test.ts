import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import { UNGROUPED_ORDER_SCOPE } from "../lib/manual-order.ts";
import {
  MANUAL_ORDER_MIGRATION,
  ORDER_REVISION_MIGRATION,
  ORDER_REVISION_SEED,
  createOrderStore,
} from "../lib/order-store.ts";

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

  it("seeds the legacy global order by splitting it over groups", () => {
    const { db, store } = createStore();
    try {
      const seeded = store.seed(
        { projectIds: ["p3", "p1", "p2"], families: { p1: ["t1"] } },
        { p1: "g1", p2: "g1" },
      );
      assert.equal(seeded, true);
      assert.deepEqual(store.list(), {
        projects: { g1: ["p1", "p2"], [UNGROUPED_ORDER_SCOPE]: ["p3"] },
        families: { p1: ["t1"] },
        workspaces: {},
      });
      // A second device must not overwrite an arrangement already in place.
      assert.equal(store.seed({ projectIds: ["p9"], families: {} }, {}), false);
      assert.deepEqual(store.list().projects.g1, ["p1", "p2"]);
    } finally {
      db.close();
    }
  });

  it("does nothing when there is nothing to seed", () => {
    const { db, store } = createStore();
    try {
      assert.equal(store.seed({ projectIds: [], families: {} }, {}), false);
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