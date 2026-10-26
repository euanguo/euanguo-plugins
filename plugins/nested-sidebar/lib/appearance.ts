/**
 * The appearance settings: what the sidebar looks like, with no server in the
 * loop.
 *
 * These used to be thirty-four `bb.settings` descriptors. That made them a wall
 * — the host form has one row per descriptor and the plugin cannot group,
 * reorder or collapse them, so the settings page opened on 2,830px of fields
 * before it reached anything the plugin drew itself. Three of those rows were
 * a lie the plugin kept telling: eighteen hex text boxes that could be changed
 * but not seen, above a read-only swatch list that could be seen but not
 * changed.
 *
 * The question that splits the two homes is *who reads the value*:
 *
 * - The **server** reads an agent switch when it decides whether to register a
 *   tool. That has to be a descriptor (`bb.settings`), because it is read on
 *   the server at load and changed through the host's own settings page.
 * - Nothing on the server reads a row layout or a colour. The frontend draws
 *   with them and nothing else. Those live here, in the plugin's key-value
 *   store, where the frontend can write them — which is also what lets the
 *   settings page draw one palette instead of eighteen text boxes, and what
 *   will later let the view menu change a display toggle where the toggle is
 *   seen.
 *
 * The names are the descriptor names they replaced, on purpose: the one-time
 * migration copies values across by key, and `resolveNestPreferences` needed no
 * change at all.
 */

import { CUSTOM_COLOR_DEFAULTS, DEFAULT_ROW_DETAILS } from "./preferences.ts";
import { DEFAULT_PAGE_SIZE } from "./paging.ts";

/** The key the whole record lives under. One kv row, read and written whole. */
export const APPEARANCE_KV_KEY = "appearance:v1";

/**
 * Every appearance setting, in the order the settings page draws them, with the
 * value a fresh install starts from.
 *
 * A flat record of primitives, matching the shape `resolveNestPreferences`
 * already reads and the shape `bb.settings` used to hand over — so the value
 * this returns is the value that function already knew how to validate.
 */
export const APPEARANCE_DEFAULTS = {
  palettePreset: "Default",

  // The palette's eighteen literal colours. Only read when the preset is
  // Custom; kept whatever the preset so switching away and back is lossless.
  workingColor: CUSTOM_COLOR_DEFAULTS.working,
  waitingColor: CUSTOM_COLOR_DEFAULTS.waiting,
  unreadColor: CUSTOM_COLOR_DEFAULTS.unread,
  errorColor: CUSTOM_COLOR_DEFAULTS.error,
  idleColor: CUSTOM_COLOR_DEFAULTS.inactive,
  staleColor: CUSTOM_COLOR_DEFAULTS.stale,
  workflowColor: CUSTOM_COLOR_DEFAULTS.workflow,
  agentColor: CUSTOM_COLOR_DEFAULTS.agent,
  commandColor: CUSTOM_COLOR_DEFAULTS.command,
  planColor: CUSTOM_COLOR_DEFAULTS.plan,
  goalColor: CUSTOM_COLOR_DEFAULTS.goal,
  prReviewColor: CUSTOM_COLOR_DEFAULTS.prReview,
  prChecksColor: CUSTOM_COLOR_DEFAULTS.prChecks,
  prReadyColor: CUSTOM_COLOR_DEFAULTS.prReady,
  prMergedColor: CUSTOM_COLOR_DEFAULTS.prMerged,
  prDraftColor: CUSTOM_COLOR_DEFAULTS.prDraft,
  prBlockedColor: CUSTOM_COLOR_DEFAULTS.prBlocked,
  prClosedColor: CUSTOM_COLOR_DEFAULTS.prClosed,

  // The thread list.
  rowLayout: "Two lines",
  rowDetails: DEFAULT_ROW_DETAILS,
  worktreeLabel: "Alias over branch",
  statusDisplay: "Dot",
  defaultChildExpansion: "Expanded",
  pageSize: DEFAULT_PAGE_SIZE,
  showThreadLocation: true,
  showProviderIcons: true,
  showPullRequestMetadata: true,
  showChildCount: true,
  showRelativeTime: true,

  // Projects.
  autoProjectIcons: true,
  workspaceOwnership: "Filesystem",
  showUnregisteredWorktrees: false,
  groupByRepository: false,
} as const satisfies Record<string, string | number | boolean>;

export type AppearanceKey = keyof typeof APPEARANCE_DEFAULTS;

/**
 * The record's type, derived from the defaults so each setting keeps its own
 * type: a boolean stays a boolean, a page size stays a number, a colour stays a
 * string. A loose `string | number | boolean` for every key would make every
 * consumer re-narrow what the defaults already declared.
 */
export type AppearanceValues = {
  [K in AppearanceKey]: (typeof APPEARANCE_DEFAULTS)[K] extends boolean
    ? boolean
    : (typeof APPEARANCE_DEFAULTS)[K] extends number
      ? number
      : string;
};

export const APPEARANCE_KEYS = Object.keys(
  APPEARANCE_DEFAULTS,
) as readonly AppearanceKey[];

/** Every key that holds a `#RRGGBB` colour. */
export const APPEARANCE_COLOR_KEYS = APPEARANCE_KEYS.filter((key) =>
  key.endsWith("Color"),
);

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

/**
 * One value, or a refusal.
 *
 * Validation is by type against the default: a key whose default is a boolean
 * takes a boolean, a colour key takes a hex, a page size takes a finite number,
 * and everything else takes a string. The *content* of a select is checked by
 * `resolveNestPreferences`, which already degrades an unknown option to the
 * default — so this layer only has to keep the record well-typed.
 */
export function validAppearanceValue(key: AppearanceKey, value: unknown) {
  const fallback = APPEARANCE_DEFAULTS[key];
  if (typeof fallback === "boolean") return typeof value === "boolean";
  if (typeof fallback === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }
  if (APPEARANCE_COLOR_KEYS.includes(key)) {
    return typeof value === "string" && HEX_COLOR.test(value.trim());
  }
  return typeof value === "string";
}

/**
 * The record a caller may trust: defaults, overlaid with whatever of `raw` is
 * both a known key and a well-typed value.
 *
 * Written defensively because both sources it reads are outside its control —
 * kv holds what a previous build (or a hand-edited database) wrote, and the
 * migration hands over whatever the host had stored.
 */
export function resolveAppearance(raw: unknown): AppearanceValues {
  const values: AppearanceValues = { ...APPEARANCE_DEFAULTS };
  if (typeof raw !== "object" || raw === null) return values;
  const record = raw as Record<string, unknown>;
  for (const key of APPEARANCE_KEYS) {
    const candidate = record[key];
    if (candidate !== undefined && validAppearanceValue(key, candidate)) {
      // The cast is the assignment the discriminator above just proved.
      (values as Record<string, unknown>)[key] = candidate;
    }
  }
  return values;
}
