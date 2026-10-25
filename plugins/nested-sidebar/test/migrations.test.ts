import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import { nestMigrations } from "../lib/migrations.ts";

const LEGACY_ICON_MIGRATION_HASH =
  "f47676554e16a5cb2784c74d3b2d16cf2252360bfd75beb5342924fd5b5e6e97";

function databaseWithMigration(id: number, statementHash: string | null) {
  const db = new Database(":memory:");
  db.exec(
    "CREATE TABLE _bb_migrations (id INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL, statement_hash TEXT)",
  );
  db.prepare(
    "INSERT INTO _bb_migrations (id, applied_at, statement_hash) VALUES (?, ?, ?)",
  ).run(id, Date.now(), statementHash);
  return db;
}

describe("plugin migration compatibility", () => {
  it("keeps the canonical order for new databases", () => {
    const db = new Database(":memory:");
    const migrations = ["base-0", "base-1", "base-2", "base-3", "assignment", "icon"];

    assert.deepEqual(nestMigrations(db, migrations), migrations);
    db.close();
  });

  it("replays the legacy order for databases affected by the old release", () => {
    const db = databaseWithMigration(4, LEGACY_ICON_MIGRATION_HASH);
    const migrations = ["base-0", "base-1", "base-2", "base-3", "assignment", "icon"];

    assert.deepEqual(nestMigrations(db, migrations), [
      "base-0",
      "base-1",
      "base-2",
      "base-3",
      "icon",
      "assignment",
    ]);
    db.close();
  });
});
