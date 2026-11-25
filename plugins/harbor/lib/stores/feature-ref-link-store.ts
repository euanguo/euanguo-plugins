/**
 * Persistent storage for read-only reference directories linked into a feature
 * folder (`feature_ref_links`).
 */
import type Database from "better-sqlite3";

import {
  canonicalFeatureName,
  validFeatureId,
  type FeatureRefLink,
} from "../domain/features.ts";

export const FEATURE_REF_LINK_MIGRATION = `CREATE TABLE IF NOT EXISTS feature_ref_links (
  feature_id  TEXT NOT NULL,
  directory   TEXT NOT NULL,
  repository  TEXT NOT NULL,
  source_path TEXT NOT NULL,
  host_id     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (feature_id, directory)
)`;

export interface FeatureRefLinkStore {
  list(featureId?: string): FeatureRefLink[];
  add(input: {
    featureId: string;
    directory: string;
    repository: string;
    sourcePath: string;
    hostId: string;
  }): FeatureRefLink | null;
  remove(featureId: string, directory: string): boolean;
  deleteForFeature(featureId: string): void;
}

export function createFeatureRefLinkStore(
  db: Database.Database,
): FeatureRefLinkStore {
  const mapRows = (
    rows: {
      feature_id: unknown;
      directory: unknown;
      repository: unknown;
      source_path: unknown;
      host_id: unknown;
      created_at: unknown;
    }[],
  ): FeatureRefLink[] => {
    const out: FeatureRefLink[] = [];
    for (const row of rows) {
      if (
        !validFeatureId(row.feature_id) ||
        typeof row.directory !== "string" ||
        typeof row.repository !== "string" ||
        typeof row.source_path !== "string" ||
        typeof row.host_id !== "string" ||
        typeof row.created_at !== "number"
      ) {
        continue;
      }
      out.push({
        featureId: row.feature_id,
        directory: row.directory,
        repository: row.repository,
        sourcePath: row.source_path,
        hostId: row.host_id,
        createdAt: row.created_at,
      });
    }
    return out;
  };

  const list: FeatureRefLinkStore["list"] = (featureId) => {
    if (featureId !== undefined) {
      if (!validFeatureId(featureId)) return [];
      const rows = db
        .prepare(
          `SELECT feature_id, directory, repository, source_path, host_id, created_at
             FROM feature_ref_links
            WHERE feature_id = ?
            ORDER BY created_at ASC, directory ASC`,
        )
        .all(featureId) as {
        feature_id: unknown;
        directory: unknown;
        repository: unknown;
        source_path: unknown;
        host_id: unknown;
        created_at: unknown;
      }[];
      return mapRows(rows);
    }
    const rows = db
      .prepare(
        `SELECT feature_id, directory, repository, source_path, host_id, created_at
           FROM feature_ref_links
          ORDER BY created_at ASC, directory ASC`,
      )
      .all() as {
      feature_id: unknown;
      directory: unknown;
      repository: unknown;
      source_path: unknown;
      host_id: unknown;
      created_at: unknown;
    }[];
    return mapRows(rows);
  };

  const add: FeatureRefLinkStore["add"] = (input) => {
    if (!validFeatureId(input.featureId)) return null;
    const directory = canonicalFeatureName(input.directory);
    const repository = canonicalFeatureName(input.repository);
    const sourcePath = input.sourcePath.trim();
    const hostId = input.hostId.trim();
    if (
      directory.length === 0 ||
      directory.includes("/") ||
      directory.includes("\\") ||
      repository.length === 0 ||
      sourcePath.length === 0 ||
      hostId.length === 0
    ) {
      return null;
    }
    const createdAt = Date.now();
    db.prepare(
      `INSERT INTO feature_ref_links
         (feature_id, directory, repository, source_path, host_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(feature_id, directory) DO UPDATE SET
         repository = excluded.repository,
         source_path = excluded.source_path,
         host_id = excluded.host_id`,
    ).run(
      input.featureId,
      directory,
      repository,
      sourcePath,
      hostId,
      createdAt,
    );
    return {
      featureId: input.featureId,
      directory,
      repository,
      sourcePath,
      hostId,
      createdAt,
    };
  };

  const remove: FeatureRefLinkStore["remove"] = (featureId, directory) => {
    if (!validFeatureId(featureId) || directory.trim().length === 0) {
      return false;
    }
    const info = db
      .prepare(
        `DELETE FROM feature_ref_links WHERE feature_id = ? AND directory = ?`,
      )
      .run(featureId, directory.trim());
    return info.changes > 0;
  };

  const deleteForFeature: FeatureRefLinkStore["deleteForFeature"] = (
    featureId,
  ) => {
    if (!validFeatureId(featureId)) return;
    db.prepare(`DELETE FROM feature_ref_links WHERE feature_id = ?`).run(
      featureId,
    );
  };

  return { list, add, remove, deleteForFeature };
}
