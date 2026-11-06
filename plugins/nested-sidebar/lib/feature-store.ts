/**
 * Feature storage: the features themselves, and the label each workspace
 * carries.
 *
 * Two tables, and the split is the point. `features` holds what the user named.
 * `feature_workspace_labels` holds which existing workspace belongs to which
 * feature, keyed by environment id. Nothing about a worktree's path, branch, or
 * owning project is copied here — those are bb's records and the disk's facts,
 * and a copy would go stale silently.
 *
 * Rows are validated on read as well as write. A hand-edited database, or one
 * written by a build that stored a shape this one does not accept, degrades to
 * a missing row rather than reaching the tree.
 */

import type Database from "better-sqlite3";
import {
  DEFAULT_FEATURE_STATE,
  MAX_FEATURES,
  canonicalFeatureName,
  liveAssignment,
  validFeatureId,
  validFeatureName,
  validFeatureState,
  type Feature,
  type FeatureAssignment,
  type FeatureMember,
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
 * The directory and machine columns, added after the first release ran.
 *
 * A separate statement rather than an edit to `FEATURE_MIGRATION` above: bb
 * checks the journal by index and hash, so changing a statement that a database
 * already applied makes the whole plugin fail to load with "migration 12 does
 * not match the recorded statement". Appending is the only safe shape.
 */
export const FEATURE_ROOT_MIGRATION = `ALTER TABLE features ADD COLUMN root_path TEXT`;
export const FEATURE_HOST_MIGRATION = `ALTER TABLE features ADD COLUMN host_id TEXT`;

export const FEATURE_LABEL_MIGRATION = `CREATE TABLE IF NOT EXISTS feature_workspace_labels (
  environment_id TEXT PRIMARY KEY,
  feature_id     TEXT NOT NULL,
  updated_at     INTEGER NOT NULL
)`;

/**
 * What a feature actually created on disk.
 *
 * Separate from the label table because the two answer different questions. A
 * worktree created here has no environment until a thread runs in it, so the
 * label table has nothing to key on; this table records the directory, and the
 * label is added later when bb makes the environment.
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

interface FeatureRow {
  id: unknown;
  name: unknown;
  state: unknown;
  group_id: unknown;
  position: unknown;
  root_path: unknown;
  host_id: unknown;
}

interface MemberRow {
  feature_id: unknown;
  path: unknown;
  directory: unknown;
  repository: unknown;
  branch: unknown;
  host_id: unknown;
  environment_id: unknown;
}

interface LabelRow {
  environment_id: unknown;
  feature_id: unknown;
}

export interface FeatureStore {
  readonly migrations: readonly string[];
  list(): Feature[];
  /** environmentId -> featureId, already stripped of released features. */
  labels(): FeatureAssignment;
  create(input: {
    id: string;
    name: string;
    groupId: string | null;
    state?: FeatureState;
  }): Feature | null;
  rename(featureId: string, name: string): boolean;
  setState(featureId: string, state: FeatureState): boolean;
  setGroup(featureId: string, groupId: string | null): boolean;
  reorder(featureIds: readonly string[], groupId: string | null): boolean;
  /** Deletes the feature and every label that pointed at it. */
  remove(featureId: string): boolean;
  label(environmentId: string, featureId: string | null): boolean;
  /** Moves every label of a deleted group's features to Ungrouped. */
  releaseGroup(groupId: string): number;
  members(featureId: string): FeatureMember[];
  recordMember(member: FeatureMember): boolean;
  forgetMember(featureId: string, path: string): boolean;
  setRoot(featureId: string, rootPath: string, hostId: string): boolean;
}

