/**
 * Shared Zod schemas and inferred DTO types for Harbor workspaces, repository
 * identity/ownership, worktree removal, and host directory/worktree contracts.
 */
import { z } from "zod";

export const MAX_FACTS_PATHS = 500;
export const MAX_BATCH_WORKTREES = 200;

export const WORKSPACE_DISPLAY_KINDS = [
  "managed-worktree",
  "unmanaged-worktree",
  "other",
] as const;

export const WORKSPACE_KINDS = [
  "project-checkout",
  "git-worktree",
  "nested-checkout",
  "external-checkout",
  "external-directory",
  "personal",
  "unresolved",
] as const;

export const REPO_DIAGNOSTIC_CODES = [
  "split-repo",
  "multi-repo-project",
  "orphan-workspace",
  "ownership-conflict",
  "ambiguous-owner",
  "dangling-path",
  "duplicate-path",
  "unseen-worktree",
  "path-not-canonical",
] as const;

export const REPO_KINDS = ["git-remote", "git-local", "directory"] as const;

export const OWNERSHIP_CONFIDENCES = [
  "exact-source",
  "local-repository",
  "shared-remote",
  "contained",
  "claimed",
  "unresolved",
] as const;

export const workspaceDisplayKindSchema = z.enum(WORKSPACE_DISPLAY_KINDS);
export const workspaceKindSchema = z.enum(WORKSPACE_KINDS);
export type WorkspaceKind = z.infer<typeof workspaceKindSchema>;

export const workspaceEnvironmentDescriptorSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  hostId: z.string(),
  path: z.string().nullable(),
  isGitRepo: z.boolean(),
  isWorktree: z.boolean(),
  branchName: z.string().nullable(),
  name: z.string().nullable(),
  providerId: z.string().nullable(),
  workspaceDisplayKind: workspaceDisplayKindSchema.nullable(),
  managed: z.boolean().optional(),
  createdAt: z.number().nullable().optional(),
  updatedAt: z.number().nullable().optional(),
  providerInstanceKey: z.string().nullable().optional(),
  dangling: z.boolean().optional(),
});

export type WorkspaceEnvironmentDescriptor = Readonly<
  z.infer<typeof workspaceEnvironmentDescriptorSchema>
>;

export const workspaceProjectDescriptorSchema = z.object({
  projectId: z.string(),
  sourcePath: z.string().nullable(),
  sourceHostId: z.string().nullable(),
});

export type WorkspaceProjectDescriptor = Readonly<
  z.infer<typeof workspaceProjectDescriptorSchema>
>;

export const workspacePathsSchema = z.object({
  environments: z.record(z.string(), workspaceEnvironmentDescriptorSchema),
  projects: z.record(z.string(), workspaceProjectDescriptorSchema),
});

export type WorkspacePaths = Readonly<{
  readonly environments: Readonly<
    Record<string, WorkspaceEnvironmentDescriptor>
  >;
  readonly projects: Readonly<Record<string, WorkspaceProjectDescriptor>>;
}>;

const SAFE_SNAPSHOT_ID = /^[^\u0000-\u001F\u007F]+$/;
const MAX_SNAPSHOT_ID_LENGTH = 1024;
const MAX_WORKSPACE_SNAPSHOT_ENTRIES = 2_000;

function validSnapshotId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_SNAPSHOT_ID_LENGTH &&
    value.trim() === value &&
    SAFE_SNAPSHOT_ID.test(value)
  );
}

const snapshotSafeIdSchema = z.string().refine(validSnapshotId, {
  message: "Invalid snapshot identifier.",
});

const snapshotEnvironmentDescriptorSchema =
  workspaceEnvironmentDescriptorSchema.extend({
    id: snapshotSafeIdSchema,
    projectId: snapshotSafeIdSchema,
    hostId: snapshotSafeIdSchema,
  });

const snapshotProjectDescriptorSchema =
  workspaceProjectDescriptorSchema.extend({
    projectId: snapshotSafeIdSchema,
  });

function hasReservedKey(record: unknown): boolean {
  return (
    typeof record === "object" &&
    record !== null &&
    Object.hasOwn(record, "__proto__")
  );
}

