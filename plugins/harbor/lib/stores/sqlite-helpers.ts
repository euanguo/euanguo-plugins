/**
 * Shared SQLite row-reading and JSON-parsing helpers for Harbor stores.
 */
import type Database from "better-sqlite3";

const SQL_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

export function parseJsonValue(raw: unknown): unknown {
  if (typeof raw !== "string") return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function parseJsonStringArray(raw: unknown): string[] {
  const parsed = parseJsonValue(raw);
  return Array.isArray(parsed)
    ? parsed.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export function readTableCount(db: Database.Database, table: string): number {
  if (!SQL_IDENTIFIER.test(table)) {
    throw new Error(`Invalid SQLite table name: ${table}`);
  }
  const row = db
    .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
    .get() as { count: number } | undefined;
  return row?.count ?? 0;
}

export function rowExists(
  stmt: Database.Statement,
  ...params: unknown[]
): boolean {
  return stmt.get(...params) !== undefined;
}

export function collectValidRows<Row, Out>(
  rows: readonly Row[],
  limit: number,
  decode: (row: Row) => Out | null,
): Out[] {
  const out: Out[] = [];
  for (const row of rows) {
    const parsed = decode(row);
    if (parsed === null) continue;
    out.push(parsed);
    if (out.length === limit) break;
  }
  return out;
}
