import type Database from "better-sqlite3";

/** The hash recorded by the short-lived 0.1.1 migration ordering bug. */
const LEGACY_ICON_MIGRATION_HASH =
  "f47676554e16a5cb2784c74d3b2d16cf2252360bfd75beb5342924fd5b5e6e97";

function recordedMigration(
  db: Database.Database,
  id: number,
): string | null | undefined {
  const table = db
    .prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_bb_migrations'",
    )
    .get();
  if (table === undefined) return undefined;

  const row = db
    .prepare<[number], { statement_hash: string | null }>(
      "SELECT statement_hash FROM _bb_migrations WHERE id = ?",
    )
    .get(id);
  return row?.statement_hash;
}

/**
 * Keeps the migration journal append-only across the brief bad 0.1.1 release.
 * New databases use the supplied canonical sequence. A database that proves
 * it already applied the old index 4 uses that same order so bb's hash check
 * can continue at index 5 and finish the migration safely.
 */
export function nestMigrations(
  db: Database.Database,
  migrations: readonly string[],
): string[] {
  if (migrations.length < 6) return [...migrations];
  if (recordedMigration(db, 4) !== LEGACY_ICON_MIGRATION_HASH) {
    return [...migrations];
  }

  const compatible = [...migrations];
  [compatible[4], compatible[5]] = [compatible[5], compatible[4]];
  return compatible;
}
