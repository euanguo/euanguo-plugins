import { resolvePageSize } from "./paging.ts";

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

export const DEFAULT_FEATURE_BRANCH_TEMPLATE = "feat/{slug}";
export const DEFAULT_FEATURE_BASE_BRANCH = "";
export const MAX_FEATURE_TEMPLATE_LENGTH = 200;

const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/u;

export type PalettePreset = (typeof PALETTE_PRESET_OPTIONS)[number];
export type RowDensity = (typeof ROW_DENSITY_OPTIONS)[number];
export type StatusDisplay = (typeof STATUS_DISPLAY_OPTIONS)[number];
export type WorktreeLabelOption = (typeof WORKTREE_LABEL_OPTIONS)[number];
export type ChildExpansionOption = (typeof CHILD_EXPANSION_OPTIONS)[number];
export type WorkspaceOwnershipMode =
  (typeof WORKSPACE_OWNERSHIP_OPTIONS)[number];

export const SEMANTIC_COLOR_ROLES = [
  "working",
  "workflow",
  "agent",
  "command",
  "plan",
  "goal",
  "waiting",
  "unread",
  "error",
  "inactive",
  "stale",
  "prReview",
  "prChecks",
  "prReady",
  "prMerged",
  "prDraft",
  "prBlocked",
  "prClosed",
] as const;

export type SemanticColorRole = (typeof SEMANTIC_COLOR_ROLES)[number];
export type SemanticPalette = Readonly<Record<SemanticColorRole, string>>;

export interface HarborPreferences {
  palettePreset: PalettePreset;
  colors: SemanticPalette;
  /** `compact` keeps a single line with hover details; `detailed` shows branch and row metadata. */
  rowDensity: RowDensity;
  /** How a worktree row divides the alias and the branch. */
  worktreeLabel: WorktreeLabelOption;
  /** A dot is quieter and narrower than the state's own icon. */
  statusDisplay: StatusDisplay;
  defaultChildrenExpanded: boolean;
  /** Unified switch for hover Pin, Snooze, and Settle actions. */
  showQuickActions: boolean;
  /** How many rows one page holds across paged sidebar lists. */
  pageSize: number;
  /** Whether a project's detected favicon or logo replaces its letter badge. */
  autoProjectIcons: boolean;
  /** Whether the tree follows filesystem ownership or bb's claimed project. */
  workspaceOwnership: WorkspaceOwnershipMode;
  /** Whether repository-recorded worktrees with no bb environment are shown. */
  showUnregisteredWorktrees: boolean;
  /** Whether one repository is grouped as one row across projects. */
  groupByRepository: boolean;
  /** Whether attention chips appear in bb's window title bar. */
  showTitleAttention: boolean;
  /** Default branch template suggested when creating features. */
  featureBranchTemplate: string;
  /** Default base branch for feature worktrees (empty string auto-detects). */
  featureDefaultBase: string;
}

const DEFAULT_PALETTE = {
  working: "#34A853",
  workflow: "#8B5CF6",
  agent: "#0891B2",
  command: "#EA6A20",
  plan: "#6366F1",
  goal: "#DB3F8D",
  waiting: "var(--warning-text, var(--warning, #F59E0B))",
  unread: "var(--primary, #3B82F6)",
  error: "var(--destructive, #EF4444)",
  inactive:
    "color-mix(in srgb, var(--muted-foreground, #A1A8B3) 72%, transparent)",
  stale: "color-mix(in srgb, var(--muted-foreground, #69717D) 50%, transparent)",
  prReview: "var(--primary, #3B82F6)",
  prChecks: "var(--warning-text, var(--warning, #F59E0B))",
  prReady: "#34A853",
  prMerged: "var(--pr-merged, #A855F7)",
  prDraft: "var(--muted-foreground, #94A3B8)",
  prBlocked: "var(--destructive, #EF4444)",
  prClosed: "var(--muted-foreground, #64748B)",
} as const satisfies SemanticPalette;

const HIGH_CONTRAST_PALETTE = {
  working: "#00C853",
  workflow: "#AA55FF",
  agent: "#00B8D4",
  command: "#FF6D00",
  plan: "#536DFE",
  goal: "#FF4081",
  waiting: "#FFAB00",
  unread: "#2979FF",
  error: "#FF1744",
  inactive: "#B0B5BD",
  stale: "#666B73",
  prReview: "#2979FF",
  prChecks: "#FFAB00",
  prReady: "#00C853",
  prMerged: "#D500F9",
  prDraft: "#A0A0A0",
  prBlocked: "#FF1744",
  prClosed: "#707070",
} as const satisfies SemanticPalette;

