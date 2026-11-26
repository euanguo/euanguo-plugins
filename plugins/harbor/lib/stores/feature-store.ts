/**
 * Feature storage: the features themselves, and the adoption label a worktree
 * from outside any feature directory can carry.
 *
 * What a feature contains is not stored. Members are the worktrees inside its
 * directory and threads are the conversations whose workspace is inside it;
 * both are read from the disk and from bb, because a copy here would go stale
 * the first time an agent ran `git worktree add` by hand.
 *
 * Rows are validated on read as well as write. A hand-edited database, or one
 * written by an older build, degrades to a missing or defaulted field rather
 * than reaching the tree.
 */

import type Database from "better-sqlite3";
import { collectValidRows } from "./sqlite-helpers.ts";
import {
  DEFAULT_FEATURE_STATE,
  MAX_FEATURES,
  canonicalFeatureName,
  liveAssignment,
  normalizeParkNote,
  normalizeParkReason,
  readFeatureState,
  validFeatureId,
  validFeatureName,
  validFeatureSlug,
  validFeatureState,
  type Feature,
  type FeatureAssignment,
  type FeatureState,
} from "../domain/features.ts";

export const FEATURE_MIGRATION = `CREATE TABLE IF NOT EXISTS features (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL,
  state      TEXT NOT NULL,
  position   INTEGER NOT NULL,
  root_path  TEXT,
  host_id    TEXT,
  created_at INTEGER,
  updated_at INTEGER NOT NULL
)`;

export const FEATURE_PARK_MIGRATIONS = [
  `ALTER TABLE features ADD COLUMN parked_at INTEGER`,
  `ALTER TABLE features ADD COLUMN parked_reason TEXT`,
  `ALTER TABLE features ADD COLUMN parked_note TEXT`,
  `ALTER TABLE features ADD COLUMN wake_at INTEGER`,
  `ALTER TABLE features ADD COLUMN wake_on_activity INTEGER NOT NULL DEFAULT 0`,
] as const;

/**
 * The folder each machine keeps feature directories under.
 *
 * Written down once per machine, because the root is chosen from where that
 * machine's code already lives: re-choosing it after a project was added would
 * move new features away from the old ones. A row here is also the only thing a
 * restart needs to find them again.
 */
export const FEATURE_ROOT_CHOICE_MIGRATION = `CREATE TABLE IF NOT EXISTS feature_roots (
  host_id    TEXT PRIMARY KEY,
  root_path  TEXT NOT NULL,
  scheme     TEXT,
  updated_at INTEGER NOT NULL
)`;

/**
 * Every folder that has ever held feature directories.
 *
 * A container project outlives its features — the last feature under a root can
 * be deleted while the empty project stays — and it must stay hidden from the
 * project view even then. `feature_roots` only remembers the current root per
 * machine, so the history is its own table.
 */
export const FEATURE_CONTAINER_MIGRATION = `CREATE TABLE IF NOT EXISTS feature_containers (
  path       TEXT PRIMARY KEY,
  updated_at INTEGER NOT NULL
)`;

/** Adoption labels: environment id -> feature, for worktrees outside a feature directory. */
export const FEATURE_LABEL_MIGRATION = `CREATE TABLE IF NOT EXISTS feature_workspace_labels (
  environment_id TEXT PRIMARY KEY,
  feature_id     TEXT NOT NULL,
  updated_at     INTEGER NOT NULL
)`;

/**
 * The branches a feature created, one row per repository.
 *
 * The one thing about members that is written down, because the disk stops
 * knowing it: once a finish takes the worktrees back, nothing in the folder
 * says which repositories hold `feat/<slug>`, and a later delete that offers to
 * remove the branch has to know where to look.
 */
export const FEATURE_BRANCH_MIGRATION = `CREATE TABLE IF NOT EXISTS feature_branches (
  feature_id      TEXT NOT NULL,
  repository_path TEXT NOT NULL,
  host_id         TEXT NOT NULL,
  branch          TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  PRIMARY KEY (feature_id, repository_path, branch)
)`;

