/**
 * Shared Zod schemas and inferred DTO types for Harbor features, feature meta
 * (brief, refs, decisions), feature presets, and Multi-Repo Git Cockpit.
 */
import { z } from "zod";
import { projectIdSchema } from "./sidebar.ts";

export const MAX_FEATURES = 500;
export const MAX_FEATURE_NAME_LENGTH = 60;
export const MAX_FEATURE_ID_LENGTH = 100;
export const MAX_FEATURE_SLUG_LENGTH = 40;
export const MAX_PARK_REASON_LENGTH = 60;
export const MAX_PARK_NOTE_LENGTH = 240;

export const MAX_BRIEF_FIELD_LENGTH = 4_000;
export const MAX_BRIEF_ITEM_LENGTH = 500;
export const MAX_BRIEF_ITEMS = 20;
export const MAX_REF_TITLE_LENGTH = 300;
export const MAX_REF_ID_LENGTH = 200;
export const MAX_REF_URL_LENGTH = 2_000;
export const MAX_REFS = 20;
export const MAX_DECISION_TITLE_LENGTH = 200;
export const MAX_DECISION_CHOICE_LENGTH = 4_000;
export const MAX_DECISION_RATIONALE_LENGTH = 8_000;
export const MAX_DECISION_IMPACT_LENGTH = 2_000;
export const MAX_DECISION_ALTERNATIVE_LENGTH = 500;
export const MAX_DECISION_ALTERNATIVES = 10;
export const MAX_DECISIONS = 200;

export const MAX_PRESET_NAME_LENGTH = 60;
export const MAX_PRESETS = 50;
export const MAX_PRESET_REPOS = 20;

export const FEATURE_STATES = ["active", "parked", "archived"] as const;
export const PARK_REASON_PRESETS = [
  "waiting-qa",
  "waiting-backend",
  "waiting-release",
  "deferred",
] as const;
export const REF_KINDS = ["ticket", "document", "link"] as const;
export const DECISION_STATUSES = ["draft", "confirmed", "superseded"] as const;
export const DECISION_AUTHORS = ["human", "agent"] as const;
export const COCKPIT_REPO_ROLES = ["worktree", "ref", "submodule"] as const;
export const FEATURE_REPO_ROLES = ["worktree", "ref"] as const;
export const DIFF_FILE_STATUSES = [
  "modified",
  "added",
  "deleted",
  "renamed",
  "untracked",
] as const;

const CONTROL_CHAR_PATTERN = /[\u0000-\u001F\u007F]/;

export const featureIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_FEATURE_ID_LENGTH)
  .refine((value) => !CONTROL_CHAR_PATTERN.test(value), {
    message: "Feature id contains control characters.",
  });

export const featureNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_FEATURE_NAME_LENGTH)
  .refine((value) => !CONTROL_CHAR_PATTERN.test(value), {
    message: "Feature name contains control characters.",
  });

export const featureStateSchema = z.enum(FEATURE_STATES);
export type FeatureState = z.infer<typeof featureStateSchema>;
export type ParkReasonPreset = (typeof PARK_REASON_PRESETS)[number];

export const refKindSchema = z.enum(REF_KINDS);
export type RefKind = z.infer<typeof refKindSchema>;

export const decisionStatusSchema = z.enum(DECISION_STATUSES);
export type DecisionStatus = z.infer<typeof decisionStatusSchema>;

export const decisionAuthorSchema = z.enum(DECISION_AUTHORS);
export type DecisionAuthor = z.infer<typeof decisionAuthorSchema>;

export const cockpitRepoRoleSchema = z.enum(COCKPIT_REPO_ROLES);
export type CockpitRepoRole = z.infer<typeof cockpitRepoRoleSchema>;
export type FeatureMemberRole = CockpitRepoRole;

export const featureRepoRoleSchema = z.enum(FEATURE_REPO_ROLES);

export const featureRefLinkSchema = z.object({
  featureId: featureIdSchema,
  directory: z.string().min(1),
  repository: z.string().min(1),
  sourcePath: z.string().min(1),
  hostId: z.string().min(1),
  createdAt: z.number(),
});
export type FeatureRefLink = Readonly<z.infer<typeof featureRefLinkSchema>>;

export const featureSchema = z.object({
  id: featureIdSchema,
  name: featureNameSchema,
  slug: z.string(),
  state: featureStateSchema,
  position: z.number(),
  rootPath: z.string().nullable(),
  hostId: z.string().nullable(),
  parkedAt: z.number().nullable().optional(),
  parkedReason: z.string().max(MAX_PARK_REASON_LENGTH).nullable().optional(),
  parkedNote: z.string().max(MAX_PARK_NOTE_LENGTH).nullable().optional(),
  wakeAt: z.number().nullable().optional(),
  wakeOnActivity: z.boolean().optional(),
});
export type Feature = Readonly<z.infer<typeof featureSchema>>;

