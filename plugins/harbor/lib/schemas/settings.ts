/**
 * Shared Zod schemas and inferred DTO types for Harbor settings and preferences.
 */
import { z } from "zod";
import { featureStateSchema } from "./feature.ts";
import { groupIconSchema } from "./sidebar.ts";

export const AGENT_ACCESS_TIERS = ["off", "read-only", "full"] as const;
export const agentAccessTierSchema = z.enum(AGENT_ACCESS_TIERS);
export type AgentAccessTier = z.infer<typeof agentAccessTierSchema>;

export const PALETTE_PRESET_OPTIONS = [
  "Default",
  "High contrast",
  "Colorblind-friendly",
] as const;
export const ROW_DENSITY_OPTIONS = ["compact", "detailed"] as const;
export const STATUS_DISPLAY_OPTIONS = ["dot", "icon"] as const;
export const WORKTREE_LABEL_OPTIONS = [
  "alias-over-branch",
  "alias-and-branch",
  "branch-only",
] as const;
export const CHILD_EXPANSION_OPTIONS = ["expanded", "collapsed"] as const;
export const WORKSPACE_OWNERSHIP_OPTIONS = ["filesystem", "claimed"] as const;

export const PROJECT_SORT_MODES = [
  "manual",
  "name-asc",
  "name-desc",
  "threads-desc",
  "updated-desc",
  "status",
] as const;
export const THREAD_SORT_MODES = [
  "manual",
  "created-desc",
  "created-asc",
  "updated-desc",
  "updated-asc",
  "attention-desc",
  "name-asc",
  "status",
] as const;
export const WORKTREE_SORT_MODES = [
  "manual",
  "name-asc",
  "updated-desc",
  "threads-desc",
  "status",
] as const;
export const ORGANIZATION_MODES = ["project", "machine"] as const;
export const SIDEBAR_MODES = ["threads", "workspaces"] as const;
export const SCOPE_STRIP_MODES = ["auto", "labels"] as const;

export type PalettePreset = (typeof PALETTE_PRESET_OPTIONS)[number];
export type RowDensity = (typeof ROW_DENSITY_OPTIONS)[number];
export type StatusDisplay = (typeof STATUS_DISPLAY_OPTIONS)[number];
export type WorktreeLabelOption = (typeof WORKTREE_LABEL_OPTIONS)[number];
export type ChildExpansionOption = (typeof CHILD_EXPANSION_OPTIONS)[number];
export type WorkspaceOwnershipMode =
  (typeof WORKSPACE_OWNERSHIP_OPTIONS)[number];

export type ProjectSortMode = (typeof PROJECT_SORT_MODES)[number];
export type ThreadSortMode = (typeof THREAD_SORT_MODES)[number];
export type WorktreeSortMode = (typeof WORKTREE_SORT_MODES)[number];
export type OrganizationMode = (typeof ORGANIZATION_MODES)[number];
export type SidebarMode = (typeof SIDEBAR_MODES)[number];
export type ScopeStripMode = (typeof SCOPE_STRIP_MODES)[number];

export const FEATURE_ROW_ICON_OPTIONS = [
  "repoCount",
  "newThread",
  "hub",
  "disclosure",
] as const;
export type FeatureRowIcon = (typeof FEATURE_ROW_ICON_OPTIONS)[number];

export const DEFAULT_PAGE_SIZE = 5;
export const MIN_PAGE_SIZE = 1;
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_FEATURE_BRANCH_TEMPLATE = "feat/{slug}";
export const DEFAULT_FEATURE_BASE_BRANCH = "";
export const MAX_FEATURE_TEMPLATE_LENGTH = 200;

const CONTROL_CHAR_PATTERN = /[\u0000-\u001F\u007F]/u;

export const appearanceSchema = z.object({
  palettePreset: z.enum(PALETTE_PRESET_OPTIONS).default("Default"),
  rowDensity: z.enum(ROW_DENSITY_OPTIONS).default("detailed"),
  statusDisplay: z.enum(STATUS_DISPLAY_OPTIONS).default("dot"),
  worktreeLabel: z.enum(WORKTREE_LABEL_OPTIONS).default("alias-over-branch"),
  defaultChildExpansion: z.enum(CHILD_EXPANSION_OPTIONS).default("expanded"),
  showQuickActions: z.boolean().default(true),
  pageSize: z
    .number()
    .int()
    .min(MIN_PAGE_SIZE)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
  autoProjectIcons: z.boolean().default(true),
  workspaceOwnership: z
    .enum(WORKSPACE_OWNERSHIP_OPTIONS)
    .default("filesystem"),
  showTitleAttention: z.boolean().default(false),
  showUnregisteredWorktrees: z.boolean().default(false),
  groupByRepository: z.boolean().default(false),
  featureBranchTemplate: z
    .string()
    .trim()
    .min(1)
    .max(MAX_FEATURE_TEMPLATE_LENGTH)
    .refine((value) => !CONTROL_CHAR_PATTERN.test(value), {
      message: "Branch template contains control characters.",
    })
    .default(DEFAULT_FEATURE_BRANCH_TEMPLATE),
  featureDefaultBase: z
    .string()
    .trim()
    .max(MAX_FEATURE_TEMPLATE_LENGTH)
    .refine((value) => !CONTROL_CHAR_PATTERN.test(value), {
      message: "Base branch contains control characters.",
    })
    .default(DEFAULT_FEATURE_BASE_BRANCH),
  featureRowShowRepoCount: z.boolean().default(true),
  featureRowShowNewThread: z.boolean().default(true),
  featureRowShowHub: z.boolean().default(true),
  featureRowShowDisclosure: z.boolean().default(true),
});

