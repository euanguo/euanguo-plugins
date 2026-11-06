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
import {
  DEFAULT_FEATURE_STATE,
  MAX_FEATURES,
  asciiSlug,
  canonicalFeatureName,
  liveAssignment,
  readFeatureState,
  uniqueSlug,
  validFeatureId,
  validFeatureName,
  validFeatureSlug,
  validFeatureState,
  type Feature,
  type FeatureAssignment,
  type FeatureState,
} from "./features.ts";
import { validGroupId } from "./groups.ts";

export const FEATURE_MIGRATION = `CREATE TABLE IF NOT EXISTS features (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  state      TEXT NOT NULL,
  group_id   TEXT,
  position   INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`;

/**
 * Columns added after the first release ran.
 *
 * Each is its own statement rather than an edit to `FEATURE_MIGRATION`: bb
 * checks the journal by index and hash, so changing a statement a database has
 * already applied makes the whole plugin fail to load. Appending is the only
 * safe shape.
 */
export const FEATURE_ROOT_MIGRATION = `ALTER TABLE features ADD COLUMN root_path TEXT`;
export const FEATURE_HOST_MIGRATION = `ALTER TABLE features ADD COLUMN host_id TEXT`;
export const FEATURE_SLUG_MIGRATION = `ALTER TABLE features ADD COLUMN slug TEXT`;
export const FEATURE_CREATED_MIGRATION = `ALTER TABLE features ADD COLUMN created_at INTEGER`;

/** Adoption labels: environment id -> feature, for worktrees outside a feature directory. */
export const FEATURE_LABEL_MIGRATION = `CREATE TABLE IF NOT EXISTS feature_workspace_labels (
  environment_id TEXT PRIMARY KEY,
  feature_id     TEXT NOT NULL,
  updated_at     INTEGER NOT NULL
)`;

/**
 * A table an earlier build kept the materialized members in.
 *
 * No longer read: members come from the disk. The statement stays in the
 * journal because databases have already applied it, and removing it would
 * shift every later index.
 */
