import {
  featureForPath,
  type Feature,
  type FeatureAssignment,
} from "../../lib/domain/features.ts";

export const FEATURE_HUB_TAB_ID = "feature-hub";

export type FeatureHubSection =
  | "overview"
  | "changes"
  | "repos"
  | "decisions";

export type FeatureHubTabTarget = {
  readonly section: FeatureHubSection;
  readonly directory: string | null;
};

const SECTIONS = new Set<string>(["overview", "changes", "repos", "decisions"]);

export const FEATURE_HUB_TAB_REF = {
  id: FEATURE_HUB_TAB_ID,
  context: { kind: "thread" as const },
  availability: "fixed" as const,
  experimental_target: {
    validate(value: unknown): value is FeatureHubTabTarget {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
      }
      const record = value as Record<string, unknown>;
      if (typeof record.section !== "string" || !SECTIONS.has(record.section)) {
        return false;
      }
      if (
        record.directory !== undefined &&
        record.directory !== null &&
        typeof record.directory !== "string"
      ) {
        return false;
      }
      return true;
    },
  },
};

/**
 * Resolves which active or parked Harbor feature owns a thread pane from its
 * environment path or adopted worktree assignment.
 */
export function resolveThreadFeature(input: {
  readonly environmentId: string | null;
  readonly environmentPath: string | null;
  readonly features: readonly Feature[];
  readonly adoptions: FeatureAssignment;
}): Feature | null {
  const candidates = input.features.filter(
    (feature) => feature.state !== "archived",
  );
  if (input.environmentPath !== null) {
    const byPath = featureForPath(candidates, input.environmentPath);
    if (byPath !== null) return byPath;
  }
  if (input.environmentId !== null) {
    const adoptedId = input.adoptions[input.environmentId];
    if (adoptedId !== undefined) {
      return candidates.find((feature) => feature.id === adoptedId) ?? null;
    }
  }
  return null;
}
