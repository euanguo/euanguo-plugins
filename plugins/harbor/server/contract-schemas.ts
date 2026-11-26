import { z } from "zod";

import { MAX_BULK_DELETE_ROOTS } from "../lib/domain/bulk-delete.ts";
import {
  DECISION_AUTHORS,
  DECISION_STATUSES,
  MAX_BRIEF_FIELD_LENGTH,
  MAX_BRIEF_ITEM_LENGTH,
  MAX_BRIEF_ITEMS,
  MAX_DECISION_ALTERNATIVES,
  MAX_DECISION_ALTERNATIVE_LENGTH,
  MAX_DECISION_CHOICE_LENGTH,
  MAX_DECISION_IMPACT_LENGTH,
  MAX_DECISION_RATIONALE_LENGTH,
  MAX_DECISION_TITLE_LENGTH,
  MAX_REF_ID_LENGTH,
  MAX_REF_TITLE_LENGTH,
  MAX_REF_URL_LENGTH,
  REF_KINDS,
} from "../lib/domain/feature-meta.ts";
import {
  FEATURE_STATES,
  MAX_FEATURE_ID_LENGTH,
  MAX_FEATURE_NAME_LENGTH,
  MAX_PARK_NOTE_LENGTH,
  MAX_PARK_REASON_LENGTH,
  type Feature,
  type FeatureMember,
  type FeatureRefLink,
} from "../lib/domain/features.ts";
import { validGroupIcon } from "../lib/domain/group-icons.ts";
import {
  MAX_ORDER_ID_LENGTH,
  MAX_ORDER_ITEMS,
  MAX_ORDER_SCOPES,
} from "../lib/domain/manual-order.ts";
import {
  ORGANIZATION_MODES,
  SIDEBAR_MODES,
} from "../lib/domain/organization.ts";
import { MAX_PROJECT_ID_LENGTH } from "../lib/domain/project-colors.ts";
import { SCOPE_STRIP_MODES } from "../lib/domain/scope-strip.ts";
import { PROJECT_ICON_SOURCES } from "../lib/domain/project-icons.ts";
import {
  PROJECT_SORT_MODES,
  THREAD_SORT_MODES,
  WORKTREE_SORT_MODES,
} from "../lib/domain/sort-modes.ts";
import type { RepoFacts } from "../lib/domain/repo-identity.ts";
import type { RecoveryThreadRow } from "../lib/domain/recovery-threads.ts";
import type { SidebarThreadRowBase } from "../lib/domain/sidebar-thread-row.ts";
import type { SettledThreadRow } from "../lib/domain/settled-threads.ts";
import type { WorkspaceEnvironmentDescriptor } from "../lib/domain/workspace.ts";
import type {
  BatchRemoveWorktreesResult,
  BatchWorktreeRemovalItem,
  BatchWorktreeSurveyItem,
  WorkspaceRemovalOutcome,
  WorktreeRemovalPlan,
  WorktreeSurvey,
} from "../lib/domain/worktree-removal.ts";
import type { RepositoryResult } from "./feature/types.ts";
import {
  APPEARANCE_DEFAULTS,
  type AppearanceKey,
  type AppearanceValues,
} from "../lib/domain/appearance.ts";
import {
  MAX_PAGE_SIZE,
  MIN_PAGE_SIZE,
} from "../lib/domain/paging.ts";
import {
  CHILD_EXPANSION_OPTIONS,
  MAX_FEATURE_TEMPLATE_LENGTH,
  PALETTE_PRESET_OPTIONS,
  ROW_DENSITY_OPTIONS,
  STATUS_DISPLAY_OPTIONS,
  WORKSPACE_OWNERSHIP_OPTIONS,
  WORKTREE_LABEL_OPTIONS,
} from "../lib/domain/preferences.ts";

/**
 * One group's icon on the wire.
 *
 * A stored icon is what the frontend draws, so the boundary rejects a string
 * the icon registry cannot render.
 */
export const groupIconSchema = z.string().refine(validGroupIcon, {
  message: "Unknown group icon.",
});

/** The field schema each appearance setting gets, bound to its domain type. */
type AppearanceSchemaShape = {
  [K in AppearanceKey]: z.ZodType<AppearanceValues[K]>;
};

