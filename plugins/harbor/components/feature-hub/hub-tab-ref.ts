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

/**
 * Resolves the Hub repo directory for a workspace inside a feature, or null when
 * sitting at the feature root folder itself.
 */
export function hubDirectoryForWorkspace(input: {
  readonly featureId: string | null;
  readonly featureName?: string | null;
  readonly parentKey: string | null;
  readonly kind: string;
  readonly label: string;
  readonly path: string | null;
}): string | null {
  if (input.featureId === null || input.path === null) return null;
  const isMember =
    input.parentKey !== null ||
    input.kind === "git-worktree" ||
    (input.featureName !== null &&
      input.featureName !== undefined &&
      input.label !== input.featureName);
  if (!isMember) return null;
  const trimmed = input.path.replace(/\/+$/u, "");
  const slash = trimmed.lastIndexOf("/");
  const base = slash === -1 ? trimmed : trimmed.slice(slash + 1);
  return base.length > 0 ? base : input.label;
}

const SECTIONS = new Set<string>(["overview", "changes", "repos", "decisions"]);

/** Normalizes an optional Hub section with an explicit fallback. */
export function resolveHubSection(
  value: unknown,
  fallback: FeatureHubSection = "overview",
): FeatureHubSection {
  return typeof value === "string" && SECTIONS.has(value)
    ? (value as FeatureHubSection)
    : fallback;
}

/** Builds a stable deduplication key for incoming Feature Hub deep-link targets. */
export function buildHubTargetKey(input: {
  readonly featureId: string;
  readonly section?: FeatureHubSection;
  readonly directory?: string | null;
  readonly targetSeq?: number;
}): string {
  return `${input.featureId}\u0000${input.targetSeq ?? "init"}\u0000${input.section ?? ""}\u0000${input.directory ?? ""}`;
}

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
