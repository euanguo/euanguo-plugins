import type Database from "better-sqlite3";
import { validProjectId } from "./project-colors.ts";
import {
  MAX_PROJECT_ICON_ROWS,
  canonicalProjectIcon,
  type ProjectIcon,
} from "./project-icons.ts";

/**
 * A `src` of NULL is a row that says "probed, found nothing". Storing the miss
 * is the point: without it every sidebar mount would walk a hundred candidate
 * paths per project to reach the same answer, and the badge is drawn before any
 * of that finishes.
 *
 * The source the probe ran against is stored beside it, so the row is only
 * believed while the project points at the same checkout on the same machine.
 * Moving a project's source is not an edit to this table, and a stale icon
 * under a new checkout is exactly the kind of wrong fact the letter badge
 * never had.
 */
export const PROJECT_ICON_MIGRATION = `CREATE TABLE IF NOT EXISTS project_icons (
  project_id     TEXT PRIMARY KEY,
  src            TEXT,
  label          TEXT,
  source         TEXT,
  source_path    TEXT,
  source_host_id TEXT,
  updated_at     INTEGER NOT NULL
)`;

export interface ProjectIconRecord {
  projectId: string;
  /** null is a stored miss. */
  icon: ProjectIcon | null;
  sourcePath: string | null;
  sourceHostId: string | null;
}

export interface StoredProjectIconRow extends ProjectIconRecord {
  updatedAt: number;
}

interface ProjectIconDbRow {
  project_id: unknown;
  src: unknown;
  label: unknown;
  source: unknown;
  source_path: unknown;
  source_host_id: unknown;
  updated_at: unknown;
}

function readRow(row: ProjectIconDbRow): StoredProjectIconRow | null {
  if (!validProjectId(row.project_id)) return null;
  const updatedAt = typeof row.updated_at === "number" ? row.updated_at : 0;
  const sourcePath = typeof row.source_path === "string" ? row.source_path : null;
  const sourceHostId =
    typeof row.source_host_id === "string" ? row.source_host_id : null;
  // A miss carries no src at all; anything else has to survive the same guard
  // every other consumer of an icon uses.
  if (row.src === null || row.src === undefined) {
    return {
      projectId: row.project_id,
      icon: null,
      sourcePath,
      sourceHostId,
      updatedAt,
    };
  }
  const icon = canonicalProjectIcon({
    src: row.src,
    label: row.label,
    source: row.source,
  });
  if (icon === null) return null;
  return { projectId: row.project_id, icon, sourcePath, sourceHostId, updatedAt };
}

export function createProjectIconStore(db: Database.Database) {
  /** Every row this build can still read, newest first under the cap. */
  const list = (): StoredProjectIconRow[] => {
    const rows = db
      .prepare(
        `SELECT project_id, src, label, source, source_path, source_host_id,
                updated_at
           FROM project_icons
          ORDER BY updated_at DESC, project_id ASC
          LIMIT ?`,
      )
      .all(MAX_PROJECT_ICON_ROWS + 1) as ProjectIconDbRow[];
    const icons: StoredProjectIconRow[] = [];
    for (const row of rows) {
      const parsed = readRow(row);
      // An unreadable row is dropped rather than skipped: the client will
      // probe that project again and overwrite it.
      if (parsed === null) continue;
      icons.push(parsed);
      if (icons.length === MAX_PROJECT_ICON_ROWS) break;
    }
    return icons;
  };

  const get = (projectId: string): StoredProjectIconRow | undefined => {
    if (!validProjectId(projectId)) return undefined;
    const row = db
      .prepare(
        `SELECT project_id, src, label, source, source_path, source_host_id,
                updated_at
           FROM project_icons
          WHERE project_id = ?`,
      )
      .get(projectId) as ProjectIconDbRow | undefined;
    return row === undefined ? undefined : (readRow(row) ?? undefined);
  };

  const set = (
    row: ProjectIconRecord,
    now = Date.now(),
  ): StoredProjectIconRow => {
    if (!validProjectId(row.projectId)) {
      throw new Error("Invalid project id.");
    }
    const existing = db
      .prepare(`SELECT 1 FROM project_icons WHERE project_id = ?`)
      .get(row.projectId);
    if (existing === undefined) {
      const count = db
        .prepare(`SELECT COUNT(*) AS count FROM project_icons`)
        .get() as { count: number };
      if (count.count >= MAX_PROJECT_ICON_ROWS) {
        throw new Error("Project icon limit reached.");
      }
    }
    db.prepare(
      `INSERT INTO project_icons
         (project_id, src, label, source, source_path, source_host_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET
         src = excluded.src,
         label = excluded.label,
         source = excluded.source,
         source_path = excluded.source_path,
         source_host_id = excluded.source_host_id,
         updated_at = excluded.updated_at`,
    ).run(
      row.projectId,
      row.icon?.src ?? null,
      row.icon?.label ?? null,
      row.icon?.source ?? null,
      row.sourcePath,
      row.sourceHostId,
      now,
    );
    return { ...row, updatedAt: now };
  };

  const drop = (projectId: string): boolean => {
    if (!validProjectId(projectId)) return false;
    return (
      db.prepare(`DELETE FROM project_icons WHERE project_id = ?`).run(projectId)
        .changes > 0
    );
  };

  return { drop, get, list, set };
}