const CONTROL_CHAR_PATTERN = /[\u0000-\u001F\u007F]/u;

/**
 * The appearance:v2 record on the wire: curated fields with explicit enum and
 * bounds validation (e.g. `pageSize` integer in 1..100).
 */
export const appearanceSchema = z.object({
  palettePreset: z
    .enum(PALETTE_PRESET_OPTIONS)
    .default(APPEARANCE_DEFAULTS.palettePreset),
  rowDensity: z
    .enum(ROW_DENSITY_OPTIONS)
    .default(APPEARANCE_DEFAULTS.rowDensity),
  statusDisplay: z
    .enum(STATUS_DISPLAY_OPTIONS)
    .default(APPEARANCE_DEFAULTS.statusDisplay),
  worktreeLabel: z
    .enum(WORKTREE_LABEL_OPTIONS)
    .default(APPEARANCE_DEFAULTS.worktreeLabel),
  defaultChildExpansion: z
    .enum(CHILD_EXPANSION_OPTIONS)
    .default(APPEARANCE_DEFAULTS.defaultChildExpansion),
  showQuickActions: z.boolean().default(APPEARANCE_DEFAULTS.showQuickActions),
  pageSize: z
    .number()
    .int()
    .min(MIN_PAGE_SIZE)
    .max(MAX_PAGE_SIZE)
    .default(APPEARANCE_DEFAULTS.pageSize),
  autoProjectIcons: z.boolean().default(APPEARANCE_DEFAULTS.autoProjectIcons),
  workspaceOwnership: z
    .enum(WORKSPACE_OWNERSHIP_OPTIONS)
    .default(APPEARANCE_DEFAULTS.workspaceOwnership),
  showTitleAttention: z
    .boolean()
    .default(APPEARANCE_DEFAULTS.showTitleAttention),
  showUnregisteredWorktrees: z
    .boolean()
    .default(APPEARANCE_DEFAULTS.showUnregisteredWorktrees),
  groupByRepository: z.boolean().default(APPEARANCE_DEFAULTS.groupByRepository),
  featureBranchTemplate: z
    .string()
    .trim()
    .min(1)
    .max(MAX_FEATURE_TEMPLATE_LENGTH)
    .refine((value) => !CONTROL_CHAR_PATTERN.test(value), {
      message: "Branch template contains control characters.",
    })
    .default(APPEARANCE_DEFAULTS.featureBranchTemplate),
  featureDefaultBase: z
    .string()
    .trim()
    .max(MAX_FEATURE_TEMPLATE_LENGTH)
    .refine((value) => !CONTROL_CHAR_PATTERN.test(value), {
      message: "Base branch contains control characters.",
    })
    .default(APPEARANCE_DEFAULTS.featureDefaultBase),
} satisfies AppearanceSchemaShape);

export const threadIdSchema = z.object({ threadId: z.string().trim().min(1) });

/**
 * An optional read-side marker: a bounded answer stopped at its cap instead of
 * proving the source was exhausted.
 */
export const truncatedSchema = z.boolean().optional();
export const featureIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_FEATURE_ID_LENGTH)
  .refine((value) => value === value.trim(), {
    message: "Feature id has surrounding whitespace.",
  })
  .refine((value) => !/[\u0000-\u001F\u007F]/.test(value), {
    message: "Feature id contains control characters.",
  });
export const featureNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_FEATURE_NAME_LENGTH)
  .refine((value) => !/[\u0000-\u001F\u007F]/.test(value), {
    message: "Feature name contains control characters.",
  });
export const featureStateSchema = z.enum(FEATURE_STATES);
/**
 * A feature on the wire, bound to the domain type: a field added to `Feature`
 * fails this file's compile rather than drifting out of the answer.
 */
export const cockpitRepoRoleSchema = z.enum(["worktree", "ref", "submodule"]);
export const featureRefLinkSchema = z
  .object({
    featureId: featureIdSchema,
    directory: z.string().min(1),
    repository: z.string().min(1),
    sourcePath: z.string().min(1),
    hostId: z.string().min(1),
    createdAt: z.number(),
  }) satisfies z.ZodType<FeatureRefLink>;
