/**
 * Shared Zod schemas and inferred DTO types for Harbor settings and preferences.
 */
import { z } from "zod";

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
