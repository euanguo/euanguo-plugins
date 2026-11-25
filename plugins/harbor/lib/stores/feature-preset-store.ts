/**
 * Persistent storage for reusable multi-repo feature templates (`feature_presets`).
 */
import type Database from "better-sqlite3";

import {
  MAX_PRESETS,
  canonicalPresetName,
  normalizePresetRepos,
  validPresetName,
  type FeaturePreset,
  type FeaturePresetRepo,
} from "../domain/feature-presets.ts";

export const FEATURE_PRESET_MIGRATION = `CREATE TABLE IF NOT EXISTS feature_presets (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  base_branch TEXT,
  repos_json  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
)`;

export interface FeaturePresetStore {
  list(): FeaturePreset[];
  find(id: string): FeaturePreset | undefined;
  save(input: {
    id?: string | null;
    name: string;
    baseBranch?: string | null;
    repos: readonly FeaturePresetRepo[];
  }): FeaturePreset | null;
  remove(id: string): boolean;
}

export function createFeaturePresetStore(
  db: Database.Database,
): FeaturePresetStore {
  const decode = (row: {
    id: unknown;
    name: unknown;
    base_branch: unknown;
    repos_json: unknown;
    created_at: unknown;
    updated_at: unknown;
  }): FeaturePreset | null => {
    if (
      typeof row.id !== "string" ||
      !validPresetName(row.name) ||
      typeof row.repos_json !== "string" ||
      typeof row.created_at !== "number" ||
      typeof row.updated_at !== "number"
    ) {
      return null;
    }
    let parsedRepos: unknown = [];
    try {
      parsedRepos = JSON.parse(row.repos_json);
    } catch {
      parsedRepos = [];
    }
    return {
      id: row.id,
      name: canonicalPresetName(row.name),
      baseBranch:
        typeof row.base_branch === "string" && row.base_branch.trim().length > 0
          ? row.base_branch.trim()
          : null,
      repos: normalizePresetRepos(parsedRepos),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  };

  const list: FeaturePresetStore["list"] = () => {
    const rows = db
      .prepare(
        `SELECT id, name, base_branch, repos_json, created_at, updated_at
           FROM feature_presets
          ORDER BY updated_at DESC, name ASC`,
      )
      .all() as {
      id: unknown;
      name: unknown;
      base_branch: unknown;
      repos_json: unknown;
      created_at: unknown;
      updated_at: unknown;
    }[];
    return rows.flatMap((row) => {
      const parsed = decode(row);
      return parsed === null ? [] : [parsed];
    });
  };

  const find: FeaturePresetStore["find"] = (id) => {
    if (id.trim().length === 0) return undefined;
    const row = db
      .prepare(
        `SELECT id, name, base_branch, repos_json, created_at, updated_at
           FROM feature_presets WHERE id = ?`,
      )
      .get(id) as
      | {
          id: unknown;
          name: unknown;
          base_branch: unknown;
          repos_json: unknown;
          created_at: unknown;
          updated_at: unknown;
        }
      | undefined;
    return row === undefined ? undefined : (decode(row) ?? undefined);
  };

  const save: FeaturePresetStore["save"] = (input) => {
    if (!validPresetName(input.name)) return null;
    const name = canonicalPresetName(input.name);
    const repos = normalizePresetRepos(input.repos);
    const baseBranch =
      typeof input.baseBranch === "string" && input.baseBranch.trim().length > 0
        ? input.baseBranch.trim().slice(0, 200)
        : null;
    const now = Date.now();
    const existing =
      typeof input.id === "string" && input.id.trim().length > 0
        ? find(input.id.trim())
        : undefined;
    const id = existing?.id ?? `prs_${globalThis.crypto.randomUUID().slice(0, 8)}`;

    if (existing === undefined && list().length >= MAX_PRESETS) {
      return null;
    }

    const createdAt = existing?.createdAt ?? now;
    db.prepare(
      `INSERT INTO feature_presets
         (id, name, base_branch, repos_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         base_branch = excluded.base_branch,
         repos_json = excluded.repos_json,
         updated_at = excluded.updated_at`,
    ).run(id, name, baseBranch, JSON.stringify(repos), createdAt, now);

    return {
      id,
      name,
      baseBranch,
      repos,
      createdAt,
      updatedAt: now,
    };
  };

  const remove: FeaturePresetStore["remove"] = (id) => {
    if (id.trim().length === 0) return false;
    const info = db
      .prepare(`DELETE FROM feature_presets WHERE id = ?`)
      .run(id.trim());
    return info.changes > 0;
  };

  return { list, find, save, remove };
}