export const featureSchema = z
  .object({
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
  }) satisfies z.ZodType<Feature>;
export const featureMemberSchema = z
  .object({
    featureId: z.string(),
    directory: z.string(),
    path: z.string(),
    repository: z.string(),
    repositoryPath: z.string(),
    branch: z.string().nullable(),
    hostId: z.string(),
    role: cockpitRepoRoleSchema.optional(),
    parentDirectory: z.string().nullable().optional(),
  }) satisfies z.ZodType<FeatureMember>;
export const featureBriefSchema = z.object({
  goal: z.string(),
  nonGoals: z.string(),
  acceptance: z.string(),
  notes: z.string(),
  openQuestions: z.array(z.string()),
  blockers: z.array(z.string()),
  updatedAt: z.number().nullable(),
});
export const featureRefSchema = z.object({
  id: z.string(),
  featureId: featureIdSchema,
  kind: z.enum(REF_KINDS),
  refId: z.string().nullable(),
  url: z.string().nullable(),
  title: z.string(),
  createdAt: z.number(),
});
export const featureDecisionSchema = z.object({
  id: z.string(),
  featureId: featureIdSchema,
  seq: z.number().int().positive(),
  title: z.string(),
  choice: z.string(),
  rationale: z.string(),
  alternativesRejected: z.array(z.string()),
  impact: z.string(),
  status: z.enum(DECISION_STATUSES),
  author: z.enum(DECISION_AUTHORS),
  threadId: z.string().nullable(),
  supersedes: z.number().int().positive().nullable(),
  supersededBy: z.number().int().positive().nullable(),
  createdAt: z.number(),
});
export const featureMetaSchema = z.object({
  brief: featureBriefSchema,
  refs: z.array(featureRefSchema),
  decisions: z.array(featureDecisionSchema),
});
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
  kind: z.enum(REF_KINDS).optional(),
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
export const repositoryResultSchema = z
  .object({
    projectId: z.string(),
    repository: z.string(),
    outcome: z.enum(["created", "reused", "blocked"]),
    path: z.string().nullable(),
    branch: z.string().nullable(),
    role: z.enum(["worktree", "ref"]).optional(),
    setup: z.array(z.string()).readonly(),
    reason: z.string().nullable(),
  }) satisfies z.ZodType<RepositoryResult>;
export const projectIdSchema = z
  .string()
  .min(1)
  .max(MAX_PROJECT_ID_LENGTH)
  .refine((value) => !/[\u0000-\u001F\u007F]/.test(value), {
    message: "Project id contains control characters.",
  });
export const projectColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9A-F]{6}$/i)
  .transform((value) => value.toUpperCase());
export const storedProjectColorSchema = z.object({
  projectId: projectIdSchema,
  color: projectColorSchema,
});
export const projectIconSchema = z.object({
  src: z.string(),
  label: z.string(),
  source: z.enum(PROJECT_ICON_SOURCES),
});
/**
 * One project's stored answer, miss included.
 *
 * The null is on the wire on purpose: it is how the sidebar tells a project
 * that was already looked at — and has no icon — from one nobody has looked at
 * yet, without asking again for the first kind.
 */
export const projectIconEntrySchema = z.object({
  projectId: projectIdSchema,
  icon: projectIconSchema.nullable(),
});
export const bulkDeleteSkipReasonSchema = z.enum([
  "missing",
  "current",
  "working",
  "waiting",
  "unread",
  "pinned",
  "overlap",
  "scope-changed",
]);
export const bulkDeleteSkippedRootSchema = z.object({
  id: z.string(),
  reason: bulkDeleteSkipReasonSchema,
  message: z.string(),
});
export const selectedThreadIdsSchema = z
  .array(z.string().trim().min(1))
  .min(1)
  .max(MAX_BULK_DELETE_ROOTS)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "A root thread can be selected only once.",
  });

// Manual order: one scope's list of ids, bounded and duplicate-free. The store
// validates again on write, so a schema here only has to reject what the wire
// should never carry.
export const orderItemsSchema = z
  .array(z.string().trim().min(1).max(MAX_ORDER_ID_LENGTH))
  .max(MAX_ORDER_ITEMS)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "An order cannot name the same item twice.",
  });
