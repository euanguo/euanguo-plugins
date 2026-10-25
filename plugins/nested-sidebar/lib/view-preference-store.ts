/**
 * How the tree is drawn, stored server-side.
 *
 * These belong with the plugin's other settings, but the frontend can only
 * *read* `bb.settings` — so a choice made from the sidebar's view menu has to
 * be written by the plugin itself. This table is that write path. Values are
 * validated on read as well as write, so a row written by an older build (or a
 * hand-edited database) degrades to the default instead of breaking the tree.
 */

import type Database from "better-sqlite3";
import {
  DEFAULT_ORGANIZATION_MODE,
  validOrganizationMode,
  type OrganizationMode,
} from "./organization.ts";
import {
  DEFAULT_PROJECT_SORT,
  DEFAULT_THREAD_SORT,
  DEFAULT_WORKTREE_SORT,
  validProjectSort,
  validThreadSort,
  validWorktreeSort,
  type ProjectSortMode,
  type ThreadSortMode,
  type WorktreeSortMode,
} from "./sort-modes.ts";

export const VIEW_PREFERENCE_MIGRATION = `CREATE TABLE IF NOT EXISTS view_preferences (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
)`;

export interface StoredViewPreferences {
  readonly projectSort: ProjectSortMode;
  readonly threadSort: ThreadSortMode;
  readonly worktreeSort: WorktreeSortMode;
  /**
   * What the tree's first level is: the user's groups, or the machines their
   * projects live on. Stored here rather than in `bb.settings` for the same
   * reason the sort modes are — the view menu owns the choice and the frontend
   * cannot write settings.
   */
  readonly organizationMode: OrganizationMode;
}

interface PreferenceRow {
  key: unknown;
  value: unknown;
}

export function createViewPreferenceStore(db: Database.Database) {
  const readAll = (): Record<string, string> => {
    const rows = db
      .prepare(`SELECT key, value FROM view_preferences`)
      .all() as PreferenceRow[];
    const values: Record<string, string> = {};
    for (const row of rows) {
      if (typeof row.key === "string" && typeof row.value === "string") {
        values[row.key] = row.value;
      }
    }
    return values;
  };

  const get = (): StoredViewPreferences => {
    const values = readAll();
    return {
      projectSort: validProjectSort(values.projectSort)
        ? values.projectSort
        : DEFAULT_PROJECT_SORT,
      threadSort: validThreadSort(values.threadSort)
        ? values.threadSort
        : DEFAULT_THREAD_SORT,
      worktreeSort: validWorktreeSort(values.worktreeSort)
        ? values.worktreeSort
        : DEFAULT_WORKTREE_SORT,
      organizationMode: validOrganizationMode(values.organizationMode)
        ? values.organizationMode
        : DEFAULT_ORGANIZATION_MODE,
    };
  };

  const set = (patch: {
    projectSort?: ProjectSortMode;
    threadSort?: ThreadSortMode;
    worktreeSort?: WorktreeSortMode;
    organizationMode?: OrganizationMode;
  }): StoredViewPreferences => {
    const statement = db.prepare(
      `INSERT INTO view_preferences (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value, updated_at = excluded.updated_at`,
    );
    const now = Date.now();
    const run = db.transaction(() => {
      if (patch.projectSort !== undefined && validProjectSort(patch.projectSort)) {
        statement.run("projectSort", patch.projectSort, now);
      }
      if (patch.threadSort !== undefined && validThreadSort(patch.threadSort)) {
        statement.run("threadSort", patch.threadSort, now);
      }
      if (
        patch.worktreeSort !== undefined &&
        validWorktreeSort(patch.worktreeSort)
      ) {
        statement.run("worktreeSort", patch.worktreeSort, now);
      }
      if (
        patch.organizationMode !== undefined &&
        validOrganizationMode(patch.organizationMode)
      ) {
        statement.run("organizationMode", patch.organizationMode, now);
      }
    });
    run();
    return get();
  };

  return { get, set };
}
