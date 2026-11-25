/**
 * The manual arrangement, in the plugin's own database.
 *
 * One row per scope: a group holds its projects, a project holds its root
 * threads, and a project also holds its worktrees. The ordering the user
 * arranged is data, not a per-browser view preference, so it lives beside the
 * groups — which also means it follows the user across machines and survives
 * clearing site data.
 */

import type Database from "better-sqlite3";
import {
  parseItemIds,
  serializeItemIds,
  validOrderId,
  validOrderItems,
} from "../domain/manual-order.ts";

export const MANUAL_ORDER_MIGRATION = `CREATE TABLE IF NOT EXISTS manual_order (
  scope_kind TEXT NOT NULL,
  scope_id   TEXT NOT NULL,
  item_ids   TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (scope_kind, scope_id)
)`;

/**
 * One row, holding a counter that every write bumps.
 *
 * The arrangement is shared — it follows the user across machines — and two
 * clients holding it at once is the normal case, not the exotic one: the sidebar
 * is open on a desktop and in a browser. Without a revision the second window's
 * drag silently discards the first's, and the user sees their arrangement
 * revert for no reason they can name.
 */
export const ORDER_REVISION_MIGRATION = `CREATE TABLE IF NOT EXISTS manual_order_revision (
  id       INTEGER PRIMARY KEY CHECK (id = 0),
  revision INTEGER NOT NULL
)`;

/** The statement that gives the counter its single row. */
export const ORDER_REVISION_SEED = `INSERT OR IGNORE INTO manual_order_revision (id, revision) VALUES (0, 0)`;

export type OrderScopeKind = "group" | "project" | "workspace";

/**
 * The outcome of a write.
 *
 * `stale` is its own answer rather than a failure: it means the caller's
 * arrangement is not the one on the server any more, which is something the user
 * can be asked about rather than an error to log.
 */
export type OrderWrite =
  | { readonly ok: true; readonly revision: number }
  | {
      readonly ok: false;
      readonly reason: "invalid" | "stale";
      readonly revision: number;
    };

interface OrderRow {
  scope_id: unknown;
  item_ids: unknown;
}

export function createOrderStore(db: Database.Database) {
  const readMap = (kind: OrderScopeKind): Record<string, string[]> => {
    const rows = db
      .prepare(`SELECT scope_id, item_ids FROM manual_order WHERE scope_kind = ?`)
      .all(kind) as OrderRow[];
    const map: Record<string, string[]> = {};
    for (const row of rows) {
      if (!validOrderId(row.scope_id)) continue;
      const items = parseItemIds(
        typeof row.item_ids === "string" ? row.item_ids : null,
      );
      if (items === null) continue;
      map[row.scope_id] = items;
    }
    return map;
  };

  const list = (): {
    projects: Record<string, string[]>;
    families: Record<string, string[]>;
    workspaces: Record<string, string[]>;
  } => ({
    projects: readMap("group"),
    families: readMap("project"),
    workspaces: readMap("workspace"),
  });

  const revision = (): number => {
    const row = db
      .prepare(`SELECT revision FROM manual_order_revision WHERE id = 0`)
      .get() as { revision: unknown } | undefined;
    return typeof row?.revision === "number" ? row.revision : 0;
  };

  /** Advance the counter, for the changes that are not a scope write. */
  const bump = (): void => {
    db.prepare(
      `UPDATE manual_order_revision SET revision = revision + 1 WHERE id = 0`,
    ).run();
  };

  /**
   * Atomically verify `baseRevision` and persist one scope's arrangement in a
   * single SQLite transaction so concurrent updates cannot interleave between
   * checking and writing.
   */
  const writeGuarded = (
    kind: OrderScopeKind,
    scopeId: string,
    itemIds: readonly string[],
    baseRevision: number,
  ): OrderWrite => {
    const run = db.transaction((): OrderWrite => {
      const current = revision();
      if (current !== baseRevision) {
        return { ok: false, reason: "stale", revision: current };
      }
      if (!validOrderId(scopeId) || !validOrderItems(itemIds)) {
        return { ok: false, reason: "invalid", revision: current };
      }
      const now = Date.now();
      db.prepare(
        `INSERT INTO manual_order (scope_kind, scope_id, item_ids, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(scope_kind, scope_id) DO UPDATE SET
           item_ids = excluded.item_ids, updated_at = excluded.updated_at`,
      ).run(kind, scopeId, serializeItemIds(itemIds), now);
      db.prepare(
        `UPDATE manual_order_revision SET revision = revision + 1 WHERE id = 0`,
      ).run();
      return { ok: true, revision: revision() };
    });
    return run();
  };

  const setProjectOrder = (
    groupId: string,
    projectIds: readonly string[],
    baseRevision: number,
  ): OrderWrite => writeGuarded("group", groupId, projectIds, baseRevision);

  const setFamilyOrder = (
    projectId: string,
    rootIds: readonly string[],
    baseRevision: number,
  ): OrderWrite => writeGuarded("project", projectId, rootIds, baseRevision);

  /** The worktrees of one project, by workspace key. */
  const setWorkspaceOrder = (
    projectId: string,
    workspaceKeys: readonly string[],
    baseRevision: number,
  ): OrderWrite => writeGuarded("workspace", projectId, workspaceKeys, baseRevision);

  /**
   * A removal is a change to the arrangement too, so it bumps.
   *
   * A client holding the pre-removal revision must not be allowed to write the
   * list it read: the row it is moving may be the one that just went away.
   */
  const removeGroup = (groupId: string): void => {
    db.prepare(
      `DELETE FROM manual_order WHERE scope_kind = 'group' AND scope_id = ?`,
    ).run(groupId);
    bump();
  };

  /** A deleted project takes both of its scopes with it. */
  const removeProject = (projectId: string): void => {
    db.prepare(
      `DELETE FROM manual_order
        WHERE scope_id = ? AND scope_kind IN ('project', 'workspace')`,
    ).run(projectId);
    bump();
  };

  return {
    list,
    revision,
    setFamilyOrder,
    setProjectOrder,
    setWorkspaceOrder,
    removeGroup,
    removeProject,
  };
}
