import { useMemo } from "react";

import type { Feature } from "@/lib/features";

/**
 * Feature ids to names, for the badge a worktree row draws.
 *
 * A row carries only the label, which is an id. Resolving it once keeps the row
 * from holding a copy of the feature list it would have to keep in step with.
 */
export function useFeatureNames(
  features: readonly Feature[],
): ReadonlyMap<string, string> {
  return useMemo(
    () => new Map(features.map((feature) => [feature.id, feature.name])),
    [features],
  );
}