export const featureMemberSchema = z.object({
  featureId: z.string(),
  directory: z.string(),
  path: z.string(),
  repository: z.string(),
  repositoryPath: z.string(),
  branch: z.string().nullable(),
  hostId: z.string(),
  role: cockpitRepoRoleSchema.optional(),
  parentDirectory: z.string().nullable().optional(),
});
export type FeatureMember = Readonly<z.infer<typeof featureMemberSchema>>;

export const featureBriefSchema = z.object({
  goal: z.string(),
  nonGoals: z.string(),
  acceptance: z.string(),
  notes: z.string(),
  openQuestions: z.array(z.string()).readonly(),
  blockers: z.array(z.string()).readonly(),
  updatedAt: z.number().nullable(),
});
export type FeatureBrief = Readonly<z.infer<typeof featureBriefSchema>>;

export const featureRefSchema = z.object({
  id: z.string(),
  featureId: featureIdSchema,
  kind: refKindSchema,
  refId: z.string().nullable(),
  url: z.string().nullable(),
  title: z.string(),
  createdAt: z.number(),
});
export type FeatureRef = Readonly<z.infer<typeof featureRefSchema>>;

export const featureDecisionSchema = z.object({
  id: z.string(),
  featureId: featureIdSchema,
  seq: z.number().int().positive(),
  title: z.string(),
  choice: z.string(),
  rationale: z.string(),
  alternativesRejected: z.array(z.string()).readonly(),
  impact: z.string(),
  status: decisionStatusSchema,
  author: decisionAuthorSchema,
  threadId: z.string().nullable(),
  supersedes: z.number().int().positive().nullable(),
  supersededBy: z.number().int().positive().nullable(),
  createdAt: z.number(),
});
export type FeatureDecision = Readonly<z.infer<typeof featureDecisionSchema>>;

export const featureMetaSchema = z.object({
  brief: featureBriefSchema,
  refs: z.array(featureRefSchema).readonly(),
  decisions: z.array(featureDecisionSchema).readonly(),
});
export type FeatureMeta = Readonly<z.infer<typeof featureMetaSchema>>;

export const featureMetaSummarySchema = z.object({
  decisionCount: z.number().int().nonnegative(),
  activeDecisionCount: z.number().int().nonnegative(),
  draftCount: z.number().int().nonnegative(),
  refCount: z.number().int().nonnegative(),
  openQuestionCount: z.number().int().nonnegative(),
  blockerCount: z.number().int().nonnegative(),
  hasRequirement: z.boolean(),
  acceptanceSet: z.boolean(),
  lastDecisionAt: z.number().nullable(),
});
export type FeatureMetaSummary = Readonly<
  z.infer<typeof featureMetaSummarySchema>
>;

export const featureBriefInputSchema = z.object({
  goal: z.string().max(MAX_BRIEF_FIELD_LENGTH),
  nonGoals: z.string().max(MAX_BRIEF_FIELD_LENGTH),
  acceptance: z.string().max(MAX_BRIEF_FIELD_LENGTH),
  notes: z.string().max(MAX_BRIEF_FIELD_LENGTH),
  openQuestions: z
    .union([
      z.string(),
      z.array(z.string().max(MAX_BRIEF_ITEM_LENGTH)).max(MAX_BRIEF_ITEMS),
    ])
    .default(""),
  blockers: z
    .union([
      z.string(),
      z.array(z.string().max(MAX_BRIEF_ITEM_LENGTH)).max(MAX_BRIEF_ITEMS),
    ])
    .default(""),
});

export const featureRefInputSchema = z.object({
  kind: refKindSchema.optional(),
  refId: z.string().max(MAX_REF_ID_LENGTH).optional(),
  url: z.string().max(MAX_REF_URL_LENGTH).optional(),
  title: z.string().max(MAX_REF_TITLE_LENGTH).optional(),
});

export const featureDecisionInputSchema = z.object({
  featureId: featureIdSchema,
  title: z.string().trim().min(1).max(MAX_DECISION_TITLE_LENGTH),
  choice: z.string().trim().min(1).max(MAX_DECISION_CHOICE_LENGTH),
  rationale: z.string().max(MAX_DECISION_RATIONALE_LENGTH).default(""),
  alternatives: z
    .union([
      z.string(),
      z
        .array(z.string().max(MAX_DECISION_ALTERNATIVE_LENGTH))
        .max(MAX_DECISION_ALTERNATIVES),
    ])
    .default(""),
  impact: z.string().max(MAX_DECISION_IMPACT_LENGTH).default(""),
  supersedes: z.number().int().positive().nullable().default(null),
  threadId: z.string().nullable().default(null),
});

