import type Database from "better-sqlite3";
import {
  MAX_GROUPS,
  canonicalGroupName,
  DEFAULT_GROUP_ICON,
  canonicalGroupIcon,
  validGroupIcon,
  validGroupId,
  validGroupName,
  type GroupAssignment,
  type ProjectGroup,
} from "./groups.ts";
import { validProjectId } from "./project-colors.ts";

export const GROUP_MIGRATION = `CREATE TABLE IF NOT EXISTS project_groups (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`;

export const GROUP_ASSIGNMENT_MIGRATION = `CREATE TABLE IF NOT EXISTS project_group_members (
  project_id TEXT PRIMARY KEY,
  group_id   TEXT NOT NULL,
  updated_at INTEGER NOT NULL
)`;

interface GroupRow {
  id: unknown;
  name: unknown;
  position: unknown;
  icon: unknown;
}

interface MemberRow {
  project_id: unknown;
  group_id: unknown;
}

export function createGroupStore(db: Database.Database) {
  const list = (): ProjectGroup[] => {
    const rows = db
      .prepare(
        `SELECT id, name, position, icon FROM project_groups
          ORDER BY position ASC, name ASC LIMIT ?`,
      )
      .all(MAX_GROUPS + 1) as GroupRow[];
    const groups: ProjectGroup[] = [];
    for (const row of rows) {
      if (!validGroupId(row.id) || !validGroupName(row.name)) continue;
      const position =
        typeof row.position === "number" && Number.isFinite(row.position)
          ? row.position
          : groups.length;
      groups.push({
        id: row.id,
        name: row.name,
        position,
        icon: canonicalGroupIcon(row.icon),
      });
      if (groups.length === MAX_GROUPS) break;
    }
    return groups;
  };

  /**
   * Every membership row, validated against the groups that actually exist.
   * A member pointing at a deleted group is dropped here rather than handed to
   * the frontend, so the tree can never draw a project under a ghost header.
   */
  const assignments = (): GroupAssignment => {
    const validIds = new Set(list().map((group) => group.id));
    const rows = db
      .prepare(`SELECT project_id, group_id FROM project_group_members`)
      .all() as MemberRow[];
    const assignment: Record<string, string> = {};
    for (const row of rows) {
      if (!validProjectId(row.project_id)) continue;
      if (!validGroupId(row.group_id) || !validIds.has(row.group_id)) continue;
      assignment[row.project_id] = row.group_id;
    }
    return assignment;
  };

  const create = (id: string, name: string, icon = DEFAULT_GROUP_ICON): ProjectGroup => {
    const cleanName = canonicalGroupName(name);
    if (!validGroupId(id) || !validGroupName(cleanName) || !validGroupIcon(icon)) {
      throw new Error("Invalid group name.");
    }
    const canonicalIcon = canonicalGroupIcon(icon);
    const count = db
      .prepare(`SELECT COUNT(*) AS count FROM project_groups`)
      .get() as { count: number };
    if (count.count >= MAX_GROUPS) throw new Error("Group limit reached.");
    const maxPosition = db
      .prepare(`SELECT COALESCE(MAX(position), -1) AS max FROM project_groups`)
      .get() as { max: number };
    const position = maxPosition.max + 1;
    db.prepare(
      `INSERT INTO project_groups (id, name, position, updated_at, icon)
      VALUES (?, ?, ?, ?, ?)`,
    ).run(id, cleanName, position, Date.now(), canonicalIcon);
    return { id, name: cleanName, position, icon: canonicalIcon };
  };

  const rename = (id: string, name: string, icon?: string): ProjectGroup | null => {
    const cleanName = canonicalGroupName(name);
    if (!validGroupId(id) || !validGroupName(cleanName) || (icon !== undefined && !validGroupIcon(icon))) return null;
    const canonicalIcon = icon === undefined ? undefined : canonicalGroupIcon(icon);
    if (canonicalIcon !== undefined) db.prepare(`UPDATE project_groups SET icon = ?, name = ?, updated_at = ? WHERE id = ?`).run(canonicalIcon, cleanName, Date.now(), id);
    else db.prepare(`UPDATE project_groups SET name = ?, updated_at = ? WHERE id = ?`).run(cleanName, Date.now(), id);
    const changes = db
      .prepare(`SELECT changes() AS changes`)
      .get() as { changes: number };
    if (changes.changes === 0) return null;
    const row = db
      .prepare(`SELECT id, name, position, icon FROM project_groups WHERE id = ?`)
      .get(id) as GroupRow | undefined;
    if (row === undefined) return null;
    return {
      id,
      name: cleanName,
      position: Number(row.position) || 0,
      icon: canonicalGroupIcon(row.icon),
    };
  };

  /** Deleting a group releases its projects; they return to Ungrouped. */
  const remove = (id: string): boolean => {
    if (!validGroupId(id)) return false;
    const changes = db
      .prepare(`DELETE FROM project_groups WHERE id = ?`)
      .run(id).changes;
    if (changes === 0) return false;
    db.prepare(`DELETE FROM project_group_members WHERE group_id = ?`).run(id);
    return true;
  };

  const assign = (projectId: string, groupId: string | null): boolean => {
    if (!validProjectId(projectId)) return false;
    if (groupId === null) {
      db.prepare(`DELETE FROM project_group_members WHERE project_id = ?`).run(
        projectId,
      );
      return true;
    }
    if (!validGroupId(groupId)) return false;
    const exists = db
      .prepare(`SELECT 1 FROM project_groups WHERE id = ?`)
      .get(groupId);
    if (exists === undefined) return false;
    db.prepare(
      `INSERT INTO project_group_members (project_id, group_id, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET
         group_id = excluded.group_id, updated_at = excluded.updated_at`,
    ).run(projectId, groupId, Date.now());
    return true;
  };

  /**
   * Apply a whole ordering in one transaction. Positions are rewritten from
   * the array index, so the caller only has to produce a permutation.
   */
  const reorder = (orderedIds: readonly string[]): boolean => {
    if (new Set(orderedIds).size !== orderedIds.length) return false;
    if (!orderedIds.every(validGroupId)) return false;
    const statement = db.prepare(
      `UPDATE project_groups SET position = ?, updated_at = ? WHERE id = ?`,
    );
    const now = Date.now();
    const run = db.transaction((ids: readonly string[]) => {
      ids.forEach((id, index) => statement.run(index, now, id));
    });
    run(orderedIds);
    return true;
  };

  return { assign, assignments, create, list, remove, rename, reorder };
}
