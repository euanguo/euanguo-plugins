import type { WorkspaceLabelMode } from "./workspace.ts";
import { resolvePageSize } from "./paging.ts";

export const PALETTE_PRESET_OPTIONS = [
  "Default",
  "High contrast",
  "Colorblind-friendly",
  "Custom",
] as const;

export const CHILD_EXPANSION_OPTIONS = ["Expanded", "Collapsed"] as const;
export const ROW_LAYOUT_OPTIONS = ["Two lines", "One line"] as const;
export const STATUS_DISPLAY_OPTIONS = ["Dot", "Status icon"] as const;
export const ROW_DETAIL_OPTIONS = [
  "In the row",
  "In the row, no branch",
  "On hover",
] as const;
/**
 * The row keeps its details, and drops the branch it shares with every other
 * row under the same workspace. The worktree row above already names it, so
 * repeating it on each thread spends the width the title wants.
 */
export const DEFAULT_ROW_DETAILS: (typeof ROW_DETAIL_OPTIONS)[number] =
  "In the row, no branch";
export const WORKTREE_LABEL_OPTIONS = [
  "Alias over branch",
  "Alias + branch",
  "Alias only",
  "Branch only",
] as const;
export const WORKSPACE_OWNERSHIP_OPTIONS = [
  "Filesystem",
  "bb claims",
] as const;

export type PalettePreset = (typeof PALETTE_PRESET_OPTIONS)[number];
export type RowLayout = "two-line" | "one-line";
export type StatusDisplay = "dot" | "icon";
/** Where a thread row's non-essential fields live. */
export type RowDetailPlacement = "row" | "row-no-branch" | "hover";
export type WorktreeLabelOption = (typeof WORKTREE_LABEL_OPTIONS)[number];
export type RowDetailOption = (typeof ROW_DETAIL_OPTIONS)[number];
export type WorkspaceOwnershipMode = "filesystem" | "claimed";

/** The declared option labels, mapped onto the row's own vocabulary. */
const ROW_DETAIL_MODES: Readonly<Record<RowDetailOption, RowDetailPlacement>> = {
  "In the row": "row",
  "In the row, no branch": "row-no-branch",
  "On hover": "hover",
};

/** The declared option labels, mapped onto the row's own vocabulary. */
const WORKTREE_LABEL_MODES: Readonly<
  Record<WorktreeLabelOption, WorkspaceLabelMode>
> = {
  "Alias over branch": "alias-over-branch",
  "Alias + branch": "alias-and-branch",
  "Alias only": "alias-only",
  "Branch only": "branch-only",
};

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

export interface NestPreferences {
  palettePreset: PalettePreset;
  colors: SemanticPalette;
  /** One line saves height; two lines keep the branch on its own line. */
  rowLayout: RowLayout;
  /** How a worktree row divides the alias and the branch between its lines. */
  worktreeLabel: WorkspaceLabelMode;
  /** A dot is quieter and narrower than the state's own icon. */
  statusDisplay: StatusDisplay;
  /**
   * `row` keeps the branch, provider, PR, age, and child count on the row;
   * `hover` moves all of them into the row's hover card, which is what makes a
   * single-column row possible. The row keeps its status and its title either
   * way, so nothing that needs you can be hidden.
   */
  rowDetails: RowDetailPlacement;
  defaultChildrenExpanded: boolean;
  showProviderIcons: boolean;
  showPullRequestMetadata: boolean;
  showRelativeTime: boolean;
  showChildCount: boolean;
  showThreadLocation: boolean;
  /**
   * Whether a project's own icon replaces its letter badge. The detection
   * itself runs on the server, against the checkout; this decides whether the
   * sidebar asks for it and whether the answer is drawn.
   */
  autoProjectIcons: boolean;
  /**
   * Whether the tree follows each project's source and repository facts or
   * preserves bb's claimed environment project.
   */
  workspaceOwnership: WorkspaceOwnershipMode;
  /**
   * Whether repository-recorded worktrees with no bb environment are drawn.
   *
   * Off by default: they are useful to adopt, but they are not places bb can
   * already run a thread and should not expand every project that happens to
   * have an external worktree.
   */
  showUnregisteredWorktrees: boolean;
  /**
   * Whether one repository is drawn as one row.
   *
   * Off by default, because the merged row is the tree disagreeing with bb's own
   * list: a user who filed two projects apart on purpose must be able to see
   * bb's answer, and the merge is a claim about the disk that only the machine
   * holding it can make. On, the worktrees of one repository stay together even
   * when bb holds them as several projects.
   */
  groupByRepository: boolean;
  /**
   * How many rows one page holds, everywhere the sidebar pages: what a list
   * draws at first, and what each **Load more** adds.
   */
  pageSize: number;
}

export const CUSTOM_COLOR_DEFAULTS = {
  working: "#34A853",
  workflow: "#8B5CF6",
  agent: "#0891B2",
  command: "#EA6A20",
  plan: "#6366F1",
  goal: "#DB3F8D",
  waiting: "#D9911A",
  unread: "#3B82C4",
  error: "#D94B4B",
  inactive: "#A1A8B3",
  stale: "#69717D",
  prReview: "#3B82F6",
  prChecks: "#F59E0B",
  prReady: "#22C55E",
  prMerged: "#A855F7",
  prDraft: "#94A3B8",
  prBlocked: "#EF4444",
  prClosed: "#64748B",
} as const satisfies SemanticPalette;

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
  inactive: "color-mix(in srgb, var(--muted-foreground, #A1A8B3) 72%, transparent)",
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