function keyedRecordSchema<T extends z.ZodTypeAny>(
  entrySchema: T,
  keyOf: (entry: z.infer<T>) => string,
) {
  return z
    .unknown()
    .transform((raw, ctx) => {
      if (
        typeof raw !== "object" ||
        raw === null ||
        Array.isArray(raw) ||
        hasReservedKey(raw)
      ) {
        ctx.addIssue({ code: "custom", message: "Expected record." });
        return z.NEVER;
      }
      const entries = Object.entries(raw);
      if (entries.length > MAX_WORKSPACE_SNAPSHOT_ENTRIES) {
        ctx.addIssue({ code: "custom", message: "Too many entries." });
        return z.NEVER;
      }
      const out: Record<string, z.infer<T>> = {};
      for (const [key, value] of entries) {
        if (key === "__proto__") {
          ctx.addIssue({ code: "custom", message: "Reserved key." });
          return z.NEVER;
        }
        const parsed = entrySchema.safeParse(value);
        if (!parsed.success || keyOf(parsed.data) !== key) {
          ctx.addIssue({ code: "custom", message: "Invalid keyed entry." });
          return z.NEVER;
        }
        out[key] = parsed.data;
      }
      return out;
    });
}

export const workspacePathsSnapshotSchema = z.object({
  environments: keyedRecordSchema(
    snapshotEnvironmentDescriptorSchema,
    (entry) => entry.id,
  ),
  projects: keyedRecordSchema(
    snapshotProjectDescriptorSchema,
    (entry) => entry.projectId,
  ),
});

export const worktreeSurveySchema = z.object({
  path: z.string(),
  hostId: z.string(),
  branch: z.string().nullable(),
  alias: z.string().nullable().optional(),
  bbOwned: z.boolean(),
  gitWorktree: z.boolean(),
  directoryExists: z.boolean(),
  mainRepoPath: z.string().nullable(),
  changedFiles: z.number().int().nonnegative(),
  untrackedFiles: z.number().int().nonnegative(),
  aheadCommits: z.number().int().nonnegative(),
  baseRef: z.string().nullable(),
  statusUnavailable: z.boolean().optional(),
  threads: z.number().int().nonnegative(),
  liveThreads: z.number().int().nonnegative(),
  openTerminals: z.number().int().nonnegative(),
});

export type WorktreeSurvey = Readonly<z.infer<typeof worktreeSurveySchema>>;

export const removalWarningSchema = z.object({
  kind: z.enum(["discard", "in-use", "external"]),
  text: z.string(),
});

export type RemovalWarning = Readonly<z.infer<typeof removalWarningSchema>>;

export const worktreeRemovalPlanSchema = z.object({
  threadCount: z.number().int().nonnegative(),
  liveThreadCount: z.number().int().nonnegative(),
  directory: z.object({
    via: z.enum(["git", "delete"]),
    warnings: z.array(removalWarningSchema).readonly(),
    refusal: z.string().nullable(),
  }),
});

export type WorktreeRemovalPlan = Readonly<{
  readonly threadCount: number;
  readonly liveThreadCount: number;
  readonly directory: Readonly<{
    readonly via: "git" | "delete";
    readonly warnings: readonly RemovalWarning[];
    readonly refusal: string | null;
  }>;
}>;

export const workspaceRemovalOutcomeSchema = z.object({
  ok: z.boolean(),
  code: z.enum(["unavailable", "acknowledgement", "changed"]).nullable(),
  archivedThreads: z.boolean(),
  environmentRemoved: z.boolean(),
  directory: z.enum(["kept", "removed", "failed"]),
  message: z.string().nullable(),
});

export type WorkspaceRemovalOutcome = Readonly<
  z.infer<typeof workspaceRemovalOutcomeSchema>
>;

export const batchWorktreeSurveyItemSchema = z.object({
  environmentId: z.string(),
  ok: z.boolean(),
  survey: worktreeSurveySchema.nullable(),
  plan: worktreeRemovalPlanSchema.nullable(),
  digest: z.string().nullable(),
  dirty: z.boolean(),
  blockedReason: z.string().nullable(),
  error: z.string().nullable(),
});

export type BatchWorktreeSurveyItem = Readonly<
  z.infer<typeof batchWorktreeSurveyItemSchema>
>;

export const batchWorktreeRemovalItemSchema = z.object({
  environmentId: z.string(),
  status: z.enum(["removed", "skipped", "failed"]),
  outcome: workspaceRemovalOutcomeSchema.nullable(),
  reason: z.string().nullable(),
});

export type BatchWorktreeRemovalItem = Readonly<
  z.infer<typeof batchWorktreeRemovalItemSchema>
>;

export const batchRemoveWorktreesResultSchema = z.object({
  items: z.array(batchWorktreeRemovalItemSchema).readonly(),
  removedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
});

export type BatchRemoveWorktreesResult = Readonly<
  z.infer<typeof batchRemoveWorktreesResultSchema>
>;

export const repoDiagnosticCodeSchema = z.enum(REPO_DIAGNOSTIC_CODES);
export type RepoDiagnosticCode = z.infer<typeof repoDiagnosticCodeSchema>;