export type AppearanceValues = z.infer<typeof appearanceSchema>;
export type AppearanceKey = keyof AppearanceValues;

export const appearancePatchSchema = appearanceSchema.partial();

export const projectSortSchema = z.enum(PROJECT_SORT_MODES);
export const threadSortSchema = z.enum(THREAD_SORT_MODES);
export const worktreeSortSchema = z.enum(WORKTREE_SORT_MODES);
export const organizationModeSchema = z.enum(ORGANIZATION_MODES);
export const sidebarModeSchema = z.enum(SIDEBAR_MODES);
export const scopeStripModeSchema = z.enum(SCOPE_STRIP_MODES);

export const viewPreferencesSchema = z.object({
  projectSort: projectSortSchema,
  threadSort: threadSortSchema,
  worktreeSort: worktreeSortSchema,
  organizationMode: organizationModeSchema,
  sidebarMode: sidebarModeSchema,
  scopeStrip: scopeStripModeSchema,
});

export type ViewPreferencesSnapshot = Readonly<
  z.infer<typeof viewPreferencesSchema>
>;

const countSchema = z.number().int().nonnegative();

export const nestMigrationCountsSchema = z.object({
  groups: countSchema,
  memberships: countSchema,
  manualOrders: countSchema,
  badgeColors: countSchema,
  lifecycle: countSchema,
  features: countSchema,
  featureBranches: countSchema,
  featureAdoptions: countSchema,
  featureBriefs: countSchema,
  featureDecisions: countSchema,
  featureRefs: countSchema,
});
export type NestMigrationCounts = Readonly<
  z.infer<typeof nestMigrationCountsSchema>
>;

export const nestMigrationGroupPreviewSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: groupIconSchema,
  memberCount: countSchema,
  alreadyExists: z.boolean(),
  willImport: z.boolean(),
});
export type NestMigrationGroupPreview = Readonly<
  z.infer<typeof nestMigrationGroupPreviewSchema>
>;

export const nestMigrationFeaturePreviewSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  state: featureStateSchema,
  rootPath: z.string().nullable(),
  branchCount: countSchema,
  decisionCount: countSchema,
  refCount: countSchema,
  hasBrief: z.boolean(),
  alreadyExists: z.boolean(),
  willImport: z.boolean(),
});
export type NestMigrationFeaturePreview = Readonly<
  z.infer<typeof nestMigrationFeaturePreviewSchema>
>;

export const nestMigrationPreviewSchema = z.object({
  sourceFound: z.boolean(),
  sourcePath: z.string().nullable(),
  tipDismissed: z.boolean(),
  migratedBefore: z.boolean(),
  hasPendingData: z.boolean(),
  showTip: z.boolean(),
  pending: nestMigrationCountsSchema,
  existing: nestMigrationCountsSchema,
  groups: z.array(nestMigrationGroupPreviewSchema).readonly(),
  features: z.array(nestMigrationFeaturePreviewSchema).readonly(),
});
export type NestMigrationPreview = Readonly<
  z.infer<typeof nestMigrationPreviewSchema>
>;

export const nestMigrationApplyInputSchema = z.object({
  includeGroups: z.boolean().default(true),
  includeFeatures: z.boolean().default(true),
  includeExtras: z.boolean().default(true),
});
export type NestMigrationApplyInput = z.infer<
  typeof nestMigrationApplyInputSchema
>;

export const nestMigrationApplyResultSchema = z.object({
  status: z.enum([
    "migrated",
    "source-missing",
    "nothing-to-migrate",
    "skipped-error",
  ]),
  imported: nestMigrationCountsSchema,
  preview: nestMigrationPreviewSchema,
});
export type NestMigrationApplyResult = Readonly<
  z.infer<typeof nestMigrationApplyResultSchema>
>;