/** The statements this module owns, in Harbor v1 creation order. */
export const FEATURE_STORE_MIGRATIONS = [
  FEATURE_MIGRATION,
  FEATURE_LABEL_MIGRATION,
  FEATURE_BRANCH_MIGRATION,
  FEATURE_ROOT_CHOICE_MIGRATION,
  FEATURE_CONTAINER_MIGRATION,
] as const;

interface FeatureRow {
  id: unknown;
  name: unknown;
  slug: unknown;
  state: unknown;
  position: unknown;
  root_path: unknown;
  host_id: unknown;
  parked_at?: unknown;
  parked_reason?: unknown;
  parked_note?: unknown;
  wake_at?: unknown;
  wake_on_activity?: unknown;
}

interface LabelRow {
  environment_id: unknown;
  feature_id: unknown;
}

export interface FeatureStore {
  list(): Feature[];
  find(featureId: string): Feature | undefined;
  /** environmentId -> featureId, already stripped of deleted features. */
  adoptions(): FeatureAssignment;
  create(input: {
    id: string;
    name: string;
    slug: string;
    rootPath: string;
    hostId: string;
  }): Feature | null;
  rename(featureId: string, name: string): boolean;
  setState(featureId: string, state: FeatureState): boolean;
  park(
    featureId: string,
    input: {
      reason?: string | null;
      note?: string | null;
      wakeAt?: number | null;
      wakeOnActivity?: boolean;
    },
  ): boolean;
  unpark(featureId: string): boolean;
  dueParkedWakes(nowMs: number): { id: string; wakeAt: number }[];
  /** Deletes the feature and every adoption label that pointed at it. */
  remove(featureId: string): boolean;
  adopt(environmentId: string, featureId: string | null): boolean;
  setRoot(featureId: string, rootPath: string, hostId: string): boolean;
  /** The folder this machine keeps feature directories under, once chosen. */
  featuresRoot(hostId: string): { rootPath: string; scheme: string | null } | null;
  /** The current root on every machine that has one. */
  featuresRoots(): { hostId: string; rootPath: string }[];
  /** Remember a folder that held, or holds, feature directories. */
  recordContainer(path: string): void;
  containers(): string[];
  setFeaturesRoot(hostId: string, rootPath: string, scheme: string | null): void;
  /** Record a branch this feature created in a repository. */
  recordBranch(input: {
    featureId: string;
    repositoryPath: string;
    hostId: string;
    branch: string;
  }): void;
  branches(featureId: string): { repositoryPath: string; hostId: string; branch: string }[];
  /** Forget a recorded branch, after it was renamed by hand. */
  forgetBranch(input: {
    featureId: string;
    repositoryPath: string;
    branch: string;
  }): void;
}

function featuresHasParkColumns(db: Database.Database): boolean {
  const columns = db.prepare(`PRAGMA table_info(features)`).all() as {
    name?: unknown;
  }[];
  return columns.some((column) => column.name === "parked_at");
}

