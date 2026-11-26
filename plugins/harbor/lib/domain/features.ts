/**
 * Features: one piece of work that spans repositories, and the directory it
 * lives in.
 *
 * A feature *is* a directory. Everything about what belongs to it is read from
 * the disk rather than written down beside it:
 *
 * - a worktree belongs to a feature when it sits inside the feature's
 *   directory;
 * - a thread belongs to a feature when its workspace path is inside that
 *   directory — the root conversation runs in the directory itself, a thread in
 *   a member worktree runs one level down.
 *
 * Deciding membership by path is what makes every entry point agree. A thread
 * started from Harbor's `+`, from bb's own composer, from the CLI or by an agent
 * all land in the same place, and none of them has to remember to say so. A
 * label written at spawn time could only ever cover the callers that knew about
 * it.
 *
 * The one fact that has to be stored is an exception: a worktree that already
 * existed *outside* any feature directory can be adopted into one. That is a
 * label keyed by environment id, and a path inside a feature directory always
 * wins over it.
 *
 * A project group answers "where does this project live"; a feature answers
 * "what am I working on". A feature is filed under a group the way a project is,
 * and that filing is where you look for it, not what it contains.
 */

import {
  FEATURE_STATES,
  MAX_FEATURE_ID_LENGTH,
  MAX_FEATURE_NAME_LENGTH,
  MAX_FEATURE_SLUG_LENGTH,
  MAX_FEATURES,
  MAX_PARK_NOTE_LENGTH,
  MAX_PARK_REASON_LENGTH,
  PARK_REASON_PRESETS,
  type Feature,
  type FeatureMember,
  type FeatureMemberRole,
  type FeatureRefLink,
  type FeatureState,
  type ParkReasonPreset,
} from "../schemas/feature.ts";

export {
  FEATURE_STATES,
  MAX_FEATURE_ID_LENGTH,
  MAX_FEATURE_NAME_LENGTH,
  MAX_FEATURE_SLUG_LENGTH,
  MAX_FEATURES,
  MAX_PARK_NOTE_LENGTH,
  MAX_PARK_REASON_LENGTH,
  PARK_REASON_PRESETS,
  type Feature,
  type FeatureMember,
  type FeatureMemberRole,
  type FeatureRefLink,
  type FeatureState,
  type ParkReasonPreset,
};

const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/;
const CONTROL_CHARACTER_ALL = /[\u0000-\u001F\u007F]/g;

export const DEFAULT_FEATURE_STATE: FeatureState = "active";

export function validFeatureState(value: unknown): value is FeatureState {
  return (
    typeof value === "string" &&
    (FEATURE_STATES as readonly string[]).includes(value)
  );
}

/** A stored state, read leniently: unrecognized values fall back to active. */
export function readFeatureState(value: unknown): FeatureState {
  if (value === "archived") return "archived";
  if (value === "parked") return "parked";
  return "active";
}

export function normalizeParkReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(CONTROL_CHARACTER_ALL, " ").trim().slice(0, MAX_PARK_REASON_LENGTH);
  return cleaned.length === 0 ? null : cleaned;
}

export function normalizeParkNote(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(CONTROL_CHARACTER_ALL, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, MAX_PARK_NOTE_LENGTH);
  return cleaned.length === 0 ? null : cleaned;
}

/** environmentId -> featureId, for worktrees adopted from outside. */
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
 * Shared by every entry point so they cannot disagree about what an empty draft
 * or an unchanged one means.
 */
export function featureRenameIntent(
  draft: string,
  currentName: string,
): string | null {
  const name = featureNameIntent(draft);
  if (name === null || name === currentName) return null;
  return name;
}

/**
 * Lowercase ASCII letters, digits and single dashes; starts and ends with a
 * letter or digit. Narrower than git's own ref rules on purpose: every name
 * this admits is also a safe directory name on every platform.
 */
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u;

export function validFeatureSlug(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_FEATURE_SLUG_LENGTH &&
    SLUG_PATTERN.test(value) &&
    !value.includes("--")
  );
}

/**
 * The ASCII words in a name, or the empty string when it has none.
 *
 * CJK has no transliteration here, so `订单通知改造` has no slug of its own
 * and the caller falls back to a short random one. Silently producing
 * `feature` for every such name is what made two unrelated features ask for
 * the same branch.
 */
export function asciiSlug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, MAX_FEATURE_SLUG_LENGTH)
    .replace(/-+$/u, "");
}

