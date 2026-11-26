import { existsSync } from "node:fs";
import path from "node:path";
import type DatabaseType from "better-sqlite3";
import Database from "better-sqlite3";
import { canonicalGroupIcon } from "../domain/group-icons.ts";
import { validGroupId, validGroupName } from "../domain/groups.ts";
import {
  parseItemIds,
  serializeItemIds,
  validOrderId,
} from "../domain/manual-order.ts";
import {
  MAX_PROJECT_COLOR_ROWS,
  canonicalProjectColor,
  validProjectId,
} from "../domain/project-colors.ts";
import {
  MAX_GROUP_ID_LENGTH,
  MAX_GROUPS,
  MAX_ORDER_SCOPES,
} from "../schemas/sidebar.ts";
import { parseJsonStringArray, readTableCount } from "./sqlite-helpers.ts";

export const NEST_MIGRATION_PREF_KEY = "nestMigrationV1Done";
export const LEGACY_NEST_PLUGIN_DIR = "nested-sidebar";

const VALID_ORDER_SCOPE_KINDS = new Set([
  "group",
  "project",
  "pinned",
  "workspace",
]);

export type NestMigrationStatus =
  | "migrated"
  | "already-done"
  | "source-missing"
  | "skipped-error";

export interface NestMigrationReport {
  readonly status: NestMigrationStatus;
  readonly groups: number;
  readonly memberships: number;
  readonly manualOrders: number;
  readonly badgeColors: number;
  readonly lifecycle: number;
}

function emptyReport(status: NestMigrationStatus): NestMigrationReport {
  return {
    status,
    groups: 0,
    memberships: 0,
    manualOrders: 0,
    badgeColors: 0,
    lifecycle: 0,
  };
}

/**
 * Derive the sibling legacy Nest SQLite database path from Harbor's own DB path:
 * `<plugins-data-root>/harbor/data.db` -> `<plugins-data-root>/nested-sidebar/data.db`.
 */
export function resolveSiblingNestDbPath(targetDbPath: string): string | null {
  if (targetDbPath.length === 0 || targetDbPath === ":memory:") return null;
  const resolvedTarget = path.resolve(targetDbPath);
  const pluginDir = path.dirname(resolvedTarget);
  const pluginsRoot = path.dirname(pluginDir);
  const candidate = path.join(pluginsRoot, LEGACY_NEST_PLUGIN_DIR, "data.db");
  return candidate === resolvedTarget ? null : candidate;
}