export const orderScopeIdSchema = z.string().trim().min(1).max(MAX_ORDER_ID_LENGTH);
export const orderMapSchema = z
  .record(orderScopeIdSchema, orderItemsSchema)
  .refine((map) => Object.keys(map).length <= MAX_ORDER_SCOPES, {
    message: "Too many order scopes.",
  });
/**
 * What every order write answers with.
 *
 * `revision` is on every answer, refusals included, so a caller that was refused
 * always knows what to reload at. `stale` is its own flag rather than a third
 * reason: it is the one refusal the user can act on — reload and try again — and
 * a client that cannot tell it from a malformed id would have nothing to say.
 */
export const orderWriteSchema = z.object({
  ok: z.boolean(),
  stale: z.boolean(),
  revision: z.number().int().nonnegative(),
});
export const projectSortSchema = z.enum(PROJECT_SORT_MODES);
export const threadSortSchema = z.enum(THREAD_SORT_MODES);
export const worktreeSortSchema = z.enum(WORKTREE_SORT_MODES);
export const organizationModeSchema = z.enum(ORGANIZATION_MODES);
export const sidebarModeSchema = z.enum(SIDEBAR_MODES);
export const scopeStripModeSchema = z.enum(SCOPE_STRIP_MODES);

/**
 * What bb can say about one workspace before anything is touched. The counts are
 * what the removal dialog has to put in front of the user, so they travel with
 * their names rather than as a tuple.
 */
export const worktreeSurveySchema = z
  .object({
    path: z.string(),
    hostId: z.string(),
    branch: z.string().nullable(),
    alias: z.string().nullable().optional(),
    /** bb created this directory, so removing it is bb's own cleanup. */
    bbOwned: z.boolean(),
    gitWorktree: z.boolean(),
    directoryExists: z.boolean(),
    mainRepoPath: z.string().nullable(),
    changedFiles: z.number().int().nonnegative(),
    untrackedFiles: z.number().int().nonnegative(),
    aheadCommits: z.number().int().nonnegative(),
    baseRef: z.string().nullable(),
    statusUnavailable: z.boolean().optional(),
    threads: z.number().int().nonnegative(),
    liveThreads: z.number().int().nonnegative(),
    openTerminals: z.number().int().nonnegative(),
  }) satisfies z.ZodType<WorktreeSurvey>;

export const removalWarningSchema = z.object({
  kind: z.enum(["discard", "in-use", "external"]),
  text: z.string(),
});

export const worktreeRemovalPlanSchema = z.object({
  threadCount: z.number().int().nonnegative(),
  liveThreadCount: z.number().int().nonnegative(),
  directory: z.object({
    via: z.enum(["git", "delete"]),
    warnings: z.array(removalWarningSchema),
    refusal: z.string().nullable(),
  }),
});

/**
 * What a removal did, and where it stopped.
 *
 * Shared by the RPC and the agent tools, so it is bound to the domain type
 * rather than restated: the outcome is what both callers switch on.
 */
export const workspaceRemovalOutcomeSchema = z
  .object({
    ok: z.boolean(),
    code: z
      .enum(["unavailable", "acknowledgement", "changed"])
      .nullable(),
    archivedThreads: z.boolean(),
    environmentRemoved: z.boolean(),
    directory: z.enum(["kept", "removed", "failed"]),
    message: z.string().nullable(),
  }) satisfies z.ZodType<WorkspaceRemovalOutcome>;

export const workspaceEnvironmentDescriptorSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    hostId: z.string(),
    path: z.string().nullable(),
    isGitRepo: z.boolean(),
    isWorktree: z.boolean(),
    branchName: z.string().nullable(),
    name: z.string().nullable(),
    providerId: z.string().nullable(),
    workspaceDisplayKind: z
      .enum(["managed-worktree", "unmanaged-worktree", "other"])
      .nullable(),
    managed: z.boolean().optional(),
    createdAt: z.number().nullable().optional(),
    updatedAt: z.number().nullable().optional(),
    providerInstanceKey: z.string().nullable().optional(),
    dangling: z.boolean().optional(),
  }) satisfies z.ZodType<WorkspaceEnvironmentDescriptor>;