/**
 * A slug for a new feature that no other feature holds.
 *
 * A name with fewer than two ASCII characters gets `f-` and a random tail. That
 * is not pretty, and the create dialog says so and offers the field — but it is
 * unique, which a transliteration guess would not be.
 */
export function suggestFeatureSlug(
  name: string,
  taken: ReadonlySet<string>,
  random: () => string = randomTail,
): string {
  const ascii = asciiSlug(name);
  const base = ascii.length >= 2 ? ascii : `f-${random()}`;
  return uniqueSlug(base, taken);
}

export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const tail = `-${suffix}`;
    const prefix = base
      .slice(0, MAX_FEATURE_SLUG_LENGTH - tail.length)
      .replace(/-+$/u, "");
    const candidate = `${prefix}${tail}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * The branch name suggested for a repository added to a feature.
 *
 * A suggestion only: each repository can take its own name (or an existing
 * branch), and nothing downstream assumes the members agree.
 */
export function featureBranch(slug: string): string {
  return `feat/${slug}`;
}

/** A new, opaque feature id. */
export function newFeatureId(random: () => string = randomTail): string {
  return `f_${random()}${random()}`;
}

const DRAFT_ADJECTIVES = [
  "amber",
  "bright",
  "calm",
  "cedar",
  "clear",
  "coral",
  "crisp",
  "frost",
  "harbor",
  "ivory",
  "jade",
  "maple",
  "misty",
  "olive",
  "opal",
  "pebble",
  "pine",
  "quiet",
  "river",
  "sage",
  "silver",
  "solar",
  "swift",
  "velvet",
] as const;

const DRAFT_NOUNS = [
  "anchor",
  "beacon",
  "bridge",
  "brook",
  "canyon",
  "comet",
  "cove",
  "delta",
  "falcon",
  "finch",
  "glade",
  "haven",
  "heron",
  "lantern",
  "linden",
  "meadow",
  "otter",
  "peak",
  "quill",
  "reef",
  "ridge",
  "spark",
  "trail",
  "wren",
] as const;

function randomIndex(length: number): number {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return (buf[0] ?? 0) % length;
}

/**
 * Generates a friendly, unique draft feature name when the user starts a
 * conversation before naming the feature or creating branches.
 */
export function generateDraftFeatureName(
  takenNames?: ReadonlySet<string>,
  pickIndex: (length: number) => number = randomIndex,
): string {
  const taken = takenNames ?? new Set<string>();
  const startA = pickIndex(DRAFT_ADJECTIVES.length) % DRAFT_ADJECTIVES.length;
  const startN = pickIndex(DRAFT_NOUNS.length) % DRAFT_NOUNS.length;
  for (let offset = 0; offset < 32; offset += 1) {
    const adj = DRAFT_ADJECTIVES[(startA + offset) % DRAFT_ADJECTIVES.length];
    const noun = DRAFT_NOUNS[(startN + offset * 7) % DRAFT_NOUNS.length];
    const candidate = `Draft · ${adj}-${noun}`;
    if (!taken.has(candidate)) return candidate;
  }
  const base = `Draft · ${DRAFT_ADJECTIVES[startA]}-${DRAFT_NOUNS[startN]}`;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Whether a feature still carries an auto-generated or explicit draft title. */
export function isDraftFeatureName(name: string): boolean {
  return /^draft(?:\s*[·:-]|\s+|$)/iu.test(name.trim());
}

function randomTail(): string {
  const bytes = new Uint8Array(4);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes]
    .map((byte) => (byte % 36).toString(36))
    .join("")
    .padEnd(4, "0");
}

export function sortFeatures(features: readonly Feature[]): Feature[] {
  return [...features].sort(
    (left, right) =>
      left.position - right.position || left.name.localeCompare(right.name),
  );
}

/**
 * Adoption labels, with pointers at features that no longer exist dropped.
 *
 * A deleted feature leaves its labels behind if the delete was interrupted.
 * Dropping them on read rather than through a cleanup pass means a database
 * edited by hand cannot leave a ghost row either.
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
 * The feature whose directory contains a path, if any.
 *
 * Longest prefix wins, so a feature directory nested inside another still
 * resolves to the closer one. A sibling that merely shares a prefix —
 * `/f/ai` and `/f/ai-2` — is not a match: the comparison is by path segment.
 */
export function featureForPath(
  features: readonly Feature[],
  path: string | null,
): Feature | null {
  if (path === null || path.trim().length === 0) return null;
  const normalized = normalizeFeaturePath(path);
  let best: Feature | null = null;
  let bestLength = -1;
  for (const feature of features) {
    if (feature.rootPath === null) continue;
    const root = normalizeFeaturePath(feature.rootPath);
    if (normalized !== root && !normalized.startsWith(`${root}/`)) continue;
    if (root.length > bestLength) {
      best = feature;
      bestLength = root.length;
    }
  }
  return best;
}

/** Whether a path is a feature's own directory rather than one of its members. */
export function isFeatureRoot(feature: Feature, path: string | null): boolean {
  if (path === null || feature.rootPath === null) return false;
  return normalizeFeaturePath(path) === normalizeFeaturePath(feature.rootPath);
}

/**
 * Which feature a workspace belongs to.
 *
 * The path is asked first and wins outright: a worktree inside feature A's
 * directory is A's, whatever an old label says. The adoption label answers only
 * for a workspace that no feature directory contains.
 */
export function featureOfWorkspace(input: {
  readonly features: readonly Feature[];
  readonly adoptions: FeatureAssignment;
  readonly environmentId: string | null;
  readonly path: string | null;
}): Feature | null {
  const byPath = featureForPath(input.features, input.path);
  if (byPath !== null) return byPath;
  if (input.environmentId === null) return null;
  const adopted = input.adoptions[input.environmentId];
  if (adopted === undefined) return null;
  return input.features.find((feature) => feature.id === adopted) ?? null;
}

export function normalizeFeaturePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/\/+$/u, "");
}

/** What deleting or finishing a feature would take away, as facts. */
export interface FeatureRemovalSurvey {
  readonly worktrees: readonly {
    readonly path: string;
    readonly changedFiles: number;
    readonly untrackedFiles: number;
    readonly aheadCommits: number | null;
    readonly missing: boolean;
    readonly error?: string | null;
  }[];
  /** Live threads in the feature's directory and its members. */
  readonly threadCount: number;
}

/**
 * What a person has to read before a feature's worktrees are taken back.
 *
 * Uncommitted and untracked files are lost by either finishing or deleting;
 * unpushed commits survive a finish because the branch is kept, so they only
 * warn on a delete that also removes the branches. Threads are archived, not
 * lost, so they are said but never require the typed confirmation on their own.
 */
export function planFeatureRemoval(
  survey: FeatureRemovalSurvey,
  options: { readonly deletesBranches: boolean } = { deletesBranches: true },
): { readonly warnings: string[]; readonly requiresConfirmation: boolean } {
  const warnings: string[] = [];
  let loses = false;
  const plural = (count: number, one: string, many: string) =>
    `${count} ${count === 1 ? one : many}`;
  const dirty = survey.worktrees.filter((worktree) => worktree.changedFiles > 0);
  if (dirty.length > 0) {
    const files = dirty.reduce((total, worktree) => total + worktree.changedFiles, 0);
    warnings.push(
      `${plural(files, "changed file", "changed files")} in ${plural(dirty.length, "worktree", "worktrees")} will be lost`,
    );
    loses = true;
  }
  const untracked = survey.worktrees.filter((worktree) => worktree.untrackedFiles > 0);
  if (untracked.length > 0) {
    const files = untracked.reduce((total, worktree) => total + worktree.untrackedFiles, 0);
    warnings.push(`${plural(files, "untracked file", "untracked files")} will be lost`);
    loses = true;
  }
  const unpushed = survey.worktrees.filter((worktree) => (worktree.aheadCommits ?? 0) > 0);
  if (unpushed.length > 0 && options.deletesBranches) {
    const commits = unpushed.reduce(
      (total, worktree) => total + (worktree.aheadCommits ?? 0),
      0,
    );
    warnings.push(
      `${plural(commits, "unpushed commit", "unpushed commits")} on ${plural(unpushed.length, "branch", "branches")} will be lost`,
    );
    loses = true;
  }
  const unverified = survey.worktrees.filter((worktree) => Boolean(worktree.error));
  if (unverified.length > 0) {
    warnings.push(
      `Git status could not be checked for ${plural(unverified.length, "worktree", "worktrees")} — inspect before removing`,
    );
    loses = true;
  }
  if (survey.threadCount > 0) {
    warnings.push(`${plural(survey.threadCount, "thread", "threads")} will be archived`);
  }
  return { warnings, requiresConfirmation: loses };
}