const COLOR_SETTING_KEYS: Readonly<Record<SemanticColorRole, string>> = {
  working: "workingColor",
  workflow: "workflowColor",
  agent: "agentColor",
  command: "commandColor",
  plan: "planColor",
  goal: "goalColor",
  waiting: "waitingColor",
  unread: "unreadColor",
  error: "errorColor",
  inactive: "idleColor",
  stale: "staleColor",
  prReview: "prReviewColor",
  prChecks: "prChecksColor",
  prReady: "prReadyColor",
  prMerged: "prMergedColor",
  prDraft: "prDraftColor",
  prBlocked: "prBlockedColor",
  prClosed: "prClosedColor",
};

const HEX_COLOR = /^#[0-9A-F]{6}$/i;

export function resolveNestPreferences(
  values: Readonly<Record<string, string | number | boolean>> | undefined,
): NestPreferences {
  const palettePreset = readOption(
    values?.palettePreset,
    PALETTE_PRESET_OPTIONS,
    "Default",
  );
  const colors = resolvePalette(palettePreset, values);

  return {
    palettePreset,
    colors,
    rowLayout:
      readOption(values?.rowLayout, ROW_LAYOUT_OPTIONS, "Two lines") ===
      "One line"
        ? "one-line"
        : "two-line",
    worktreeLabel:
      WORKTREE_LABEL_MODES[
        readOption(
          values?.worktreeLabel,
          WORKTREE_LABEL_OPTIONS,
          "Alias over branch",
        )
      ],
    statusDisplay:
      readOption(
        values?.statusDisplay,
        STATUS_DISPLAY_OPTIONS,
        "Dot",
      ) === "Status icon"
        ? "icon"
        : "dot",
    rowDetails:
      ROW_DETAIL_MODES[
        readOption(
          values?.rowDetails,
          ROW_DETAIL_OPTIONS,
          DEFAULT_ROW_DETAILS,
        )
      ],
    defaultChildrenExpanded:
      readOption(
        values?.defaultChildExpansion,
        CHILD_EXPANSION_OPTIONS,
        "Expanded",
      ) === "Expanded",
    showProviderIcons: readBoolean(values?.showProviderIcons, true),
    showPullRequestMetadata: readBoolean(
      values?.showPullRequestMetadata,
      true,
    ),
    showRelativeTime: readBoolean(values?.showRelativeTime, true),
    showChildCount: readBoolean(values?.showChildCount, true),
    showThreadLocation: readBoolean(values?.showThreadLocation, true),
    autoProjectIcons: readBoolean(values?.autoProjectIcons, true),
    workspaceOwnership:
      readOption(
        values?.workspaceOwnership,
        WORKSPACE_OWNERSHIP_OPTIONS,
        "Filesystem",
      ) === "Filesystem"
        ? "filesystem"
        : "claimed",
    showUnregisteredWorktrees: readBoolean(
      values?.showUnregisteredWorktrees,
      false,
    ),
    groupByRepository: readBoolean(values?.groupByRepository, false),
    pageSize: resolvePageSize(values?.pageSize),
  };
}

function resolvePalette(
  preset: PalettePreset,
  values: Readonly<Record<string, string | number | boolean>> | undefined,
): SemanticPalette {
  switch (preset) {
    case "High contrast":
      return HIGH_CONTRAST_PALETTE;
    case "Colorblind-friendly":
      return COLORBLIND_FRIENDLY_PALETTE;
    case "Custom":
      return Object.fromEntries(
        SEMANTIC_COLOR_ROLES.map((role) => [
          role,
          readHex(values?.[COLOR_SETTING_KEYS[role]], CUSTOM_COLOR_DEFAULTS[role]),
        ]),
      ) as Record<SemanticColorRole, string>;
    case "Default":
      return DEFAULT_PALETTE;
  }
}

function readHex(
  value: string | number | boolean | undefined,
  fallback: string,
): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toUpperCase();
  return HEX_COLOR.test(normalized) ? normalized : fallback;
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

export function nestPreferenceStyle(
  preferences: NestPreferences,
): Readonly<Record<string, string>> {
  const { colors } = preferences;
  return {
    "--nest-status-working": colors.working,
    "--nest-status-workflow": colors.workflow,
    "--nest-status-agent": colors.agent,
    "--nest-status-command": colors.command,
    "--nest-status-plan": colors.plan,
    "--nest-status-goal": colors.goal,
    "--nest-status-waiting": colors.waiting,
    "--nest-status-unread": colors.unread,
    "--nest-status-error": colors.error,
    "--nest-status-inactive": colors.inactive,
    "--nest-status-stale": colors.stale,
    "--nest-pr-review": colors.prReview,
    "--nest-pr-checks": colors.prChecks,
    "--nest-pr-ready": colors.prReady,
    "--nest-pr-merged": colors.prMerged,
    "--nest-pr-draft": colors.prDraft,
    "--nest-pr-blocked": colors.prBlocked,
    "--nest-pr-closed": colors.prClosed,
  };
}
