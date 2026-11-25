import type Database from "better-sqlite3";

import { createFeatureMetaStore, FEATURE_META_MIGRATIONS, type FeatureMetaStore } from "./feature-meta-store.ts";
import { FEATURE_PRESET_MIGRATION } from "./feature-preset-store.ts";
import {
  createFeatureRefLinkStore,
  FEATURE_REF_LINK_MIGRATION,
  type FeatureRefLinkStore,
} from "./feature-ref-link-store.ts";
import {
  FEATURE_BRANCH_MIGRATION,
  FEATURE_CONTAINER_MIGRATION,
  FEATURE_LABEL_MIGRATION,
  FEATURE_MIGRATION,
  FEATURE_PARK_MIGRATIONS,
  FEATURE_ROOT_CHOICE_MIGRATION,
  createFeatureStore,
  type FeatureStore,
} from "./feature-store.ts";

/**
 * The complete feature journal, in Harbor v1 creation order.
 *
 * The statements stay in their owner modules; this is the only place that
 * assembles the feature half and the feature metadata half into one history.
 */
export const FEATURE_REPOSITORY_MIGRATIONS = [
  FEATURE_MIGRATION,
  FEATURE_LABEL_MIGRATION,
  FEATURE_BRANCH_MIGRATION,
  FEATURE_ROOT_CHOICE_MIGRATION,
  FEATURE_CONTAINER_MIGRATION,
  ...FEATURE_META_MIGRATIONS,
  ...FEATURE_PARK_MIGRATIONS,
  FEATURE_REF_LINK_MIGRATION,
  FEATURE_PRESET_MIGRATION,
] as const;

export interface FeatureRepository
  extends Omit<FeatureStore, "remove">,
    FeatureMetaStore {
  readonly refLinks: FeatureRefLinkStore;
  remove(featureId: string): boolean;
}

export function createFeatureRepository(
  db: Database.Database,
  metaStore: FeatureMetaStore = createFeatureMetaStore(db),
  refLinks: FeatureRefLinkStore = createFeatureRefLinkStore(db),
): FeatureRepository {
  const store = createFeatureStore(db);

  const remove: FeatureRepository["remove"] = (featureId) => {
    return db.transaction(() => {
      if (store.find(featureId) === undefined) return false;
      metaStore.deleteForFeature(featureId);
      refLinks.deleteForFeature(featureId);
      return store.remove(featureId);
    })();
  };

  return {
    ...store,
    refLinks,
    remove,
    ...metaStore,
  };
}
