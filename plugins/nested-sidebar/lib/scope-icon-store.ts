import type Database from "better-sqlite3";
import { canonicalGroupIcon, type GroupIconName } from "./group-icons.ts";
import {
  DEFAULT_SCOPE_ICONS,
  SCOPE_ICON_KEYS,
  type ScopeIconScope,
  type ScopeIcons,
} from "./group-scope-icons.ts";

export const SCOPE_ICON_MIGRATION = `CREATE TABLE IF NOT EXISTS scope_icons (
  scope_key  TEXT PRIMARY KEY,
  icon       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
)`;

interface ScopeIconRow {
  scope_key: unknown;
  icon: unknown;
}

/**
 * Icons for the strip's own two tabs.
 *
 * Kept apart from `project_groups` because these are not groups: they hold no
 * projects, cannot be renamed, reordered, or deleted, and their keys are fixed.
 * A read answers for both scopes whether or not the user has chosen one, so the
 * strip never has to know which of them is stored.
 */
export function createScopeIconStore(db: Database.Database) {
  const list = (): ScopeIcons => {
    const rows = db
      .prepare(`SELECT scope_key, icon FROM scope_icons`)
      .all() as ScopeIconRow[];
    const stored = new Map<string, GroupIconName>();
    for (const row of rows) {
      if (typeof row.scope_key !== "string") continue;
      stored.set(row.scope_key, canonicalGroupIcon(row.icon));
    }
    return {
      all: stored.get(SCOPE_ICON_KEYS.all) ?? DEFAULT_SCOPE_ICONS.all,
      ungrouped:
        stored.get(SCOPE_ICON_KEYS.ungrouped) ?? DEFAULT_SCOPE_ICONS.ungrouped,
    };
  };

  /** One row per scope, replaced in place; an unknown icon falls back. */
  const set = (
    scope: ScopeIconScope,
    icon: unknown,
    now = Date.now(),
  ): boolean => {
    db.prepare(
      `INSERT INTO scope_icons (scope_key, icon, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(scope_key) DO UPDATE SET
         icon = excluded.icon, updated_at = excluded.updated_at`,
    ).run(SCOPE_ICON_KEYS[scope], canonicalGroupIcon(icon), now);
    return true;
  };

  return { list, set };
}
