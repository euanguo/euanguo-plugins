import type Database from "better-sqlite3";

import { createFeatureMetaStore, type FeatureMetaStore } from "./feature-meta-store.ts";
import {
  FEATURE_BRANCH_MIGRATION,
  FEATURE_CONTAINER_MIGRATION,
  FEATURE_CREATED_MIGRATION,
  FEATURE_HOST_MIGRATION,
  FEATURE_LABEL_MIGRATION,
  FEATURE_MEMBER_MIGRATION,
  FEATURE_MIGRATION,
  FEATURE_ROOT_CHOICE_MIGRATION,
  FEATURE_ROOT_MIGRATION,
  FEATURE_ROOT_SCHEME_MIGRATION,
  FEATURE_SLUG_MIGRATION,
  createFeatureStore,
  type FeatureStore,
} from "./feature-store.ts";
import { FEATURE_META_MIGRATIONS } from "./feature-meta-store.ts";

/**
 * The complete feature journal, in the order it has always run.
 *
 * The statements stay in their owner modules; this is the only place that
 * assembles the feature half and the feature metadata half into one history.
 */
export const FEATURE_REPOSITORY_MIGRATIONS = [
  FEATURE_MIGRATION,
  FEATURE_LABEL_MIGRATION,
  FEATURE_MEMBER_MIGRATION,
  FEATURE_ROOT_MIGRATION,
  FEATURE_HOST_MIGRATION,
  FEATURE_SLUG_MIGRATION,
  FEATURE_CREATED_MIGRATION,
  FEATURE_BRANCH_MIGRATION,
  FEATURE_ROOT_CHOICE_MIGRATION,
  FEATURE_ROOT_SCHEME_MIGRATION,
  FEATURE_CONTAINER_MIGRATION,
  ...FEATURE_META_MIGRATIONS,
] as const;

export interface FeatureRepository
  extends Omit<FeatureStore, "remove">,
    FeatureMetaStore {
  remove(featureId: string): boolean;
}

export function createFeatureRepository(
  db: Database.Database,
  metaStore: FeatureMetaStore = createFeatureMetaStore(db),
): FeatureRepository {
  const store = createFeatureStore(db);

  const remove: FeatureRepository["remove"] = (featureId) => {
    return db.transaction(() => {
      if (store.find(featureId) === undefined) return false;
      metaStore.deleteForFeature(featureId);
      return store.remove(featureId);
    })();
  };

  return {
    ...store,
    remove,
    ...metaStore,
  };
}
