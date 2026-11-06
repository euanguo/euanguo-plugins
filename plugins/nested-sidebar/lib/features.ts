/**
 * Features, and the label that files a workspace under one.
 *
 * A feature is a unit of work that spans repositories. A project group answers
 * "where does this project live"; a feature answers "what am I working on". The
 * two axes are orthogonal, so a feature is filed into a group of its own and
 * the projects it touches stay where they were.
 *
 * The label lives on the workspace, not on the feature. That direction matters:
 * a worktree usually exists before the work is named, and a feature that owned
 * a member list would have to distinguish planned members from real ones. A
 * label has one meaning, and the workspace it names already exists.
 *
 * One workspace carries one label. A worktree is one branch, and one branch is
 * one piece of work; two features that need the same code need two worktrees.
 */

import { validGroupId } from "./groups.ts";

export const MAX_FEATURES = 500;
export const MAX_FEATURE_NAME_LENGTH = 60;
export const MAX_FEATURE_ID_LENGTH = 100;

const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/;

/**
 * Where a feature is in its life.
 *
 * `draft` is a feature with nothing materialized yet. It is a real destination
 * in the tree, not a hidden placeholder, because a person who just named a
 * piece of work expects to find it on the sidebar immediately.
 */
export const FEATURE_STATES = ["draft", "active", "archived"] as const;
export type FeatureState = (typeof FEATURE_STATES)[number];

export const DEFAULT_FEATURE_STATE: FeatureState = "draft";

export function validFeatureState(value: unknown): value is FeatureState {
  return (
    typeof value === "string" &&
    (FEATURE_STATES as readonly string[]).includes(value)
  );
}

export interface Feature {
  readonly id: string;
  readonly name: string;
  readonly state: FeatureState;
  /**
   * The group this feature is filed under, or null for Ungrouped.
   *
   * This is an archive position, not a containment rule. A feature filed under
   * IM may label a worktree of a project filed under Ot, and the sidebar shows
   * it there. Filing is where you look for it; membership is what it touches.
   */
  readonly groupId: string | null;
  /** Explicit user order within its group; ties fall back to the name. */
  readonly position: number;
  /**
   * Where the feature's directory lives once it has one.
   *
   * Null on a draft: naming a piece of work does not create a directory, and a
   * path stored before the directory exists is a path that can be wrong.
   */
  readonly rootPath: string | null;
  /** The machine that holds `rootPath`, once it exists. */
  readonly hostId: string | null;
}

/**
 * One worktree a feature has materialized.
 *
 * The label table answers "which feature does this environment belong to". This
 * answers "what did the feature create", which is a different question while a
 * worktree has no environment yet: bb creates one when a thread first runs
 * there, and until then a label keyed by environment id has nothing to key on.
 */
export interface FeatureMember {
  readonly featureId: string;
  /**
   * The project the member's repository belongs to.
   *
   * A feature spans projects, but every bb thread belongs to one, so the root
   * conversation borrows the first member's project. Storing it here keeps that
   * decision out of the renderer.
   */
  readonly projectId: string;
  /** The child directory name inside the feature directory. */
  readonly directory: string;
  /** The repository's own name, for the record and the context file. */
  readonly repository: string;
  readonly branch: string;
  /** Absolute path of the worktree. */
  readonly path: string;
  readonly hostId: string;
  /** The bb environment, once one exists for this path. */
  readonly environmentId: string | null;
}

/** environmentId -> featureId. A workspace without a label is absent. */
export type FeatureAssignment = Readonly<Record<string, string>>;

export function validFeatureId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_FEATURE_ID_LENGTH &&
    value.trim() === value &&
    !CONTROL_CHARACTER.test(value)
  );
}

export function validFeatureName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= MAX_FEATURE_NAME_LENGTH &&
    !CONTROL_CHARACTER.test(value)
  );
}

export function canonicalFeatureName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** The stored name for a create or rename, or null when nothing is storable. */
export function featureNameIntent(value: string): string | null {
  const name = canonicalFeatureName(value);
  if (name.length === 0) return null;
  if (name.length > MAX_FEATURE_NAME_LENGTH) return null;
  return name;
}

