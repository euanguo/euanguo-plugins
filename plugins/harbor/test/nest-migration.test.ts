import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import {
  GROUP_ASSIGNMENT_MIGRATION,
  GROUP_MIGRATION,
  createGroupStore,
} from "../lib/stores/group-store.ts";
import {
  MANUAL_ORDER_MIGRATION,
  ORDER_REVISION_MIGRATION,
  ORDER_REVISION_SEED,
  createOrderStore,
} from "../lib/stores/order-store.ts";
import {
  PROJECT_COLOR_MIGRATION,
  createProjectColorStore,
} from "../lib/stores/project-color-store.ts";
import { VIEW_PREFERENCE_MIGRATION } from "../lib/stores/view-preference-store.ts";
import {
  NEST_MIGRATION_PREF_KEY,
  migrateFromNestDatabase,
  resolveSiblingNestDbPath,
} from "../lib/stores/nest-migration.ts";

const LIFECYCLE_MIGRATION = `CREATE TABLE IF NOT EXISTS thread_lifecycle (
  thread_id           TEXT PRIMARY KEY,
  settled_at          INTEGER,
  snoozed_until       INTEGER,
  snoozed_at          INTEGER,
  archived_thread_ids TEXT
)`;

function setupHarborSchema(db: Database.Database): void {
  db.exec(
    [
      LIFECYCLE_MIGRATION,
      PROJECT_COLOR_MIGRATION,
      GROUP_MIGRATION,
      GROUP_ASSIGNMENT_MIGRATION,
      MANUAL_ORDER_MIGRATION,
      ORDER_REVISION_MIGRATION,
      VIEW_PREFERENCE_MIGRATION,
    ].join(";\n"),
  );
  db.prepare(ORDER_REVISION_SEED).run();
}

describe("Nest -> Harbor automatic migration", () => {
  it("resolves sibling nested-sidebar/data.db paths safely", () => {
    assert.equal(resolveSiblingNestDbPath(""), null);
    assert.equal(resolveSiblingNestDbPath(":memory:"), null);
    assert.equal(
      resolveSiblingNestDbPath("/tmp/bb-plugins/harbor/data.db"),
      "/tmp/bb-plugins/nested-sidebar/data.db",
    );
  });

  it("imports groups, assignments, manual orders, badge colors, and lifecycle idempotently", () => {
    const rootDir = mkdtempSync(path.join(os.tmpdir(), "harbor-nest-mig-"));
    let sourceDb: Database.Database | undefined;
    let targetDb: Database.Database | undefined;

    try {
      const nestDir = path.join(rootDir, "nested-sidebar");
      const harborDir = path.join(rootDir, "harbor");
      mkdirSync(nestDir, { recursive: true });
      mkdirSync(harborDir, { recursive: true });

      const nestDbFile = path.join(nestDir, "data.db");
      const harborDbFile = path.join(harborDir, "data.db");

      sourceDb = new Database(nestDbFile);
      setupHarborSchema(sourceDb);
      sourceDb
        .prepare(
          `INSERT INTO project_groups (id, name, position, updated_at, icon)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run("grp_work", "Work", 0, 1000, "⚙️");
      sourceDb
        .prepare(
          `INSERT INTO project_groups (id, name, position, updated_at, icon)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run("grp_side", "Side", 1, 1001, "💡");
      sourceDb
        .prepare(
          `INSERT INTO project_group_members (project_id, group_id, updated_at)
           VALUES (?, ?, ?)`,
        )
        .run("proj_acme", "grp_work", 1002);
      sourceDb
        .prepare(
          `INSERT INTO project_group_members (project_id, group_id, updated_at)
           VALUES (?, ?, ?)`,
        )
        .run("proj_orphan", "grp_missing", 1003);
      sourceDb
        .prepare(
          `INSERT INTO manual_order (scope_kind, scope_id, item_ids, updated_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run("group", "grp_work", JSON.stringify(["proj_acme"]), 1004);
      sourceDb
        .prepare(
          `INSERT INTO project_badge_colors (project_id, color, updated_at)
           VALUES (?, ?, ?)`,
        )
        .run("proj_acme", "#123456", 1005);
      sourceDb
        .prepare(
          `INSERT INTO thread_lifecycle (thread_id, settled_at, snoozed_until, snoozed_at, archived_thread_ids)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run("thr_1", 2000, null, null, JSON.stringify(["thr_1", "thr_2"]));
      sourceDb.close();
      sourceDb = undefined;

      targetDb = new Database(harborDbFile);
      setupHarborSchema(targetDb);
      // Pre-seed one existing Harbor group so position offset preserves it cleanly.
      const groupStore = createGroupStore(targetDb);
      groupStore.create("grp_existing", "Core", "Folder");

      const first = migrateFromNestDatabase(targetDb);
      assert.deepEqual(first, {
        status: "migrated",
        groups: 2,
        memberships: 1,
        manualOrders: 1,
        badgeColors: 1,
        lifecycle: 1,
      });

      assert.deepEqual(
        groupStore.list(),
        [
          { id: "grp_existing", name: "Core", position: 0, icon: "Folder" },
          { id: "grp_work", name: "Work", position: 1, icon: "Settings" },
          { id: "grp_side", name: "Side", position: 2, icon: "Puzzle" },
        ],
      );
      assert.deepEqual(groupStore.assignments(), { proj_acme: "grp_work" });

      const orderStore = createOrderStore(targetDb);
      assert.deepEqual(orderStore.list().projects, { grp_work: ["proj_acme"] });
      assert.equal(orderStore.revision(), 1);

      const colorStore = createProjectColorStore(targetDb);
      assert.deepEqual(colorStore.list(), [
        { projectId: "proj_acme", color: "#123456" },
      ]);

      const lifecycleRow = targetDb
        .prepare(`SELECT thread_id, settled_at, archived_thread_ids FROM thread_lifecycle`)
        .get() as { thread_id: string; settled_at: number; archived_thread_ids: string };
      assert.deepEqual(lifecycleRow, {
        thread_id: "thr_1",
        settled_at: 2000,
        archived_thread_ids: '["thr_1","thr_2"]',
      });

      const marker = targetDb
        .prepare(`SELECT value FROM view_preferences WHERE key = ?`)
        .get(NEST_MIGRATION_PREF_KEY) as { value: string };
      assert.equal(marker.value, "1");

      // Subsequent boots skip migration immediately without modifying data.
      const second = migrateFromNestDatabase(targetDb);
      assert.equal(second.status, "already-done");
    } finally {
      sourceDb?.close();
      targetDb?.close();
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("handles missing or memory databases safely without throwing", () => {
    const memoryDb = new Database(":memory:");
    try {
      setupHarborSchema(memoryDb);
      const report = migrateFromNestDatabase(memoryDb);
      assert.equal(report.status, "source-missing");
    } finally {
      memoryDb.close();
    }
  });
});