export const repositoryResultSchema = z.object({
  projectId: z.string(),
  repository: z.string(),
  outcome: z.enum(["created", "reused", "blocked"]),
  path: z.string().nullable(),
  branch: z.string().nullable(),
  role: featureRepoRoleSchema.optional(),
  setup: z.array(z.string()).readonly(),
  reason: z.string().nullable(),
});
export type RepositoryResult = Readonly<z.infer<typeof repositoryResultSchema>>;

export const repoSpecInputSchema = z.object({
  projectId: projectIdSchema,
  branch: z.string().trim().min(1).max(200).nullable().optional(),
  role: featureRepoRoleSchema.optional(),
  baseBranch: z.string().trim().min(1).max(200).nullable().optional(),
});

export const repoSubmoduleStatusSchema = z.object({
  path: z.string(),
  name: z.string(),
  dirty: z.boolean(),
  commit: z.string().nullable(),
});
export type RepoSubmoduleStatus = Readonly<
  z.infer<typeof repoSubmoduleStatusSchema>
>;

export const featureRepoGitStatusSchema = z.object({
  directory: z.string(),
  repository: z.string(),
  role: cockpitRepoRoleSchema,
  path: z.string(),
  branch: z.string().nullable(),
  upstream: z.string().nullable(),
  exists: z.boolean(),
  stagedFiles: z.number(),
  unstagedFiles: z.number(),
  untrackedFiles: z.number(),
  changedFiles: z.number(),
  additions: z.number(),
  deletions: z.number(),
  aheadCommits: z.number().nullable(),
  behindCommits: z.number().nullable(),
  clean: z.boolean(),
  statusError: z.string().nullable().optional(),
  lastCommitSubject: z.string().nullable(),
  submodules: z.array(repoSubmoduleStatusSchema).readonly(),
});
export type FeatureRepoGitStatus = Readonly<
  z.infer<typeof featureRepoGitStatusSchema>
>;

export const featureGitSummarySchema = z.object({
  featureId: z.string(),
  additions: z.number(),
  deletions: z.number(),
  dirtyRepoCount: z.number(),
  behindRepoCount: z.number(),
  unpushedRepoCount: z.number(),
  repos: z.array(featureRepoGitStatusSchema).readonly(),
});
export type FeatureGitSummary = Readonly<
  z.infer<typeof featureGitSummarySchema>
>;

export const diffFileStatusSchema = z.enum(DIFF_FILE_STATUSES);
export type DiffFileStatus = z.infer<typeof diffFileStatusSchema>;

export const diffFileEntrySchema = z.object({
  filePath: z.string(),
  status: diffFileStatusSchema,
  staged: z.boolean(),
  additions: z.number(),
  deletions: z.number(),
  patch: z.string(),
  truncated: z.boolean(),
});
export type DiffFileEntry = Readonly<z.infer<typeof diffFileEntrySchema>>;

export const featureHealthRepoSchema = z.object({
  directory: z.string(),
  repository: z.string(),
  role: cockpitRepoRoleSchema,
  path: z.string(),
  branch: z.string().nullable(),
  clean: z.boolean(),
  changedFiles: z.number(),
  untrackedFiles: z.number(),
  aheadCommits: z.number().nullable(),
  behindCommits: z.number().nullable(),
  additions: z.number(),
  deletions: z.number(),
  blockerReason: z.string().nullable(),
});
export type FeatureHealthRepo = Readonly<
  z.infer<typeof featureHealthRepoSchema>
>;

export const featureHealthReportSchema = z.object({
  featureId: z.string(),
  featureName: z.string(),
  rootPath: z.string().nullable(),
  repos: z.array(featureHealthRepoSchema).readonly(),
  blockedCount: z.number(),
  threadCount: z.number(),
  createdBranches: z.number(),
  canDeleteBranches: z.boolean(),
  warnings: z.array(z.string()).readonly(),
});
export type FeatureHealthReport = Readonly<
  z.infer<typeof featureHealthReportSchema>
>;

export const featurePresetRepoSchema = z.object({
  projectId: projectIdSchema,
  role: featureRepoRoleSchema,
  branchTemplate: z.string().trim().min(1).max(200).nullable(),
});
export type FeaturePresetRepo = Readonly<
  z.infer<typeof featurePresetRepoSchema>
>;

export const featurePresetSchema = z.object({
  id: z.string(),
  name: z.string(),
  baseBranch: z.string().nullable(),
  repos: z.array(featurePresetRepoSchema).readonly(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type FeaturePreset = Readonly<z.infer<typeof featurePresetSchema>>;