export const repoDiagnosticSchema = z.object({
  code: repoDiagnosticCodeSchema,
  repoKey: z.string(),
  subjects: z.array(z.string()).readonly(),
  message: z.string(),
});

export type RepoDiagnostic = Readonly<z.infer<typeof repoDiagnosticSchema>>;

export const hostWorktreeFactSchema = z
  .object({
    path: z.string().min(1),
    branch: z.string().nullable(),
    head: z.string().nullable(),
    detached: z.boolean(),
    prunable: z.boolean(),
  })
  .strict();

export const workspaceFactSchema = z
  .object({
    path: z.string().min(1),
    realPath: z.string().min(1).nullable(),
    isDirectory: z.boolean(),
    isMainWorktree: z.boolean(),
    isLinkedWorktree: z.boolean(),
    isNestedRepository: z.boolean(),
    repositoryRoot: z.string().min(1).nullable(),
    commonDir: z.string().min(1).nullable(),
    remoteUrl: z.string().min(1).nullable(),
    worktrees: z.array(hostWorktreeFactSchema).readonly(),
  })
  .strict();

export const repoWorktreeSchema = z.object({
  hostId: z.string().nullable().optional(),
  path: z.string(),
  branch: z.string().nullable(),
  head: z.string().nullable(),
  detached: z.boolean(),
  prunable: z.boolean(),
});

export type RepoWorktree = Readonly<z.infer<typeof repoWorktreeSchema>>;

export const physicalWorkspaceSchema = z.object({
  key: z.string(),
  hostId: z.string(),
  path: z.string(),
  rawPaths: z.array(z.string()).readonly(),
  aliases: z.array(z.string()).readonly().optional(),
  environmentIds: z.array(z.string()).readonly(),
  projectIds: z.array(z.string()).readonly(),
  repoKey: z.string(),
  isMainWorktree: z.boolean(),
  isLinkedWorktree: z.boolean(),
  isNestedRepository: z.boolean(),
  repositoryRoot: z.string().nullable(),
});

export type PhysicalWorkspace = Readonly<z.infer<typeof physicalWorkspaceSchema>>;

export const repoKindSchema = z.enum(REPO_KINDS);
export type RepoKind = z.infer<typeof repoKindSchema>;

export const repoIdentitySchema = z.object({
  key: z.string(),
  kind: repoKindSchema,
  name: z.string(),
  remoteUrl: z.string().nullable(),
  rootPath: z.string().nullable(),
  hostIds: z.array(z.string()).readonly(),
  projectIds: z.array(z.string()).readonly(),
  workspaces: z.array(physicalWorkspaceSchema).readonly(),
  unseenWorktrees: z.array(repoWorktreeSchema).readonly(),
  diagnostics: z.array(repoDiagnosticSchema).readonly(),
});

export type RepoIdentity = Readonly<z.infer<typeof repoIdentitySchema>>;

export const ownershipConfidenceSchema = z.enum(OWNERSHIP_CONFIDENCES);
export type OwnershipConfidence = z.infer<typeof ownershipConfidenceSchema>;

export const workspaceOwnershipSchema = z.object({
  environmentId: z.string(),
  claimedProjectId: z.string(),
  ownerProjectId: z.string().nullable(),
  workspaceKey: z.string(),
  repoKey: z.string().nullable(),
  kind: workspaceKindSchema,
  confidence: ownershipConfidenceSchema,
  conflict: z.boolean(),
});

export type WorkspaceOwnership = Readonly<
  z.infer<typeof workspaceOwnershipSchema>
>;

export const unseenOwnedWorkspaceSchema = z.object({
  projectId: z.string(),
  repoKey: z.string(),
  hostId: z.string(),
  path: z.string(),
  branch: z.string().nullable(),
  detached: z.boolean(),
});

export type UnseenOwnedWorkspace = Readonly<
  z.infer<typeof unseenOwnedWorkspaceSchema>
>;

export const repoFactsSchema = z.object({
  repos: z.array(repoIdentitySchema).readonly(),
  diagnostics: z.array(repoDiagnosticSchema).readonly(),
  repoKeyByProject: z.record(z.string(), z.string()),
  sourceRepoKeyByProject: z.record(z.string(), z.string()),
  workspaceOwnership: z.record(z.string(), workspaceOwnershipSchema),
  unseenWorkspaces: z.record(
    z.string(),
    z.array(unseenOwnedWorkspaceSchema).readonly(),
  ),
  unavailableHostIds: z.array(z.string()).readonly(),
});

export type RepoFacts = Readonly<z.infer<typeof repoFactsSchema>>;