function hasSourceTable(db: DatabaseType.Database, tableName: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`,
    )
    .get(tableName);
  return row !== undefined;
}

function hasSourceColumn(
  db: DatabaseType.Database,
  tableName: string,
  columnName: string,
): boolean {
  const cols = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    name?: unknown;
  }>;
  return cols.some((col) => col.name === columnName);
}

function validUpdatedAt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function validTimestampOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function validOrderScopeKind(value: unknown): value is string {
  return typeof value === "string" && VALID_ORDER_SCOPE_KINDS.has(value);
}

/**
 * Idempotently imports project groups, group memberships, manual order,
 * custom project badge colors, and thread shelf lifecycle from a sibling Nest
 * SQLite database when Harbor boots for the first time against it.
 *
 * Existing Harbor records always win on primary-key conflicts (`INSERT OR IGNORE`).
 * Errors reading an absent, locked, or corrupt source DB never abort Harbor startup.
 */
export function migrateFromNestDatabase(
  targetDb: DatabaseType.Database,
  options?: {
    readonly sourceDbPath?: string | null;
    readonly force?: boolean;
    readonly log?: (message: string) => void;
  },
): NestMigrationReport {
  if (options?.force !== true) {
    const done = targetDb
      .prepare(`SELECT value FROM view_preferences WHERE key = ? LIMIT 1`)
      .get(NEST_MIGRATION_PREF_KEY);
    if (done !== undefined) return emptyReport("already-done");
  }

  const sourcePath =
    options?.sourceDbPath !== undefined
      ? options.sourceDbPath
      : resolveSiblingNestDbPath(targetDb.name);
  if (sourcePath === null || sourcePath.length === 0 || !existsSync(sourcePath)) {
    return emptyReport("source-missing");
  }

  let sourceDb: DatabaseType.Database | null = null;
  try {
    sourceDb = new Database(sourcePath, { readonly: true, fileMustExist: true });
    const now = Date.now();
    const readGroupRows = hasSourceTable(sourceDb, "project_groups")
      ? (sourceDb
          .prepare(
            hasSourceColumn(sourceDb, "project_groups", "icon")
              ? `SELECT id, name, position, updated_at, icon
                   FROM project_groups
                  ORDER BY position ASC, name ASC`
              : `SELECT id, name, position, updated_at, NULL AS icon
                   FROM project_groups
                  ORDER BY position ASC, name ASC`,
          )
          .all() as Array<{
          id: unknown;
          name: unknown;
          position: unknown;
          updated_at: unknown;
          icon: unknown;
        }>)
      : [];

    const readMemberRows = hasSourceTable(sourceDb, "project_group_members")
      ? (sourceDb
          .prepare(
            `SELECT project_id, group_id, updated_at FROM project_group_members`,
          )
          .all() as Array<{
          project_id: unknown;
          group_id: unknown;
          updated_at: unknown;
        }>)
      : [];

    const readOrderRows = hasSourceTable(sourceDb, "manual_order")
      ? (sourceDb
          .prepare(
            `SELECT scope_kind, scope_id, item_ids, updated_at FROM manual_order`,
          )
          .all() as Array<{
          scope_kind: unknown;
          scope_id: unknown;
          item_ids: unknown;
          updated_at: unknown;
        }>)
      : [];

    const readColorRows = hasSourceTable(sourceDb, "project_badge_colors")
      ? (sourceDb
          .prepare(
            `SELECT project_id, color, updated_at FROM project_badge_colors`,
          )
          .all() as Array<{
          project_id: unknown;
          color: unknown;
          updated_at: unknown;
        }>)
      : [];

    const readLifecycleRows = hasSourceTable(sourceDb, "thread_lifecycle")
      ? (sourceDb
          .prepare(
            hasSourceColumn(sourceDb, "thread_lifecycle", "archived_thread_ids")
              ? `SELECT thread_id, settled_at, snoozed_until, snoozed_at, archived_thread_ids
                   FROM thread_lifecycle`
              : `SELECT thread_id, settled_at, snoozed_until, snoozed_at, NULL AS archived_thread_ids
                   FROM thread_lifecycle`,
          )
          .all() as Array<{
          thread_id: unknown;
          settled_at: unknown;
          snoozed_until: unknown;
          snoozed_at: unknown;
          archived_thread_ids: unknown;
        }>)
      : [];

    const run = targetDb.transaction((): NestMigrationReport => {
      let groups = 0;
      let memberships = 0;
      let manualOrders = 0;
      let badgeColors = 0;
      let lifecycle = 0;

      const existingGroupCount = readTableCount(targetDb, "project_groups");
      const maxPosRow = targetDb
        .prepare(`SELECT COALESCE(MAX(position), -1) AS max FROM project_groups`)
        .get() as { max: number };
      let nextPosition =
        typeof maxPosRow.max === "number" && Number.isFinite(maxPosRow.max)
          ? maxPosRow.max + 1
          : 0;
      let totalGroups = existingGroupCount;

      const insertGroup = targetDb.prepare(
        `INSERT OR IGNORE INTO project_groups (id, name, position, updated_at, icon)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const row of readGroupRows) {
        if (totalGroups >= MAX_GROUPS) break;
        if (!validGroupId(row.id) || !validGroupName(row.name)) continue;
        const result = insertGroup.run(
          row.id,
          row.name.trim(),
          nextPosition,
          validUpdatedAt(row.updated_at, now),
          canonicalGroupIcon(row.icon),
        );
        if (result.changes > 0) {
          groups += 1;
          totalGroups += 1;
          nextPosition += 1;
        }
      }

      const knownGroupIds = new Set(
        (
          targetDb.prepare(`SELECT id FROM project_groups`).all() as Array<{
            id: unknown;
          }>
        )
          .map((row) => row.id)
          .filter((id): id is string => typeof id === "string"),
      );

      const insertMember = targetDb.prepare(
        `INSERT OR IGNORE INTO project_group_members (project_id, group_id, updated_at)
         VALUES (?, ?, ?)`,
      );
      for (const row of readMemberRows) {
        if (!validProjectId(row.project_id)) continue;
        if (
          typeof row.group_id !== "string" ||
          row.group_id.length > MAX_GROUP_ID_LENGTH ||
          !knownGroupIds.has(row.group_id)
        ) {
          continue;
        }
        const result = insertMember.run(
          row.project_id,
          row.group_id,
          validUpdatedAt(row.updated_at, now),
        );
        if (result.changes > 0) memberships += 1;
      }

      let orderScopes = readTableCount(targetDb, "manual_order");
      const insertOrder = targetDb.prepare(
        `INSERT OR IGNORE INTO manual_order (scope_kind, scope_id, item_ids, updated_at)
         VALUES (?, ?, ?, ?)`,
      );
      for (const row of readOrderRows) {
        if (orderScopes >= MAX_ORDER_SCOPES) break;
        if (!validOrderScopeKind(row.scope_kind) || !validOrderId(row.scope_id)) {
          continue;
        }
        const items = parseItemIds(
          typeof row.item_ids === "string" ? row.item_ids : null,
        );
        if (items === null) continue;
        const result = insertOrder.run(
          row.scope_kind,
          row.scope_id,
          serializeItemIds(items),
          validUpdatedAt(row.updated_at, now),
        );
        if (result.changes > 0) {
          manualOrders += 1;
          orderScopes += 1;
        }
      }
      if (manualOrders > 0) {
        targetDb
          .prepare(
            `UPDATE manual_order_revision SET revision = revision + 1 WHERE id = 0`,
          )
          .run();
      }

      let colorCount = readTableCount(targetDb, "project_badge_colors");
      const insertColor = targetDb.prepare(
        `INSERT OR IGNORE INTO project_badge_colors (project_id, color, updated_at)
         VALUES (?, ?, ?)`,
      );
      for (const row of readColorRows) {
        if (colorCount >= MAX_PROJECT_COLOR_ROWS) break;
        if (!validProjectId(row.project_id)) continue;
        const color = canonicalProjectColor(row.color);
        if (color === null) continue;
        const result = insertColor.run(
          row.project_id,
          color,
          validUpdatedAt(row.updated_at, now),
        );
        if (result.changes > 0) {
          badgeColors += 1;
          colorCount += 1;
        }
      }

      const insertLifecycle = targetDb.prepare(
        `INSERT OR IGNORE INTO thread_lifecycle
           (thread_id, settled_at, snoozed_until, snoozed_at, archived_thread_ids)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const row of readLifecycleRows) {
        if (typeof row.thread_id !== "string" || row.thread_id.length === 0) {
          continue;
        }
        const archivedIds = parseJsonStringArray(row.archived_thread_ids);
        const archivedJson =
          archivedIds.length > 0 ? JSON.stringify(archivedIds) : null;
        const result = insertLifecycle.run(
          row.thread_id,
          validTimestampOrNull(row.settled_at),
          validTimestampOrNull(row.snoozed_until),
          validTimestampOrNull(row.snoozed_at),
          archivedJson,
        );
        if (result.changes > 0) lifecycle += 1;
      }

      targetDb
        .prepare(
          `INSERT INTO view_preferences (key, value, updated_at)
           VALUES (?, '1', ?)
           ON CONFLICT(key) DO UPDATE SET
             value = excluded.value, updated_at = excluded.updated_at`,
        )
        .run(NEST_MIGRATION_PREF_KEY, now);

      return {
        status: "migrated",
        groups,
        memberships,
        manualOrders,
        badgeColors,
        lifecycle,
      };
    });

    const report = run();
    options?.log?.(
      `[harbor] Migrated Nest sidebar data: ${report.groups} groups, ${report.memberships} assignments, ${report.manualOrders} orders, ${report.badgeColors} badge colors, ${report.lifecycle} lifecycle rows.`,
    );
    return report;
  } catch (error) {
    options?.log?.(
      `[harbor] Skipped Nest sidebar migration (${sourcePath}): ${error instanceof Error ? error.message : String(error)}`,
    );
    return emptyReport("skipped-error");
  } finally {
    sourceDb?.close();
  }
}