const COLORBLIND_FRIENDLY_PALETTE = {
  working: "#009E73",
  workflow: "#CC79A7",
  agent: "#56B4E9",
  command: "#E69F00",
  plan: "#0072B2",
  goal: "#F0E442",
  waiting: "#E69F00",
  unread: "#0072B2",
  error: "#D55E00",
  inactive: "#999999",
  stale: "#565656",
  prReview: "#56B4E9",
  prChecks: "#E69F00",
  prReady: "#009E73",
  prMerged: "#CC79A7",
  prDraft: "#999999",
  prBlocked: "#D55E00",
  prClosed: "#4D4D4D",
} as const satisfies SemanticPalette;

export const PALETTE_PRESETS: Readonly<Record<PalettePreset, SemanticPalette>> =
  {
    Default: DEFAULT_PALETTE,
    "High contrast": HIGH_CONTRAST_PALETTE,
    "Colorblind-friendly": COLORBLIND_FRIENDLY_PALETTE,
  };

export function normalizeFeatureBranchTemplate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_FEATURE_TEMPLATE_LENGTH ||
    CONTROL_CHARACTER.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

export function normalizeFeatureDefaultBase(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (
    trimmed.length > MAX_FEATURE_TEMPLATE_LENGTH ||
    CONTROL_CHARACTER.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

export function resolvePalette(preset: PalettePreset): SemanticPalette {
  return PALETTE_PRESETS[preset];
}

export function resolveHarborPreferences(
  values: Readonly<Record<string, string | number | boolean>> | undefined,
): HarborPreferences {
  const palettePreset = readOption(
    values?.palettePreset,
    PALETTE_PRESET_OPTIONS,
    "Default",
  );

  return {
    palettePreset,
    colors: resolvePalette(palettePreset),
    rowDensity: readOption(values?.rowDensity, ROW_DENSITY_OPTIONS, "detailed"),
    worktreeLabel: readOption(
      values?.worktreeLabel,
      WORKTREE_LABEL_OPTIONS,
      "alias-over-branch",
    ),
    statusDisplay: readOption(values?.statusDisplay, STATUS_DISPLAY_OPTIONS, "dot"),
    defaultChildrenExpanded:
      readOption(
        values?.defaultChildExpansion,
        CHILD_EXPANSION_OPTIONS,
        "expanded",
      ) === "expanded",
    showQuickActions: readBoolean(values?.showQuickActions, true),
    pageSize: resolvePageSize(values?.pageSize),
    autoProjectIcons: readBoolean(values?.autoProjectIcons, true),
    workspaceOwnership: readOption(
      values?.workspaceOwnership,
      WORKSPACE_OWNERSHIP_OPTIONS,
      "filesystem",
    ),
    showUnregisteredWorktrees: readBoolean(
      values?.showUnregisteredWorktrees,
      false,
    ),
    groupByRepository: readBoolean(values?.groupByRepository, false),
    showTitleAttention: readBoolean(values?.showTitleAttention, false),
    featureBranchTemplate:
      normalizeFeatureBranchTemplate(values?.featureBranchTemplate) ??
      DEFAULT_FEATURE_BRANCH_TEMPLATE,
    featureDefaultBase:
      normalizeFeatureDefaultBase(values?.featureDefaultBase) ??
      DEFAULT_FEATURE_BASE_BRANCH,
  };
}

function readBoolean(
  value: string | number | boolean | undefined,
  fallback: boolean,
) {
  return typeof value === "boolean" ? value : fallback;
}

function readOption<const Options extends readonly string[]>(
  value: string | number | boolean | undefined,
  options: Options,
  fallback: Options[number],
): Options[number] {
  return typeof value === "string" && options.includes(value)
    ? (value as Options[number])
    : fallback;
}

export function harborPreferenceStyle(
  preferences: HarborPreferences,
): Readonly<Record<string, string>> {
  const { colors } = preferences;
  return {
    "--harbor-status-working": colors.working,
    "--harbor-status-workflow": colors.workflow,
    "--harbor-status-agent": colors.agent,
    "--harbor-status-command": colors.command,
    "--harbor-status-plan": colors.plan,
    "--harbor-status-goal": colors.goal,
    "--harbor-status-waiting": colors.waiting,
    "--harbor-status-unread": colors.unread,
    "--harbor-status-error": colors.error,
    "--harbor-status-inactive": colors.inactive,
    "--harbor-status-stale": colors.stale,
    "--harbor-pr-review": colors.prReview,
    "--harbor-pr-checks": colors.prChecks,
    "--harbor-pr-ready": colors.prReady,
    "--harbor-pr-merged": colors.prMerged,
    "--harbor-pr-draft": colors.prDraft,
    "--harbor-pr-blocked": colors.prBlocked,
    "--harbor-pr-closed": colors.prClosed,
  };
}