export function createFeatureStore(db: Database.Database): FeatureStore {
  const list = (): Feature[] => {
    const rows = db
      .prepare(
        `SELECT id, name, state, group_id, position, root_path, host_id FROM features
          ORDER BY position ASC, name ASC LIMIT ?`,
      )
      .all(MAX_FEATURES + 1) as FeatureRow[];
    const features: Feature[] = [];
    for (const row of rows) {
      if (!validFeatureId(row.id) || !validFeatureName(row.name)) continue;
      const groupId =
        typeof row.group_id === "string" && validGroupId(row.group_id)
          ? row.group_id
          : null;
      features.push({
        id: row.id,
        name: canonicalFeatureName(row.name),
        state: validFeatureState(row.state)
          ? row.state
          : DEFAULT_FEATURE_STATE,
        groupId,
        position:
          typeof row.position === "number" && Number.isFinite(row.position)
            ? row.position
            : features.length,
        rootPath: typeof row.root_path === "string" ? row.root_path : null,
        hostId: typeof row.host_id === "string" ? row.host_id : null,
      });
      if (features.length === MAX_FEATURES) break;
    }
    return features;
  };

  const labels = (): FeatureAssignment => {
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

  const find = (featureId: string): Feature | undefined =>
    list().find((feature) => feature.id === featureId);

  const create: FeatureStore["create"] = (input) => {
    if (!validFeatureId(input.id) || !validFeatureName(input.name)) return null;
    const current = list();
    if (current.length >= MAX_FEATURES) return null;
    if (current.some((feature) => feature.id === input.id)) return null;
    const now = Date.now();
    // New features land at the top of their group: a person who just named
    // something is about to work on it, and the bottom of a long list is where
    // it would be least findable.
    const position = Math.min(
      0,
      ...current
        .filter((feature) => feature.groupId === input.groupId)
        .map((feature) => feature.position),
    ) - 1;
    db.prepare(
      `INSERT INTO features (id, name, state, group_id, position, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      input.id,
      canonicalFeatureName(input.name),
      input.state ?? DEFAULT_FEATURE_STATE,
      input.groupId,
      position,
      now,
    );
    return find(input.id) ?? null;
  };

  const rename: FeatureStore["rename"] = (featureId, name) => {
    if (!validFeatureId(featureId) || !validFeatureName(name)) return false;
    if (find(featureId) === undefined) return false;
    db.prepare(
      `UPDATE features SET name = ?, updated_at = ? WHERE id = ?`,
    ).run(canonicalFeatureName(name), Date.now(), featureId);
    return true;
  };

  const setState: FeatureStore["setState"] = (featureId, state) => {
    if (!validFeatureId(featureId) || !validFeatureState(state)) return false;
    if (find(featureId) === undefined) return false;
    db.prepare(
      `UPDATE features SET state = ?, updated_at = ? WHERE id = ?`,
    ).run(state, Date.now(), featureId);
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
    const run = db.transaction(() => {
      ordered.forEach((id, index) => statement.run(index, now, id));
    });
    run();
    return true;
  };

  const remove: FeatureStore["remove"] = (featureId) => {
    if (!validFeatureId(featureId)) return false;
    if (find(featureId) === undefined) return false;
    const run = db.transaction(() => {
      db.prepare(`DELETE FROM feature_workspace_labels WHERE feature_id = ?`).run(
        featureId,
      );
      db.prepare(`DELETE FROM features WHERE id = ?`).run(featureId);
    });
    run();
    return true;
  };

  const label: FeatureStore["label"] = (environmentId, featureId) => {
    if (environmentId.trim().length === 0) return false;
    if (featureId !== null && find(featureId) === undefined) return false;
    const run = db.transaction(() => {
      if (featureId === null) {
        db.prepare(
          `DELETE FROM feature_workspace_labels WHERE environment_id = ?`,
        ).run(environmentId);
      } else {
        db.prepare(
          `INSERT INTO feature_workspace_labels (environment_id, feature_id, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(environment_id) DO UPDATE SET
             feature_id = excluded.feature_id, updated_at = excluded.updated_at`,
        ).run(environmentId, featureId, Date.now());
      }
    });
    run();
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
    const run = db.transaction(() => {
      for (const feature of affected) statement.run(now, feature.id);
    });
    run();
    return affected.length;
  };

  const members: FeatureStore["members"] = (featureId) => {
    if (!validFeatureId(featureId)) return [];
    const rows = db
      .prepare(
        `SELECT feature_id, path, directory, repository, branch, host_id, environment_id
           FROM feature_members WHERE feature_id = ? ORDER BY directory ASC`,
      )
      .all(featureId) as MemberRow[];
    const result: FeatureMember[] = [];
    for (const row of rows) {
      if (typeof row.path !== "string" || row.path.length === 0) continue;
      if (typeof row.directory !== "string" || row.directory.length === 0) continue;
      if (typeof row.repository !== "string") continue;
      if (typeof row.branch !== "string" || row.branch.length === 0) continue;
      if (typeof row.host_id !== "string") continue;
      result.push({
        featureId,
        path: row.path,
        directory: row.directory,
        repository: row.repository,
        branch: row.branch,
        hostId: row.host_id,
        environmentId:
          typeof row.environment_id === "string" ? row.environment_id : null,
      });
    }
    return result;
  };

  const recordMember: FeatureStore["recordMember"] = (member) => {
    if (!validFeatureId(member.featureId)) return false;
    if (member.path.trim().length === 0) return false;
    if (member.directory.trim().length === 0) return false;
    if (find(member.featureId) === undefined) return false;
    db.prepare(
      `INSERT INTO feature_members
         (feature_id, path, directory, repository, branch, host_id, environment_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(feature_id, path) DO UPDATE SET
         directory = excluded.directory,
         repository = excluded.repository,
         branch = excluded.branch,
         host_id = excluded.host_id,
         environment_id = COALESCE(excluded.environment_id, feature_members.environment_id),
         updated_at = excluded.updated_at`,
    ).run(
      member.featureId,
      member.path,
      member.directory,
      member.repository,
      member.branch,
      member.hostId,
      member.environmentId,
      Date.now(),
    );
    return true;
  };

  const forgetMember: FeatureStore["forgetMember"] = (featureId, path) => {
    if (!validFeatureId(featureId)) return false;
    const result = db
      .prepare(
        `DELETE FROM feature_members WHERE feature_id = ? AND path = ?`,
      )
      .run(featureId, path);
    return result.changes > 0;
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

  return {
    migrations: [
      FEATURE_MIGRATION,
      FEATURE_LABEL_MIGRATION,
      FEATURE_MEMBER_MIGRATION,
      FEATURE_ROOT_MIGRATION,
      FEATURE_HOST_MIGRATION,
    ],
    list,
    labels,
    create,
    rename,
    setState,
    setGroup,
    reorder,
    remove,
    label,
    releaseGroup,
    members,
    recordMember,
    forgetMember,
    setRoot,
  };
}

function nextPosition(
  features: readonly Feature[],
  groupId: string | null,
): number {
  const siblings = features.filter((feature) => feature.groupId === groupId);
  if (siblings.length === 0) return 0;
  return Math.min(...siblings.map((feature) => feature.position)) - 1;
}
