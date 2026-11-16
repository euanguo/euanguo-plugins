/**
 * How the scope strip above the tree names its scopes.
 *
 * The strip has one width to work with and a variable number of scopes, so it
 * has always had two layouts: names while they fit, and a letter tile each once
 * they do not. Which one is drawn is normally the strip's own call. This is the
 * exception — a standing choice that the names stay, and the strip scrolls
 * sideways instead of switching. Stored with the view preferences for the same
 * reason the sort modes are: it is a lens over the tree, and the frontend cannot
 * write `bb.settings`.
 */
export const SCOPE_STRIP_MODES = ["auto", "labels"] as const;
export type ScopeStripMode = (typeof SCOPE_STRIP_MODES)[number];

export const DEFAULT_SCOPE_STRIP_MODE: ScopeStripMode = "auto";

export const SCOPE_STRIP_LABELS: Readonly<
  Record<ScopeStripMode, string>
> = {
  auto: "Fit the width",
  labels: "Always show names",
};

export function validScopeStripMode(value: unknown): value is ScopeStripMode {
  return (
    typeof value === "string" &&
    (SCOPE_STRIP_MODES as readonly string[]).includes(value)
  );
}
