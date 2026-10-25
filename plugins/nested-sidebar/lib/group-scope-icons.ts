import type { GroupIconName } from "./group-icons.ts";

/**
 * The two tabs the strip shows that are not rows in `project_groups`, and the
 * icon each one draws when the strip is too narrow for labels.
 *
 * The keys are the strip's own scope keys. `view-state.ts` spells the same two
 * strings for the browser-local selection, and a test pins them together rather
 * than trusting two copies of a literal to stay equal.
 */
export const SCOPE_ICON_KEYS = {
  all: "__all__",
  ungrouped: "__ungrouped__",
} as const;

export const SCOPE_ICON_SCOPES = ["all", "ungrouped"] as const;

/** The scopes that carry an icon of their own. */
export type ScopeIconScope = (typeof SCOPE_ICON_SCOPES)[number];

export type ScopeIcons = Readonly<Record<ScopeIconScope, GroupIconName>>;

/**
 * What the strip drew before these icons were configurable: an eye for "All"
 * and a tree for "Ungrouped". Both are Hugeicons names now, because the strip
 * draws every tab through `GroupIcon` — one icon system is what makes choosing
 * an icon mean anything.
 */
export const DEFAULT_SCOPE_ICONS: ScopeIcons = {
  all: "EyeIcon",
  ungrouped: "FolderTreeIcon",
};
