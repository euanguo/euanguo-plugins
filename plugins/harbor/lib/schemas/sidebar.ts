/**
 * Shared Zod schemas and inferred DTO types for the Harbor sidebar: project
 * colors/icons, groups, manual order, bulk delete, thread rows, and lifecycle.
 */
import { z } from "zod";
import { canonicalGroupIcon, validGroupIcon } from "../domain/group-icons.ts";

export const MAX_PROJECT_COLOR_ROWS = 500;
export const MAX_PROJECT_ID_LENGTH = 200;

export const MAX_PROJECT_ICON_ROWS = 500;
export const MAX_PROJECT_ICON_LABEL_LENGTH = 80;
export const PROJECT_ICON_SOURCES = ["file", "favicon"] as const;

export const MAX_GROUPS = 100;
export const MAX_GROUP_NAME_LENGTH = 60;
export const MAX_GROUP_ID_LENGTH = 100;

export const MAX_ORDER_SCOPES = 200;
export const MAX_ORDER_ITEMS = 500;
export const MAX_ORDER_ID_LENGTH = 1024;

export const MAX_BULK_DELETE_ROOTS = 50;
export const MAX_ARCHIVED_SHELF_ROWS = 50;

export const BULK_DELETE_SKIP_REASONS = [
  "missing",
  "current",
  "working",
  "waiting",
  "unread",
  "pinned",
  "overlap",
  "scope-changed",
] as const;

const MAX_GROUP_ASSIGNMENT_ENTRIES = 1_000;
const CONTROL_CHAR_PATTERN = /[\u0000-\u001F\u007F]/;
const SAFE_ID_PATTERN = /^[^\u0000-\u001F\u007F]+$/;

function validTrimmedBoundedId(value: string, maxLength: number): boolean {
  return (
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim() === value &&
    SAFE_ID_PATTERN.test(value)
  );
}

function validGroupNameString(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= MAX_GROUP_NAME_LENGTH &&
    !CONTROL_CHAR_PATTERN.test(value)
  );
}

function assertSafeRecord<V>(
  raw: unknown,
  maxEntries: number,
  parseEntry: (key: string, value: unknown) => V | null,
): Record<string, V> | null {
  if (
    typeof raw !== "object" ||
    raw === null ||
    Array.isArray(raw) ||
    Object.hasOwn(raw, "__proto__")
  ) {
    return null;
  }
  const entries = Object.entries(raw);
  if (entries.length > maxEntries) return null;
  const out: Record<string, V> = {};
  for (const [key, value] of entries) {
    if (key === "__proto__") return null;
    const parsed = parseEntry(key, value);
    if (parsed === null) return null;
    out[key] = parsed;
  }
  return out;
}

export const projectIdSchema = z
  .string()
  .min(1)
  .max(MAX_PROJECT_ID_LENGTH)
  .refine((value) => !CONTROL_CHAR_PATTERN.test(value), {
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

export const projectIconSourceSchema = z.enum(PROJECT_ICON_SOURCES);
export type ProjectIconSource = z.infer<typeof projectIconSourceSchema>;

export const projectIconSchema = z.object({
  src: z.string(),
  label: z.string(),
  source: projectIconSourceSchema,
});
export type ProjectIcon = z.infer<typeof projectIconSchema>;

export const projectIconEntrySchema = z.object({
  projectId: projectIdSchema,
  icon: projectIconSchema.nullable(),
});

export const groupIconSchema = z.string().refine(validGroupIcon, {
  message: "Unknown group icon.",
});

export const groupIdSchema = z
  .string()
  .refine((value) => validTrimmedBoundedId(value, MAX_GROUP_ID_LENGTH), {
    message: "Invalid group id.",
  });

export const groupNameSchema = z
  .string()
  .refine(validGroupNameString, {
    message: "Invalid group name.",
  });

export const projectGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  position: z.number(),
  icon: groupIconSchema,
});
export type ProjectGroup = Readonly<z.infer<typeof projectGroupSchema>>;

const groupIconCanonicalSchema = groupIconSchema.transform((icon) =>
  canonicalGroupIcon(icon),
);

const snapshotProjectGroupSchema = z.object({
  id: groupIdSchema,
  name: groupNameSchema,
  position: z.number(),
  icon: groupIconCanonicalSchema,
});

export const groupsSnapshotSchema = z.object({
  groups: z.array(snapshotProjectGroupSchema).max(MAX_GROUPS).readonly(),
  assignment: z.unknown().transform((raw, ctx) => {
    const out = assertSafeRecord<string>(
      raw,
      MAX_GROUP_ASSIGNMENT_ENTRIES,
      (projectId, groupId) => {
        if (!validTrimmedBoundedId(projectId, MAX_ORDER_ID_LENGTH)) return null;
        const parsed = groupIdSchema.safeParse(groupId);
        return parsed.success ? parsed.data : null;
      },
    );
    if (out === null) {
      ctx.addIssue({ code: "custom", message: "Invalid group assignment." });
      return z.NEVER;
    }
    return out as Readonly<Record<string, string>>;
  }),
});