export const FEATURE_MEMBER_MIGRATION = `CREATE TABLE IF NOT EXISTS feature_members (
  feature_id     TEXT NOT NULL,
  path           TEXT NOT NULL,
  directory      TEXT NOT NULL,
  repository     TEXT NOT NULL,
  branch         TEXT NOT NULL,
  host_id        TEXT NOT NULL,
  environment_id TEXT,
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (feature_id, path)
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

/** Append-only, in the order they first ran. */
export const FEATURE_MIGRATIONS = [
  FEATURE_MIGRATION,
  FEATURE_LABEL_MIGRATION,
  FEATURE_MEMBER_MIGRATION,
  FEATURE_ROOT_MIGRATION,
  FEATURE_HOST_MIGRATION,
  FEATURE_SLUG_MIGRATION,
  FEATURE_CREATED_MIGRATION,
  FEATURE_BRANCH_MIGRATION,
] as const;

interface FeatureRow {
  id: unknown;
  name: unknown;
  slug: unknown;
  state: unknown;
  group_id: unknown;
  position: unknown;
  root_path: unknown;
  host_id: unknown;
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
    groupId: string | null;
    rootPath: string;
    hostId: string;
  }): Feature | null;
  rename(featureId: string, name: string): boolean;
  setState(featureId: string, state: FeatureState): boolean;
  setGroup(featureId: string, groupId: string | null): boolean;
  reorder(featureIds: readonly string[], groupId: string | null): boolean;
  /** Deletes the feature and every adoption label that pointed at it. */
  remove(featureId: string): boolean;
  adopt(environmentId: string, featureId: string | null): boolean;
  /** Moves every feature of a deleted group to Ungrouped. */
  releaseGroup(groupId: string): number;
  setRoot(featureId: string, rootPath: string, hostId: string): boolean;
  /** Record a branch this feature created in a repository. */
  recordBranch(input: {
    featureId: string;
    repositoryPath: string;
    hostId: string;
    branch: string;
  }): void;
  branches(featureId: string): { repositoryPath: string; hostId: string; branch: string }[];
  /**
   * Give every row an older build wrote without a slug a stored one.
   *
   * Run once at load. Until it runs, `list` still answers a slug — derived the
   * same way — so nothing reads a missing one in between.
   */
  backfillSlugs(): number;
}

export function createFeatureStore(db: Database.Database): FeatureStore {
  const readRows = (): FeatureRow[] =>
    db
      .prepare(
        `SELECT id, name, slug, state, group_id, position, root_path, host_id FROM features
          ORDER BY position ASC, name ASC LIMIT ?`,
      )
      .all(MAX_FEATURES + 1) as FeatureRow[];

  const list = (): Feature[] => {
    const features: Feature[] = [];
    const takenSlugs = new Set<string>();
    for (const row of readRows()) {
      if (!validFeatureId(row.id) || !validFeatureName(row.name)) continue;
      const name = canonicalFeatureName(row.name);
      const slug = validFeatureSlug(row.slug)
        ? row.slug
        : uniqueSlug(legacySlug(row.id, name), takenSlugs);
      takenSlugs.add(slug);
      features.push({
        id: row.id,
        name,
        slug,
        state: readFeatureState(row.state),
        groupId:
          typeof row.group_id === "string" && validGroupId(row.group_id)
            ? row.group_id
            : null,
        position:
          typeof row.position === "number" && Number.isFinite(row.position)
            ? row.position
            : features.length,
        rootPath:
          typeof row.root_path === "string" && row.root_path.length > 0
            ? row.root_path
            : null,
        hostId:
          typeof row.host_id === "string" && row.host_id.length > 0
            ? row.host_id
            : null,
      });
      if (features.length === MAX_FEATURES) break;
    }
    return features;
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
    // New features land at the top of their group: a person who just named
    // something is about to work on it, and the bottom of a long list is where
    // it would be least findable.
    db.prepare(
      `INSERT INTO features
         (id, name, slug, state, group_id, position, root_path, host_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.id,
      canonicalFeatureName(input.name),
      input.slug,
      DEFAULT_FEATURE_STATE,
      input.groupId,
      nextPosition(current, input.groupId),
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
    db.prepare(`UPDATE features SET state = ?, updated_at = ? WHERE id = ?`).run(
      state,
      Date.now(),
      featureId,
    );
    return true;
  };

  const setGroup: FeatureStore["setGroup"] = (featureId, groupId) => {
    if (!validFeatureId(featureId)) return false;
    if (groupId !== null && !validGroupId(groupId)) return false;
    const feature = find(featureId);
    if (feature === undefined) return false;
    if (feature.groupId === groupId) return true;
    db.prepare(
      `UPDATE features SET group_id = ?, position = ?, updated_at = ? WHERE id = ?`,
    ).run(groupId, nextPosition(list(), groupId), Date.now(), featureId);
    return true;
  };

  const reorder: FeatureStore["reorder"] = (featureIds, groupId) => {
    const known = new Set(
      list()
        .filter((feature) => feature.groupId === groupId)
        .map((feature) => feature.id),
    );
    const ordered = featureIds.filter((id) => known.has(id));
    if (ordered.length === 0) return false;
    const statement = db.prepare(
      `UPDATE features SET position = ?, updated_at = ? WHERE id = ?`,
    );
    const now = Date.now();
    db.transaction(() => {
      ordered.forEach((id, index) => statement.run(index, now, id));
    })();
    return true;
  };

  const remove: FeatureStore["remove"] = (featureId) => {
    if (!validFeatureId(featureId)) return false;
    if (find(featureId) === undefined) return false;
    db.transaction(() => {
      db.prepare(`DELETE FROM feature_workspace_labels WHERE feature_id = ?`).run(
        featureId,
      );
      db.prepare(`DELETE FROM feature_members WHERE feature_id = ?`).run(featureId);
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

  const releaseGroup: FeatureStore["releaseGroup"] = (groupId) => {
    if (!validGroupId(groupId)) return 0;
    const affected = list().filter((feature) => feature.groupId === groupId);
    if (affected.length === 0) return 0;
    const statement = db.prepare(
      `UPDATE features SET group_id = NULL, updated_at = ? WHERE id = ?`,
    );
    const now = Date.now();
    db.transaction(() => {
      for (const feature of affected) statement.run(now, feature.id);
    })();
    return affected.length;
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

  const backfillSlugs: FeatureStore["backfillSlugs"] = () => {
    const rows = readRows();
    const missing = rows.filter((row) => !validFeatureSlug(row.slug));
    if (missing.length === 0) return 0;
    // `list` derives exactly these, in the same order, so the stored slug is the
    // one every reader already saw.
    const derived = new Map(list().map((feature) => [feature.id, feature.slug]));
    const statement = db.prepare(`UPDATE features SET slug = ? WHERE id = ?`);
    let written = 0;
    db.transaction(() => {
      for (const row of missing) {
        if (typeof row.id !== "string") continue;
        const slug = derived.get(row.id);
        if (slug === undefined) continue;
        statement.run(slug, row.id);
        written += 1;
      }
    })();
    return written;
  };

  return {
    list,
    find,
    adoptions,
    create,
    rename,
    setState,
    setGroup,
    reorder,
    remove,
    adopt,
    releaseGroup,
    setRoot,
    recordBranch,
    branches,
    backfillSlugs,
  };
}

/**
 * The slug an older row gets: its ASCII words, or a tail derived from its id.
 *
 * Derived rather than random so `list` answers the same slug on every read
 * before `backfillSlugs` writes it down.
 */
function legacySlug(id: string, name: string): string {
  const ascii = asciiSlug(name);
  if (ascii.length >= 2) return ascii;
  let hash = 0;
  for (const char of id) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return `f-${hash.toString(36).slice(0, 6)}`;
}

function nextPosition(
  features: readonly Feature[],
  groupId: string | null,
): number {
  const siblings = features.filter((feature) => feature.groupId === groupId);
  if (siblings.length === 0) return 0;
  return Math.min(...siblings.map((feature) => feature.position)) - 1;
}
