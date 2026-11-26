import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import { FEATURE_REPOSITORY_MIGRATIONS } from "../lib/stores/feature-repository.ts";
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
  NEST_MIGRATION_DISMISSED_KEY,
  NEST_MIGRATION_PREF_KEY,
  dismissNestMigrationTip,
  inspectNestMigration,
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
      ...FEATURE_REPOSITORY_MIGRATIONS,
    ].join(";\n"),
  );
  db.prepare(ORDER_REVISION_SEED).run();
}

describe("Nest -> Harbor opt-in preview & migration", () => {
  it("resolves sibling nested-sidebar/data.db paths safely", () => {
    assert.equal(resolveSiblingNestDbPath(""), null);
    assert.equal(resolveSiblingNestDbPath(":memory:"), null);
    assert.equal(
      resolveSiblingNestDbPath("/tmp/bb-plugins/harbor/data.db"),
      "/tmp/bb-plugins/nested-sidebar/data.db",
    );
  });

  it("previews groups and in-place features, respects tip dismissal, and applies selectively", () => {
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
      sourceDb
        .prepare(
          `INSERT INTO features (id, name, slug, state, position, root_path, host_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "f_nest_1",
          "Checkout Flow",
          "checkout-flow",
          "active",
          0,
          "/Users/example/NestFeatures/checkout-flow",
          "host_local",
          1500,
          1600,
        );
      sourceDb
        .prepare(
          `INSERT INTO feature_branches (feature_id, repository_path, host_id, branch, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run("f_nest_1", "/repos/acme-app", "host_local", "feat/checkout-flow", 1500);
      sourceDb
        .prepare(
          `INSERT INTO feature_workspace_labels (environment_id, feature_id, updated_at)
           VALUES (?, ?, ?)`,
        )
        .run("env_adopted", "f_nest_1", 1550);
      sourceDb
        .prepare(
          `INSERT INTO feature_briefs (feature_id, goal, non_goals, acceptance, notes, open_questions, blockers, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run("f_nest_1", "Refactor checkout", "", "Green tests", "", "[]", "[]", 1580);
      sourceDb
        .prepare(
          `INSERT INTO feature_decisions (id, feature_id, seq, title, choice, rationale, alternatives, impact, status, author, thread_id, supersedes, superseded_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "dec_1",
          "f_nest_1",
          1,
          "Keep API v1",
          "Parallel endpoints",
          "Backwards compatible",
          "[]",
          "",
          "confirmed",
          "human",
          null,
          null,
          null,
          1590,
        );
      sourceDb
        .prepare(
          `INSERT INTO feature_refs (id, feature_id, kind, ref_id, url, title, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run("ref_1", "f_nest_1", "doc", null, "https://example.com/spec", "Spec", 1595);
      sourceDb.close();
      sourceDb = undefined;

      targetDb = new Database(harborDbFile);
      setupHarborSchema(targetDb);
      const groupStore = createGroupStore(targetDb);
      groupStore.create("grp_existing", "Core", "Folder");

      const previewBefore = inspectNestMigration(targetDb);
      assert.equal(previewBefore.sourceFound, true);
      assert.equal(previewBefore.tipDismissed, false);
      assert.equal(previewBefore.hasPendingData, true);
      assert.equal(previewBefore.showTip, true);
      assert.deepEqual(previewBefore.pending, {
        groups: 2,
        memberships: 1,
        manualOrders: 1,
        badgeColors: 1,
        lifecycle: 1,
        features: 1,
        featureBranches: 1,
        featureAdoptions: 1,
        featureBriefs: 1,
        featureDecisions: 1,
        featureRefs: 1,
      });
      assert.equal(previewBefore.groups.length, 2);
      assert.equal(previewBefore.features[0]?.rootPath, "/Users/example/NestFeatures/checkout-flow");

      // Dismissing the tip hides showTip while still allowing Settings preview/migration.
      dismissNestMigrationTip(targetDb);
      const previewDismissed = inspectNestMigration(targetDb);
      assert.equal(previewDismissed.tipDismissed, true);
      assert.equal(previewDismissed.hasPendingData, true);
      assert.equal(previewDismissed.showTip, false);
      const dismissedRow = targetDb
        .prepare(`SELECT value FROM view_preferences WHERE key = ?`)
        .get(NEST_MIGRATION_DISMISSED_KEY) as { value: string };
      assert.equal(dismissedRow.value, "1");

      // Apply only Groups first (leaving Features & Extras pending).
      const groupsOnly = migrateFromNestDatabase(targetDb, {
        includeGroups: true,
        includeFeatures: false,
        includeExtras: false,
      });
      assert.equal(groupsOnly.status, "migrated");
      assert.equal(groupsOnly.imported.groups, 2);
      assert.equal(groupsOnly.imported.features, 0);
      assert.equal(groupsOnly.preview.pending.groups, 0);
      assert.equal(groupsOnly.preview.pending.features, 1);

      // Apply Features & Extras next.
      const rest = migrateFromNestDatabase(targetDb, {
        includeGroups: false,
        includeFeatures: true,
        includeExtras: true,
      });
      assert.equal(rest.status, "migrated");
      assert.equal(rest.imported.features, 1);
      assert.equal(rest.imported.featureBranches, 1);
      assert.equal(rest.imported.featureAdoptions, 1);
      assert.equal(rest.imported.featureBriefs, 1);
      assert.equal(rest.imported.featureDecisions, 1);
      assert.equal(rest.imported.featureRefs, 1);
      assert.equal(rest.imported.badgeColors, 1);
      assert.equal(rest.imported.lifecycle, 1);
      assert.equal(rest.preview.hasPendingData, false);
      assert.equal(rest.preview.showTip, false);

      // In-place root_path and parent container are preserved without moving directories.
      const featureRow = targetDb
        .prepare(`SELECT id, name, root_path, host_id FROM features WHERE id = 'f_nest_1'`)
        .get() as { id: string; name: string; root_path: string; host_id: string };
      assert.equal(featureRow.root_path, "/Users/example/NestFeatures/checkout-flow");
      const containerRow = targetDb
        .prepare(`SELECT path FROM feature_containers WHERE path = '/Users/example/NestFeatures'`)
        .get() as { path: string } | undefined;
      assert.equal(containerRow?.path, "/Users/example/NestFeatures");

      assert.deepEqual(groupStore.list(), [
        { id: "grp_existing", name: "Core", position: 0, icon: "Folder" },
        { id: "grp_work", name: "Work", position: 1, icon: "Settings" },
        { id: "grp_side", name: "Side", position: 2, icon: "Puzzle" },
      ]);
      assert.deepEqual(groupStore.assignments(), { proj_acme: "grp_work" });

      const orderStore = createOrderStore(targetDb);
      assert.deepEqual(orderStore.list().projects, { grp_work: ["proj_acme"] });
      assert.equal(orderStore.revision(), 1);

      const colorStore = createProjectColorStore(targetDb);
      assert.deepEqual(colorStore.list(), [
        { projectId: "proj_acme", color: "#123456" },
      ]);

      const marker = targetDb
        .prepare(`SELECT value FROM view_preferences WHERE key = ?`)
        .get(NEST_MIGRATION_PREF_KEY) as { value: string };
      assert.equal(marker.value, "1");

      // Re-running after everything is present reports nothing-to-migrate idempotently.
      const repeat = migrateFromNestDatabase(targetDb);
      assert.equal(repeat.status, "nothing-to-migrate");
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
      const preview = inspectNestMigration(memoryDb);
      assert.equal(preview.sourceFound, false);
      assert.equal(preview.showTip, false);
      const report = migrateFromNestDatabase(memoryDb);
      assert.equal(report.status, "source-missing");
    } finally {
      memoryDb.close();
    }
  });
});
