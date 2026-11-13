import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";

import {
  FEATURE_BRIEF_MIGRATION,
  FEATURE_DECISION_INDEX_MIGRATION,
  type FeatureMetaStore,
} from "../lib/stores/feature-meta-store.ts";
import {
  FEATURE_CONTAINER_MIGRATION,
  FEATURE_MIGRATION,
} from "../lib/stores/feature-store.ts";
import {
  FEATURE_REPOSITORY_MIGRATIONS,
  createFeatureRepository,
  type FeatureRepository,
} from "../lib/stores/feature-repository.ts";

function createRepository(metaStore?: FeatureMetaStore) {
  const db = new Database(":memory:");
  for (const statement of FEATURE_REPOSITORY_MIGRATIONS) db.exec(statement);
  return { db, repository: createFeatureRepository(db, metaStore) };
}

function countByFeature(
  db: Database.Database,
  table: string,
  featureId: string,
  column = "feature_id",
): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`)
    .get(featureId) as { count: number };
  return row.count;
}

function seedFeatures(db: Database.Database, repository: FeatureRepository): void {
  const features = [
    { id: "f_first", name: "First", slug: "first", rootPath: "/features/first", hostId: "host_a" },
    { id: "f_second", name: "Second", slug: "second", rootPath: "/features/second", hostId: "host_b" },
  ];
  for (const feature of features) {
    repository.create(feature);
    repository.adopt(`env_${feature.slug}`, feature.id);
    repository.setBrief(feature.id, {
      goal: `Ship ${feature.name}`,
      nonGoals: "",
      acceptance: "Works",
      notes: "",
      openQuestions: ["Which region?"],
      blockers: [],
    });
    repository.addRef(feature.id, {
      kind: "ticket",
      refId: feature.id,
      url: `https://issues.example.com/${feature.slug}`,
      title: `${feature.name} ticket`,
    });
    repository.addDecision({
      featureId: feature.id,
      decision: {
        title: "Use SQLite",
        choice: "Store it",
        rationale: "The row must survive restarts",
        alternativesRejected: ["A file"],
        impact: "One migration",
        supersedes: null,
      },
      status: "confirmed",
      author: "human",
      threadId: null,
    });
    repository.recordBranch({
      featureId: feature.id,
      repositoryPath: `/code/${feature.slug}`,
      hostId: feature.hostId,
      branch: `feat/${feature.slug}`,
    });
  }
  repository.setFeaturesRoot("host_a", "/feature-roots/a", "bb-data-v1");
  repository.setFeaturesRoot("host_b", "/feature-roots/b", "bb-data-v1");
  repository.recordContainer("/feature-roots/a");
  repository.recordContainer("/feature-roots/b");
  const featureCount = db.prepare("SELECT COUNT(*) AS count FROM features").get() as { count: number };
  assert.equal(featureCount.count, 2);
}

describe("feature repository", () => {
  it("keeps the migration history in its original order", () => {
    const migrations = FEATURE_REPOSITORY_MIGRATIONS;
    assert.equal(migrations[0], FEATURE_MIGRATION);
    assert.equal(migrations[10], FEATURE_CONTAINER_MIGRATION);
    assert.equal(migrations[11], FEATURE_BRIEF_MIGRATION);
    assert.equal(migrations.at(-1), FEATURE_DECISION_INDEX_MIGRATION);
    assert.equal(migrations.length, 16);
  });

  it("removes one feature's rows in one cascade and leaves the other feature alone", () => {
    const { db, repository } = createRepository();
    try {
      seedFeatures(db, repository);

      assert.equal(repository.remove("f_first"), true);
      assert.equal(repository.find("f_first"), undefined);
      assert.equal(countByFeature(db, "features", "f_first", "id"), 0);
      for (const table of ["feature_workspace_labels", "feature_branches"]) {
        assert.equal(countByFeature(db, table, "f_first"), 0, table);
      }
      for (const table of ["feature_briefs", "feature_refs", "feature_decisions"]) {
        assert.equal(countByFeature(db, table, "f_first"), 0, table);
      }

      assert.notEqual(repository.find("f_second"), undefined);
      assert.deepEqual(repository.adoptions(), { env_second: "f_second" });
      assert.equal(countByFeature(db, "feature_briefs", "f_second"), 1);
      assert.equal(countByFeature(db, "feature_refs", "f_second"), 1);
      assert.equal(countByFeature(db, "feature_decisions", "f_second"), 1);
      assert.deepEqual(repository.branches("f_second"), [
        { repositoryPath: "/code/second", hostId: "host_b", branch: "feat/second" },
      ]);
      assert.deepEqual(
        repository.featuresRoots().sort((left, right) => left.hostId.localeCompare(right.hostId)),
        [
          { hostId: "host_a", rootPath: "/feature-roots/a" },
          { hostId: "host_b", rootPath: "/feature-roots/b" },
        ],
      );
      assert.deepEqual(repository.containers().sort(), [
        "/feature-roots/a",
        "/feature-roots/b",
      ]);
    } finally {
      db.close();
    }
  });

  it("rolls metadata deletion back when the feature-table delete fails", () => {
    const { db, repository } = createRepository();
    try {
      seedFeatures(db, repository);
      db.exec("DROP TABLE feature_workspace_labels");

      assert.throws(
        () => repository.remove("f_first"),
        /no such table: feature_workspace_labels/u,
      );
      assert.notEqual(repository.find("f_first"), undefined);
      assert.equal(countByFeature(db, "feature_briefs", "f_first"), 1);
      assert.equal(countByFeature(db, "feature_refs", "f_first"), 1);
      assert.equal(countByFeature(db, "feature_decisions", "f_first"), 1);
    } finally {
      db.close();
    }
  });
});
