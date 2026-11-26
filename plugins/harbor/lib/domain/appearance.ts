/**
 * The appearance settings (`appearance:v2`): curated sidebar, color preset, and
 * workspace defaults stored in a single plugin KV row.
 *
 * Upgraded directly to `appearance:v2` with no v1 migration decoder: unknown
 * keys or malformed values fall back cleanly to `APPEARANCE_DEFAULTS`.
 */

import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MIN_PAGE_SIZE,
  resolvePageSize,
} from "./paging.ts";
import {
  CHILD_EXPANSION_OPTIONS,
  DEFAULT_FEATURE_BASE_BRANCH,
  DEFAULT_FEATURE_BRANCH_TEMPLATE,
  PALETTE_PRESET_OPTIONS,
  ROW_DENSITY_OPTIONS,
  STATUS_DISPLAY_OPTIONS,
  WORKSPACE_OWNERSHIP_OPTIONS,
  WORKTREE_LABEL_OPTIONS,
  normalizeFeatureBranchTemplate,
  normalizeFeatureDefaultBase,
  type ChildExpansionOption,
  type PalettePreset,
  type RowDensity,
  type StatusDisplay,
  type WorkspaceOwnershipMode,
  type WorktreeLabelOption,
} from "./preferences.ts";

/** The key the whole record lives under. One kv row, read and written whole. */
export const APPEARANCE_KV_KEY = "appearance:v2";

export type AppearanceValues = {
  palettePreset: PalettePreset;
  rowDensity: RowDensity;
  statusDisplay: StatusDisplay;
  worktreeLabel: WorktreeLabelOption;
  defaultChildExpansion: ChildExpansionOption;
  showQuickActions: boolean;
  pageSize: number;
  autoProjectIcons: boolean;
  workspaceOwnership: WorkspaceOwnershipMode;
  showTitleAttention: boolean;
  showUnregisteredWorktrees: boolean;
  groupByRepository: boolean;
  featureBranchTemplate: string;
  featureDefaultBase: string;
};

export const APPEARANCE_DEFAULTS: Readonly<AppearanceValues> = {
  palettePreset: "Default",
  rowDensity: "detailed",
  statusDisplay: "dot",
  worktreeLabel: "alias-over-branch",
  defaultChildExpansion: "expanded",
  showQuickActions: true,
  pageSize: DEFAULT_PAGE_SIZE,
  autoProjectIcons: true,
  workspaceOwnership: "filesystem",
  showTitleAttention: false,
  showUnregisteredWorktrees: false,
  groupByRepository: false,
  featureBranchTemplate: DEFAULT_FEATURE_BRANCH_TEMPLATE,
  featureDefaultBase: DEFAULT_FEATURE_BASE_BRANCH,
};

export type AppearanceKey = keyof AppearanceValues;

export const APPEARANCE_KEYS = Object.keys(
  APPEARANCE_DEFAULTS,
) as readonly AppearanceKey[];

function isOption<const Options extends readonly string[]>(
  value: unknown,
  options: Options,
): value is Options[number] {
  return typeof value === "string" && options.includes(value);
}

/**
 * Strict validation for one appearance value against its schema rules.
 * For `pageSize`, requires an integer within `MIN_PAGE_SIZE..MAX_PAGE_SIZE`.
 */
export function validAppearanceValue(
  key: AppearanceKey,
  value: unknown,
): boolean {
  switch (key) {
    case "palettePreset":
      return isOption(value, PALETTE_PRESET_OPTIONS);
    case "rowDensity":
      return isOption(value, ROW_DENSITY_OPTIONS);
    case "statusDisplay":
      return isOption(value, STATUS_DISPLAY_OPTIONS);
    case "worktreeLabel":
      return isOption(value, WORKTREE_LABEL_OPTIONS);
    case "defaultChildExpansion":
      return isOption(value, CHILD_EXPANSION_OPTIONS);
    case "workspaceOwnership":
      return isOption(value, WORKSPACE_OWNERSHIP_OPTIONS);
    case "pageSize":
      return (
        typeof value === "number" &&
        Number.isInteger(value) &&
        value >= MIN_PAGE_SIZE &&
        value <= MAX_PAGE_SIZE
      );
    case "featureBranchTemplate":
      return normalizeFeatureBranchTemplate(value) !== null;
    case "featureDefaultBase":
      return normalizeFeatureDefaultBase(value) !== null;
    case "showQuickActions":
    case "autoProjectIcons":
    case "showTitleAttention":
    case "showUnregisteredWorktrees":
    case "groupByRepository":
      return typeof value === "boolean";
  }
}

/**
 * Normalizes a candidate value into a valid stored entry, or `undefined` when
 * the value cannot be coerced (e.g. wrong type, `NaN`, or unknown option).
 * Finite `pageSize` numbers are clamped to integers in `1..100`.
 */
export function normalizeAppearanceValue<K extends AppearanceKey>(
  key: K,
  value: unknown,
): AppearanceValues[K] | undefined {
  if (key === "pageSize") {
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    return resolvePageSize(value) as AppearanceValues[K];
  }
  if (key === "featureBranchTemplate") {
    return (normalizeFeatureBranchTemplate(value) ?? undefined) as
      | AppearanceValues[K]
      | undefined;
  }
  if (key === "featureDefaultBase") {
    return (normalizeFeatureDefaultBase(value) ?? undefined) as
      | AppearanceValues[K]
      | undefined;
  }
  return validAppearanceValue(key, value)
    ? (value as AppearanceValues[K])
    : undefined;
}

/**
 * Resolves a stored or untrusted appearance object over `APPEARANCE_DEFAULTS`.
 * Unknown keys and invalid values are ignored; finite `pageSize` is clamped.
 */
export function resolveAppearance(raw: unknown): AppearanceValues {
  const values: AppearanceValues = { ...APPEARANCE_DEFAULTS };
  if (typeof raw !== "object" || raw === null) return values;
  const record = raw as Record<string, unknown>;
  for (const key of APPEARANCE_KEYS) {
    const normalized = normalizeAppearanceValue(key, record[key]);
    if (normalized !== undefined) {
      (values as Record<AppearanceKey, string | number | boolean>)[key] =
        normalized;
    }
  }
  return values;
}
