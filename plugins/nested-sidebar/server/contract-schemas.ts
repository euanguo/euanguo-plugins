import { z } from "zod";

import { MAX_BULK_DELETE_ROOTS } from "../lib/bulk-delete.ts";
import {
  validGroupIcon,
} from "../lib/groups.ts";
import {
  MAX_ORDER_ID_LENGTH,
  MAX_ORDER_ITEMS,
  MAX_ORDER_SCOPES,
} from "../lib/manual-order.ts";
import { ORGANIZATION_MODES } from "../lib/organization.ts";
import { MAX_PROJECT_ID_LENGTH } from "../lib/project-colors.ts";
import { PROJECT_ICON_SOURCES } from "../lib/project-icons.ts";
import {
  PROJECT_SORT_MODES,
  THREAD_SORT_MODES,
  WORKTREE_SORT_MODES,
} from "../lib/sort-modes.ts";
import type { WorktreeRemovalPlan } from "../lib/worktree-removal.ts";
import {
  APPEARANCE_COLOR_KEYS,
  APPEARANCE_DEFAULTS,
  type AppearanceKey,
} from "../lib/appearance.ts";

/**
 * One group's icon on the wire.
 *
 * A stored icon is what the frontend draws, so the boundary rejects a string
 * the icon registry cannot render.
 */
export const groupIconSchema = z.string().refine(validGroupIcon, {
  message: "Unknown group icon.",
});

/** The field schema each appearance setting gets, chosen by its default's type. */
type AppearanceSchemaShape = {
  [K in AppearanceKey]: (typeof APPEARANCE_DEFAULTS)[K] extends boolean
    ? z.ZodDefault<z.ZodBoolean>
    : (typeof APPEARANCE_DEFAULTS)[K] extends number
      ? z.ZodDefault<z.ZodNumber>
      : z.ZodDefault<z.ZodString>;
};

/**
 * The appearance record on the wire: one field per setting, built from the
 * defaults so a key added there cannot be forgotten here.
 *
 * A colour is validated as a hex and uppercased, which is the only form the
 * frontend writes. The *content* of a select is not validated here: the store
 * keeps what it is given and `resolveNestPreferences` is what degrades an
 * unknown option to the default — the same rule the descriptors had.
 *
 * The cast is the one the builder cannot express: `Object.entries` loses the
 * key-to-type correspondence while the mapped type above keeps it.
 */
export const appearanceSchema = z.object(
  Object.fromEntries(
    Object.entries(APPEARANCE_DEFAULTS).map(([key, fallback]) => {
      if (typeof fallback === "boolean") {
        return [key, z.boolean().default(fallback)];
      }
      if (typeof fallback === "number") {
        return [key, z.number().finite().default(fallback)];
      }
      if (APPEARANCE_COLOR_KEYS.includes(key as AppearanceKey)) {
        return [
          key,
          z
            .string()
            .trim()
            .regex(/^#[0-9A-F]{6}$/i)
            .transform((value) => value.toUpperCase())
            .default(fallback),
        ];
      }
      return [key, z.string().default(fallback)];
    }),
  ) as unknown as AppearanceSchemaShape,
);

export const threadIdSchema = z.object({ threadId: z.string().trim().min(1) });
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

/**
 * What bb can say about one workspace before anything is touched. The counts are
 * what the removal dialog has to put in front of the user, so they travel with
 * their names rather than as a tuple.
 */
export const worktreeSurveySchema = z.object({
  path: z.string(),
  hostId: z.string(),
  branch: z.string().nullable(),
  /** bb created this directory, so removing it is bb's own cleanup. */
  bbOwned: z.boolean(),
  gitWorktree: z.boolean(),
  directoryExists: z.boolean(),
  mainRepoPath: z.string().nullable(),
  changedFiles: z.number().int().nonnegative(),
  untrackedFiles: z.number().int().nonnegative(),
  aheadCommits: z.number().int().nonnegative(),
  baseRef: z.string().nullable(),
  threads: z.number().int().nonnegative(),
  liveThreads: z.number().int().nonnegative(),
  openTerminals: z.number().int().nonnegative(),
});

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

export const removalBlockerSchema = z.enum(["unavailable", "acknowledgement"]);
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
 * One live thread as bb's SDK reports it, for the recovery read.
 *
 * Every open field is loose on purpose — `status`, `originKind`, and
 * `workspaceDisplayKind` arrive as plain strings — so a value a newer bb
 * invents degrades in `lib/recovery-threads.ts` instead of failing this output
 * validation and leaving the retry with nothing to show. `listSettledThreads`
 * makes the same trade for the same reason.
 */
export const recoveryThreadRowSchema = z.object({
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
    goals: z.number(),
  }),
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
  createdAt: z.number(),
  updatedAt: z.number(),
  lastReadAt: z.number().nullable(),
  latestAttentionAt: z.number(),
});