export type GroupsSnapshot = Readonly<z.infer<typeof groupsSnapshotSchema>>;

export const orderScopeIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_ORDER_ID_LENGTH);

export const orderItemsSchema = z
  .array(z.string().trim().min(1).max(MAX_ORDER_ID_LENGTH))
  .max(MAX_ORDER_ITEMS)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "An order cannot name the same item twice.",
  });

const snapshotOrderItemsSchema = z
  .array(
    z
      .string()
      .refine((value) => validTrimmedBoundedId(value, MAX_ORDER_ID_LENGTH), {
        message: "Invalid order item.",
      }),
  )
  .max(MAX_ORDER_ITEMS)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "An order cannot name the same item twice.",
  });

export const orderMapSchema = z
  .record(orderScopeIdSchema, orderItemsSchema)
  .refine((map) => Object.keys(map).length <= MAX_ORDER_SCOPES, {
    message: "Too many order scopes.",
  });

const snapshotOrderMapSchema = z.unknown().transform((raw, ctx) => {
  const out = assertSafeRecord<readonly string[]>(
    raw,
    MAX_ORDER_SCOPES,
    (scopeId, items) => {
      if (!validTrimmedBoundedId(scopeId, MAX_ORDER_ID_LENGTH)) return null;
      const parsed = snapshotOrderItemsSchema.safeParse(items);
      return parsed.success ? parsed.data : null;
    },
  );
  if (out === null) {
    ctx.addIssue({ code: "custom", message: "Invalid order map." });
    return z.NEVER;
  }
  return out as Readonly<Record<string, readonly string[]>>;
});

export const orderSnapshotSchema = z.object({
  projects: snapshotOrderMapSchema,
  families: snapshotOrderMapSchema,
  workspaces: snapshotOrderMapSchema,
});
export type OrderSnapshot = Readonly<z.infer<typeof orderSnapshotSchema>>;

export const orderWriteSchema = z.object({
  ok: z.boolean(),
  stale: z.boolean(),
  revision: z.number().int().nonnegative(),
});

export const bulkDeleteSkipReasonSchema = z.enum(BULK_DELETE_SKIP_REASONS);
export type BulkDeleteSkipReason = z.infer<typeof bulkDeleteSkipReasonSchema>;

export const bulkDeleteSkippedRootSchema = z.object({
  id: z.string(),
  reason: bulkDeleteSkipReasonSchema,
  message: z.string(),
});
export type BulkDeleteSkippedRoot = z.infer<typeof bulkDeleteSkippedRootSchema>;

export const bulkDeleteIncludedRootSchema = z.object({
  id: z.string(),
  title: z.string(),
  childCount: z.number().int().nonnegative(),
});
export type BulkDeleteIncludedRoot = z.infer<
  typeof bulkDeleteIncludedRootSchema
>;

export const bulkDeleteFailedRootSchema = z.object({
  id: z.string(),
  message: z.string().max(240),
});
export type BulkDeleteFailedRoot = z.infer<typeof bulkDeleteFailedRootSchema>;

export const selectedThreadIdsSchema = z
  .array(z.string().trim().min(1))
  .min(1)
  .max(MAX_BULK_DELETE_ROOTS)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "A root thread can be selected only once.",
  });

export const threadIdSchema = z.object({ threadId: z.string().trim().min(1) });
export const truncatedSchema = z.boolean().optional();

export const threadActivitySchema = z.object({
  workflows: z.number(),
  backgroundAgents: z.number(),
  backgroundCommands: z.number(),
  planMode: z.number(),
});

export const threadRowSchema = z.object({
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
  activity: threadActivitySchema,
  createdAt: z.number(),
  updatedAt: z.number(),
  lastReadAt: z.number().nullable(),
  latestAttentionAt: z.number(),
});
export type SidebarThreadRowBase = z.infer<typeof threadRowSchema>;

export const recoveryThreadEnvironmentSchema = z.object({
  id: z.string().nullable(),
  name: z.string().nullable(),
  branchName: z.string().nullable(),
  providerId: z.string().nullable(),
  workspaceDisplayKind: z.string().nullable(),
});
export type RecoveryThreadEnvironment = z.infer<
  typeof recoveryThreadEnvironmentSchema
>;

export const recoveryThreadRowSchema = threadRowSchema.extend({
  environment: recoveryThreadEnvironmentSchema.nullable(),
  host: z.object({ id: z.string(), name: z.string() }).nullable(),
});
export type RecoveryThreadRow = z.infer<typeof recoveryThreadRowSchema>;

export const settledThreadRowSchema = threadRowSchema.extend({
  settledAt: z.number(),
});
export type SettledThreadRow = z.infer<typeof settledThreadRowSchema>;

export const lifecycleRowSchema = z.object({
  threadId: z.string(),
  settledAt: z.number().nullable(),
  snoozedUntil: z.number().nullable(),
  snoozedAt: z.number().nullable(),
});
export type ThreadLifecycleRow = z.infer<typeof lifecycleRowSchema>;

export const providerSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  logoUrl: z.string().nullable(),
});
export type WarmStartProvider = z.infer<typeof providerSchema>;
