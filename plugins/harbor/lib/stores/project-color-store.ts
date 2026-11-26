import type Database from "better-sqlite3";
import {
  MAX_PROJECT_COLOR_ROWS,
  canonicalProjectColor,
  validProjectId,
} from "../domain/project-colors.ts";
import { collectValidRows, readTableCount, rowExists } from "./sqlite-helpers.ts";

export const PROJECT_COLOR_MIGRATION = `CREATE TABLE IF NOT EXISTS project_badge_colors (
  project_id TEXT PRIMARY KEY,
  color      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
)`;

export interface StoredProjectColor {
  projectId: string;
  color: string;
}

interface ProjectColorRow {
  project_id: unknown;
  color: unknown;
}

export function createProjectColorStore(db: Database.Database) {
  const existsStmt = db.prepare(
    `SELECT 1 FROM project_badge_colors WHERE project_id = ?`,
  );

  const list = (): StoredProjectColor[] => {
    const rows = db
      .prepare(
        `SELECT project_id, color
           FROM project_badge_colors
          ORDER BY updated_at DESC, project_id ASC
          LIMIT ?`,
      )
      .all(MAX_PROJECT_COLOR_ROWS + 1) as ProjectColorRow[];
    return collectValidRows(rows, MAX_PROJECT_COLOR_ROWS, (row) => {
      const color = canonicalProjectColor(row.color);
      return !validProjectId(row.project_id) || color === null
        ? null
        : { projectId: row.project_id, color };
    });
  };

  const set = (
    projectId: string,
    rawColor: string,
    updatedAt = Date.now(),
  ): StoredProjectColor => {
    const color = canonicalProjectColor(rawColor);
    if (!validProjectId(projectId) || color === null) {
      throw new Error("Invalid project badge color.");
    }
    if (
      !rowExists(existsStmt, projectId) &&
      readTableCount(db, "project_badge_colors") >= MAX_PROJECT_COLOR_ROWS
    ) {
      throw new Error("Project badge color limit reached.");
    }
    db.prepare(
      `INSERT INTO project_badge_colors (project_id, color, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET
         color = excluded.color,
         updated_at = excluded.updated_at`,
    ).run(projectId, color, updatedAt);
    return { projectId, color };
  };

  const reset = (projectId: string): boolean => {
    if (!validProjectId(projectId)) return false;
    return (
      db
        .prepare(`DELETE FROM project_badge_colors WHERE project_id = ?`)
        .run(projectId).changes > 0
    );
  };

  return { list, reset, set };
}