export function createFeatureStore(db: Database.Database): FeatureStore {
  const hasParkColumns = featuresHasParkColumns(db);

  const readRows = (): FeatureRow[] => {
    return db
      .prepare(
        hasParkColumns
          ? `SELECT id, name, slug, state, position, root_path, host_id,
                    parked_at, parked_reason, parked_note, wake_at, wake_on_activity
               FROM features
              ORDER BY position ASC, name ASC LIMIT ?`
          : `SELECT id, name, slug, state, position, root_path, host_id
               FROM features
              ORDER BY position ASC, name ASC LIMIT ?`,
      )
      .all(MAX_FEATURES + 1) as FeatureRow[];
  };

  const list = (): Feature[] => {
    const takenSlugs = new Set<string>();
    let fallbackPosition = 0;
    return collectValidRows(readRows(), MAX_FEATURES, (row) => {
      if (!validFeatureId(row.id) || !validFeatureName(row.name)) return null;
      if (!validFeatureSlug(row.slug) || takenSlugs.has(row.slug)) return null;
      const name = canonicalFeatureName(row.name);
      const slug = row.slug;
      takenSlugs.add(slug);
      const state = readFeatureState(row.state);
      const position =
        typeof row.position === "number" && Number.isFinite(row.position)
          ? row.position
          : fallbackPosition;
      fallbackPosition += 1;
      return {
        id: row.id,
        name,
        slug,
        state,
        position,
        rootPath:
          typeof row.root_path === "string" && row.root_path.length > 0
            ? row.root_path
            : null,
        hostId:
          typeof row.host_id === "string" && row.host_id.length > 0
            ? row.host_id
            : null,
        parkedAt:
          state === "parked" &&
          typeof row.parked_at === "number" &&
          Number.isFinite(row.parked_at)
            ? row.parked_at
            : null,
        parkedReason:
          state === "parked" && typeof row.parked_reason === "string"
            ? row.parked_reason
            : null,
        parkedNote:
          state === "parked" && typeof row.parked_note === "string"
            ? row.parked_note
            : null,
        wakeAt:
          state === "parked" &&
          typeof row.wake_at === "number" &&
          Number.isFinite(row.wake_at)
            ? row.wake_at
            : null,
        wakeOnActivity: state === "parked" && row.wake_on_activity === 1,
      };
    });
  };

  const find = (featureId: string): Feature | undefined =>
    list().find((feature) => feature.id === featureId);

  const adoptions = (): FeatureAssignment => {
    const validIds = new Set(list().map((feature) => feature.id));
    const rows = db
      .prepare(`SELECT environment_id, feature_id FROM feature_workspace_labels`)
      .all() as LabelRow[];
    const assignment: Record<string, string> = {};
    for (const row of rows) {
      if (typeof row.environment_id !== "string") continue;
      if (row.environment_id.trim().length === 0) continue;
      if (typeof row.feature_id !== "string") continue;
      assignment[row.environment_id] = row.feature_id;
    }
    return liveAssignment(assignment, validIds);
  };

  const create: FeatureStore["create"] = (input) => {
    if (!validFeatureId(input.id) || !validFeatureName(input.name)) return null;
    if (!validFeatureSlug(input.slug)) return null;
    if (input.rootPath.trim().length === 0 || input.hostId.trim().length === 0) {
      return null;
    }
    const current = list();
    if (current.length >= MAX_FEATURES) return null;
    if (current.some((feature) => feature.id === input.id)) return null;
    if (current.some((feature) => feature.slug === input.slug)) return null;
    const now = Date.now();
    // New features land at the top of the list: a person who just named
    // something is about to work on it, and the bottom of a long list is where
    // it would be least findable.
    db.prepare(
      `INSERT INTO features
         (id, name, slug, state, position, root_path, host_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.id,
      canonicalFeatureName(input.name),
      input.slug,
      DEFAULT_FEATURE_STATE,
      nextPosition(current),
      input.rootPath,
      input.hostId,
      now,
      now,
    );
    return find(input.id) ?? null;
  };

  const rename: FeatureStore["rename"] = (featureId, name) => {
    if (!validFeatureId(featureId) || !validFeatureName(name)) return false;
    if (find(featureId) === undefined) return false;
    db.prepare(`UPDATE features SET name = ?, updated_at = ? WHERE id = ?`).run(
      canonicalFeatureName(name),
      Date.now(),
      featureId,
    );
    return true;
  };

  const setState: FeatureStore["setState"] = (featureId, state) => {
    if (!validFeatureId(featureId) || !validFeatureState(state)) return false;
    if (find(featureId) === undefined) return false;
    if (hasParkColumns && state !== "parked") {
      db.prepare(
        `UPDATE features
            SET state = ?,
                parked_at = NULL,
                parked_reason = NULL,
                parked_note = NULL,
                wake_at = NULL,
                wake_on_activity = 0,
                updated_at = ?
          WHERE id = ?`,
      ).run(state, Date.now(), featureId);
    } else {
      db.prepare(`UPDATE features SET state = ?, updated_at = ? WHERE id = ?`).run(
        state,
        Date.now(),
        featureId,
      );
    }
    return true;
  };

  const park: FeatureStore["park"] = (featureId, input) => {
    if (!validFeatureId(featureId)) return false;
    const existing = find(featureId);
    if (existing === undefined || existing.state === "archived") return false;
    const now = Date.now();
    const reason = normalizeParkReason(input.reason ?? null);
    const note = normalizeParkNote(input.note ?? null);
    const wakeAt =
      typeof input.wakeAt === "number" &&
      Number.isFinite(input.wakeAt) &&
      input.wakeAt > 0
        ? Math.round(input.wakeAt)
        : null;
    const wakeOnActivity = input.wakeOnActivity === true ? 1 : 0;
    if (!hasParkColumns) {
      db.prepare(`UPDATE features SET state = 'parked', updated_at = ? WHERE id = ?`).run(
        now,
        featureId,
      );
      return true;
    }
    db.prepare(
      `UPDATE features
          SET state = 'parked',
              parked_at = COALESCE(parked_at, ?),
              parked_reason = ?,
              parked_note = ?,
              wake_at = ?,
              wake_on_activity = ?,
              updated_at = ?
        WHERE id = ?`,
    ).run(now, reason, note, wakeAt, wakeOnActivity, now, featureId);
    return true;
  };

  const unpark: FeatureStore["unpark"] = (featureId) => setState(featureId, "active");

  const dueParkedWakes: FeatureStore["dueParkedWakes"] = (nowMs) => {
    if (!hasParkColumns) return [];
    const rows = db
      .prepare(
        `SELECT id, wake_at
           FROM features
          WHERE state = 'parked' AND wake_at IS NOT NULL AND wake_at <= ?
          ORDER BY wake_at ASC`,
      )
      .all(nowMs) as { id: unknown; wake_at: unknown }[];
    return rows.flatMap((row) =>
      validFeatureId(row.id) && typeof row.wake_at === "number"
        ? [{ id: row.id, wakeAt: row.wake_at }]
        : [],
    );
  };

  const remove: FeatureStore["remove"] = (featureId) => {
    if (!validFeatureId(featureId)) return false;
    if (find(featureId) === undefined) return false;
    db.transaction(() => {
      db.prepare(`DELETE FROM feature_workspace_labels WHERE feature_id = ?`).run(
        featureId,
      );
      db.prepare(`DELETE FROM feature_branches WHERE feature_id = ?`).run(featureId);
      db.prepare(`DELETE FROM features WHERE id = ?`).run(featureId);
    })();
    return true;
  };

  const adopt: FeatureStore["adopt"] = (environmentId, featureId) => {
    if (environmentId.trim().length === 0) return false;
    if (featureId !== null && find(featureId) === undefined) return false;
    if (featureId === null) {
      db.prepare(
        `DELETE FROM feature_workspace_labels WHERE environment_id = ?`,
      ).run(environmentId);
      return true;
    }
    db.prepare(
      `INSERT INTO feature_workspace_labels (environment_id, feature_id, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(environment_id) DO UPDATE SET
         feature_id = excluded.feature_id, updated_at = excluded.updated_at`,
    ).run(environmentId, featureId, Date.now());
    return true;
  };

  const setRoot: FeatureStore["setRoot"] = (featureId, rootPath, hostId) => {
    if (!validFeatureId(featureId)) return false;
    if (rootPath.trim().length === 0 || hostId.trim().length === 0) return false;
    if (find(featureId) === undefined) return false;
    db.prepare(
      `UPDATE features SET root_path = ?, host_id = ?, updated_at = ? WHERE id = ?`,
    ).run(rootPath, hostId, Date.now(), featureId);
    return true;
  };

  const featuresRoot: FeatureStore["featuresRoot"] = (hostId) => {
    const row = db
      .prepare(`SELECT root_path, scheme FROM feature_roots WHERE host_id = ?`)
      .get(hostId) as { root_path: unknown; scheme: unknown } | undefined;
    if (row === undefined || typeof row.root_path !== "string" || row.root_path.length === 0) {
      return null;
    }
    return {
      rootPath: row.root_path,
      scheme: typeof row.scheme === "string" ? row.scheme : null,
    };
  };

  const featuresRoots: FeatureStore["featuresRoots"] = () => {
    const rows = db
      .prepare(`SELECT host_id, root_path FROM feature_roots`)
      .all() as { host_id: unknown; root_path: unknown }[];
    return rows.flatMap((row) =>
      typeof row.host_id === "string" &&
      typeof row.root_path === "string" &&
      row.root_path.length > 0
        ? [{ hostId: row.host_id, rootPath: row.root_path }]
        : [],
    );
  };

  const recordContainer: FeatureStore["recordContainer"] = (path) => {
    if (path.trim().length === 0) return;
    db.prepare(
      `INSERT INTO feature_containers (path, updated_at) VALUES (?, ?)
       ON CONFLICT(path) DO UPDATE SET updated_at = excluded.updated_at`,
    ).run(path, Date.now());
  };

  const containers: FeatureStore["containers"] = () => {
    const rows = db.prepare(`SELECT path FROM feature_containers`).all() as {
      path: unknown;
    }[];
    return rows.flatMap((row) => (typeof row.path === "string" ? [row.path] : []));
  };

  const setFeaturesRoot: FeatureStore["setFeaturesRoot"] = (hostId, rootPath, scheme) => {
    if (hostId.trim().length === 0 || rootPath.trim().length === 0) return;
    db.prepare(
      `INSERT INTO feature_roots (host_id, root_path, scheme, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(host_id) DO UPDATE SET
         root_path = excluded.root_path,
         scheme = excluded.scheme,
         updated_at = excluded.updated_at`,
    ).run(hostId, rootPath, scheme, Date.now());
  };

  const recordBranch: FeatureStore["recordBranch"] = (input) => {
    if (find(input.featureId) === undefined) return;
    db.prepare(
      `INSERT OR IGNORE INTO feature_branches
         (feature_id, repository_path, host_id, branch, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(input.featureId, input.repositoryPath, input.hostId, input.branch, Date.now());
  };

  const branches: FeatureStore["branches"] = (featureId) => {
    const rows = db
      .prepare(
        `SELECT repository_path, host_id, branch FROM feature_branches WHERE feature_id = ?`,
      )
      .all(featureId) as { repository_path: unknown; host_id: unknown; branch: unknown }[];
    return rows.flatMap((row) =>
      typeof row.repository_path === "string" &&
      typeof row.host_id === "string" &&
      typeof row.branch === "string"
        ? [{ repositoryPath: row.repository_path, hostId: row.host_id, branch: row.branch }]
        : [],
    );
  };

  const forgetBranch: FeatureStore["forgetBranch"] = (input) => {
    db.prepare(
      `DELETE FROM feature_branches
        WHERE feature_id = ? AND repository_path = ? AND branch = ?`,
    ).run(input.featureId, input.repositoryPath, input.branch);
  };

  return {
    list,
    find,
    adoptions,
    create,
    rename,
    setState,
    park,
    unpark,
    dueParkedWakes,
    remove,
    adopt,
    setRoot,
    featuresRoot,
    featuresRoots,
    recordContainer,
    containers,
    setFeaturesRoot,
    recordBranch,
    branches,
    forgetBranch,
  };
}

function nextPosition(features: readonly Feature[]): number {
  if (features.length === 0) return 0;
  return Math.min(...features.map((feature) => feature.position)) - 1;
}