export const batchWorktreeSurveyItemSchema = z
  .object({
    environmentId: z.string(),
    ok: z.boolean(),
    survey: worktreeSurveySchema.nullable(),
    plan: worktreeRemovalPlanSchema.nullable(),
    digest: z.string().nullable(),
    dirty: z.boolean(),
    blockedReason: z.string().nullable(),
    error: z.string().nullable(),
  }) satisfies z.ZodType<BatchWorktreeSurveyItem>;

export const batchWorktreeRemovalItemSchema = z
  .object({
    environmentId: z.string(),
    status: z.enum(["removed", "skipped", "failed"]),
    outcome: workspaceRemovalOutcomeSchema.nullable(),
    reason: z.string().nullable(),
  }) satisfies z.ZodType<BatchWorktreeRemovalItem>;

export const batchRemoveWorktreesResultSchema = z
  .object({
    items: z.array(batchWorktreeRemovalItemSchema),
    removedCount: z.number().int().nonnegative(),
    skippedCount: z.number().int().nonnegative(),
    failedCount: z.number().int().nonnegative(),
  }) satisfies z.ZodType<BatchRemoveWorktreesResult>;

/**
 * One disagreement between how bb filed a workspace and where it really is.
 *
 * Shape-only, like everything else on the wire: the code is what a client
 * switches on, and the message is already written so both sides say the same
 * sentence rather than each composing its own.
 */
export const repoDiagnosticSchema = z.object({
  code: z.enum([
    "split-repo",
    "multi-repo-project",
    "orphan-workspace",
    "ownership-conflict",
    "ambiguous-owner",
    "dangling-path",
    "duplicate-path",
    "unseen-worktree",
    "path-not-canonical",
  ]),
  repoKey: z.string(),
  subjects: z.array(z.string()).readonly(),
  message: z.string(),
});

/** A worktree the repository records, which bb may have no environment for. */
export const repoWorktreeSchema = z.object({
  hostId: z.string().nullable().optional(),
  path: z.string(),
  branch: z.string().nullable(),
  head: z.string().nullable(),
  detached: z.boolean(),
  prunable: z.boolean(),
});

/** One physical workspace: the directory, every spelling, the environments. */
export const physicalWorkspaceSchema = z.object({
  key: z.string(),
  hostId: z.string(),
  path: z.string(),
  /** Every spelling bb used, so a mismatch can be shown. */
  rawPaths: z.array(z.string()).readonly(),
  /** The filesystem's realPath spelling when it differs from bb's. */
  aliases: z.array(z.string()).readonly().optional(),
  environmentIds: z.array(z.string()).readonly(),
  projectIds: z.array(z.string()).readonly(),
  repoKey: z.string(),
  isMainWorktree: z.boolean(),
  isLinkedWorktree: z.boolean(),
  isNestedRepository: z.boolean(),
  repositoryRoot: z.string().nullable(),
});

/** One repository, or one plain directory standing in for one. */
export const repoIdentitySchema = z.object({
  key: z.string(),
  kind: z.enum(["git-remote", "git-local", "directory"]),
  name: z.string(),
  remoteUrl: z.string().nullable(),
  rootPath: z.string().nullable(),
  hostIds: z.array(z.string()).readonly(),
  projectIds: z.array(z.string()).readonly(),
  workspaces: z.array(physicalWorkspaceSchema).readonly(),
  unseenWorktrees: z.array(repoWorktreeSchema).readonly(),
  diagnostics: z.array(repoDiagnosticSchema).readonly(),
});

/** Where each workspace really belongs, miss and conflict included. */
export const workspaceOwnershipSchema = z.object({
  environmentId: z.string(),
  claimedProjectId: z.string(),
  ownerProjectId: z.string().nullable(),
  workspaceKey: z.string(),
  repoKey: z.string().nullable(),
  kind: z.enum([
    "project-checkout",
    "git-worktree",
    "nested-checkout",
    "external-checkout",
    "external-directory",
    "personal",
    "unresolved",
  ]),
  confidence: z.enum([
    "exact-source",
    "local-repository",
    "shared-remote",
    "contained",
    "claimed",
    "unresolved",
  ]),
  conflict: z.boolean(),
});