/**
 * A rename, or null when the draft says nothing new.
 *
 * Shared by the inline editor and the manager so the two entry points cannot
 * disagree about what an empty draft or an unchanged one means.
 */
export function featureRenameIntent(
  draft: string,
  currentName: string,
): string | null {
  const name = featureNameIntent(draft);
  if (name === null || name === currentName) return null;
  return name;
}

export function sortFeatures(features: readonly Feature[]): Feature[] {
  return [...features].sort(
    (left, right) =>
      left.position - right.position || left.name.localeCompare(right.name),
  );
}

/**
 * Every feature filed under a group, in display order.
 *
 * A feature whose `groupId` names a group that no longer exists is returned
 * under `null` rather than dropped: the tree draws it in Ungrouped, and a
 * delete that forgot to move its features would otherwise make them vanish.
 */
export function featuresByGroup(
  features: readonly Feature[],
  validGroupIds: ReadonlySet<string>,
): Map<string | null, Feature[]> {
  const buckets = new Map<string | null, Feature[]>();
  for (const feature of sortFeatures(features)) {
    const groupId =
      feature.groupId !== null && validGroupIds.has(feature.groupId)
        ? feature.groupId
        : null;
    const bucket = buckets.get(groupId) ?? [];
    bucket.push(feature);
    buckets.set(groupId, bucket);
  }
  return buckets;
}

/**
 * Every workspace label, with pointers at features that no longer exist.
 *
 * A released feature leaves its labels behind. Dropping them here is what
 * keeps a deleted feature from drawing an empty row, and it happens on read
 * rather than through a cleanup pass, so a database edited by hand or an
 * interrupted delete cannot leave a ghost.
 */
export function liveAssignment(
  assignment: FeatureAssignment,
  validFeatureIds: ReadonlySet<string>,
): FeatureAssignment {
  const live: Record<string, string> = {};
  for (const [environmentId, featureId] of Object.entries(assignment)) {
    if (validFeatureIds.has(featureId)) live[environmentId] = featureId;
  }
  return live;
}

/**
 * Move a label. Returns the next assignment, or null when the request is not a
 * real change — the caller then skips the round trip.
 */
export function assignWorkspaceFeature(
  assignment: FeatureAssignment,
  validFeatureIds: ReadonlySet<string>,
  environmentId: string,
  featureId: string | null,
): FeatureAssignment | null {
  const current = assignment[environmentId] ?? null;
  if (current === featureId) return null;
  if (featureId !== null && !validFeatureIds.has(featureId)) return null;
  const next: Record<string, string> = { ...assignment };
  if (featureId === null) delete next[environmentId];
  else next[environmentId] = featureId;
  return next;
}

/** Environment ids filed under one feature. */
export function environmentsOfFeature(
  assignment: FeatureAssignment,
  featureId: string,
): string[] {
  return Object.entries(assignment)
    .filter(([, assigned]) => assigned === featureId)
    .map(([environmentId]) => environmentId);
}

/**
 * The environment a row's label is about.
 *
 * A workspace row knows its environment id; a project row does not. A project
 * whose only workspace is labeled borrows that workspace's label for display,
 * because it is the common case and asking the user to expand the row to see
 * the answer would be worse.
 */
export function labelForProject(
  assignment: FeatureAssignment,
  environments: readonly (string | null)[],
): string | null {
  const labels = new Set<string>();
  for (const environmentId of environments) {
    if (environmentId === null) continue;
    const featureId = assignment[environmentId];
    if (featureId !== undefined) labels.add(featureId);
  }
  return labels.size === 1 ? [...labels][0] ?? null : null;
}

/**
 * A feature id the store will accept, derived from the name.
 *
 * The id never changes after creation, so renaming a feature does not move it
 * and does not break its labels. Duplicates get a numeric suffix rather than
 * being refused, because naming two pieces of work the same thing is not a
 * mistake worth blocking.
 */
export function featureIdFrom(name: string, taken: ReadonlySet<string>): string {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "feature";
  const first = `feat_${base}`;
  if (!taken.has(first)) return first;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `feat_${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Whether a value can be filed into the named group. */
export function validFeatureGroup(
  groupId: string | null,
  validGroupIds: ReadonlySet<string>,
): boolean {
  return groupId === null || validGroupId(groupId) && validGroupIds.has(groupId);
}