/**
 * The physical axis: which repository each workspace really belongs to.
 *
 * Bound to `RepoFacts` so the answer the frontend reads cannot drift from the
 * inference that produces it — every field here is one a caller switches on.
 */
export const repoFactsSchema = z
  .object({
    repos: z.array(repoIdentitySchema).readonly(),
    diagnostics: z.array(repoDiagnosticSchema).readonly(),
    /** projectId -> repoKey, for a caller that only wants the grouping. */
    repoKeyByProject: z.record(z.string(), z.string()),
    /** projectId -> the repository named by its configured source. */
    sourceRepoKeyByProject: z.record(z.string(), z.string()),
    workspaceOwnership: z.record(z.string(), workspaceOwnershipSchema),
    unseenWorkspaces: z.record(
      z.string(),
      z
        .array(
          z.object({
            projectId: z.string(),
            repoKey: z.string(),
            hostId: z.string(),
            path: z.string(),
            branch: z.string().nullable(),
            detached: z.boolean(),
          }),
        )
        .readonly(),
    ),
    /** Machines that did not answer; their workspaces are drawn unverified. */
    unavailableHostIds: z.array(z.string()).readonly(),
  }) satisfies z.ZodType<RepoFacts>;

/**
 * The plan as the wire carries it. The one difference is the warnings array:
 * the plan hands it out read-only, and zod's inferred type is mutable.
 */
export function worktreePlanWire(plan: WorktreeRemovalPlan) {
  return {
    ...plan,
    directory: { ...plan.directory, warnings: [...plan.directory.warnings] },
  };
}

/**
 * How many archived rows a project's shelf may ask for.
 *
 * A shelf is for recovering a thread you remember, not for browsing the archive
 * — bb has its own archived view for the second thing — so the contract refuses
 * more than a shelf would ever draw rather than letting a request page the whole
 * archive.
 */
export const MAX_ARCHIVED_SHELF_ROWS = 50;

/**
 * The thread fields every non-host read carries, before its own extras.
 *
 * Bound to `SidebarThreadRowBase`: this is the one place the wire row and the
 * mapper that reads it are declared, so a field added to the base fails here
 * instead of reaching the frontend as an omission.
 */
export const threadRowSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    title: z.string().nullable(),
    titleFallback: z.string().nullable(),
    parentThreadId: z.string().nullable(),
    sectionId: z.string().nullable(),
    originKind: z.string().nullable(),
    originPluginId: z.string().nullable(),
    providerId: z.string(),
    status: z.string(),
    hasPendingInteraction: z.boolean(),
    isPinned: z.boolean(),
    activity: z.object({
      workflows: z.number(),
      backgroundAgents: z.number(),
      backgroundCommands: z.number(),
      planMode: z.number(),
    }),
    createdAt: z.number(),
    updatedAt: z.number(),
    lastReadAt: z.number().nullable(),
    latestAttentionAt: z.number(),
  }) satisfies z.ZodType<SidebarThreadRowBase>;

/**
 * One live thread as bb's SDK reports it, for the recovery read.
 *
 * Every open field is loose on purpose — `status`, `originKind`, and
 * `workspaceDisplayKind` arrive as plain strings — so a value a newer bb
 * invents degrades in `lib/domain/recovery-threads.ts` instead of failing this output
 * validation and leaving the retry with nothing to show. `listSettledThreads`
 * makes the same trade for the same reason.
 */
export const recoveryThreadRowSchema = threadRowSchema
  .extend({
    environment: z
      .object({
        id: z.string().nullable(),
        name: z.string().nullable(),
        branchName: z.string().nullable(),
        providerId: z.string().nullable(),
        workspaceDisplayKind: z.string().nullable(),
      })
      .nullable(),
    host: z.object({ id: z.string(), name: z.string() }).nullable(),
  }) satisfies z.ZodType<RecoveryThreadRow>;

/**
 * One settled thread on the shelf.
 *
 * Derived from the shared row rather than retyped: the shelf draws the same
 * fields as the recovery read and only adds when this plugin settled it. It
 * carries no environment or host, because nothing on the shelf's single line
 * reads one.
 */
export const settledThreadRowSchema = threadRowSchema.extend({
  settledAt: z.number(),
}) satisfies z.ZodType<SettledThreadRow>;
