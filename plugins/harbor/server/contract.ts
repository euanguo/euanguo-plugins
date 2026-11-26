/**
 * The plugin's RPC surface: what the frontend may ask for, and in what shape.
 *
 * Reusable DTO schemas and inferred types live under `lib/schemas/*`.
 */
import { defineRpcContract, type PluginRpcHandlers } from "@get-bb/plugin-sdk";
import { z } from "zod";

import { DEFAULT_GROUP_ICON } from "../lib/domain/group-icons.ts";
import {
  MAX_PARK_NOTE_LENGTH,
  MAX_PARK_REASON_LENGTH,
  MAX_PRESET_NAME_LENGTH,
  MAX_PRESET_REPOS,
  MAX_PRESETS,
  diffFileEntrySchema,
  featureBriefInputSchema,
  featureBriefSchema,
  featureDecisionInputSchema,
  featureDecisionSchema,
  featureGitSummarySchema,
  featureHealthReportSchema,
  featureIdSchema,
  featureMemberSchema,
  featureMetaSchema,
  featureMetaSummarySchema,
  featureNameSchema,
  featurePresetRepoSchema,
  featurePresetSchema,
  featureRefInputSchema,
  featureRefLinkSchema,
  featureRefSchema,
  featureRepoRoleSchema,
  featureSchema,
  repoSpecInputSchema,
  repositoryResultSchema,
} from "../lib/schemas/feature.ts";
import {
  agentAccessTierSchema,
  appearancePatchSchema,
  appearanceSchema,
  nestMigrationApplyInputSchema,
  nestMigrationApplyResultSchema,
  nestMigrationPreviewSchema,
  organizationModeSchema,
  projectSortSchema,
  scopeStripModeSchema,
  sidebarModeSchema,
  threadSortSchema,
  worktreeSortSchema,
} from "../lib/schemas/settings.ts";
import {
  MAX_ARCHIVED_SHELF_ROWS,
  MAX_GROUPS,
  MAX_GROUP_NAME_LENGTH,
  MAX_PROJECT_COLOR_ROWS,
  MAX_PROJECT_ICON_ROWS,
  bulkDeleteFailedRootSchema,
  bulkDeleteIncludedRootSchema,
  bulkDeleteSkippedRootSchema,
  groupIconSchema,
  lifecycleRowSchema,
  orderItemsSchema,
  orderMapSchema,
  orderScopeIdSchema,
  orderWriteSchema,
  projectColorSchema,
  projectGroupSchema,
  projectIconEntrySchema,
  projectIdSchema,
  providerSchema,
  recoveryThreadRowSchema,
  selectedThreadIdsSchema,
  settledThreadRowSchema,
  storedProjectColorSchema,
  threadIdSchema,
  truncatedSchema,
} from "../lib/schemas/sidebar.ts";
import {
  MAX_BATCH_WORKTREES,
  batchRemoveWorktreesResultSchema,
  batchWorktreeSurveyItemSchema,
  repoFactsSchema,
  workspaceEnvironmentDescriptorSchema,
  workspaceProjectDescriptorSchema,
  workspaceRemovalOutcomeSchema,
  worktreeRemovalPlanSchema,
  worktreeSurveySchema,
} from "../lib/schemas/workspace.ts";

export const harborRpcContract = defineRpcContract({
  listProjectColors: {
    input: z.object({}),
    output: z.object({
      colors: z
        .array(storedProjectColorSchema)
        .max(MAX_PROJECT_COLOR_ROWS)
        .readonly(),
    }),
  },
  setProjectColor: {
    input: z.object({ projectId: projectIdSchema, color: projectColorSchema }),
    output: storedProjectColorSchema,
  },
  resetProjectColor: {
    input: z.object({ projectId: projectIdSchema }),
    output: z.object({ projectId: projectIdSchema, reset: z.boolean() }),
  },
  listProjectIcons: {
    input: z.object({}),
    output: z.object({
      icons: z
        .array(projectIconEntrySchema)
        .max(MAX_PROJECT_ICON_ROWS)
        .readonly(),
    }),
  },
  detectProjectIcon: {
    input: z.object({ projectId: projectIdSchema }),
    output: projectIconEntrySchema,
  },
  listGroups: {
    input: z.object({}),
    output: z.object({
      groups: z.array(projectGroupSchema).readonly(),
      assignment: z.record(z.string(), z.string()),
    }),
    tags: () => ["groups"],
  },
  getAppearance: {
    input: z.object({}),
    output: appearanceSchema,
    tags: () => ["appearance"],
  },
  setAppearance: {
    input: appearancePatchSchema,
    output: appearanceSchema,
  },
  previewNestMigration: {
    input: z.object({}),
    output: nestMigrationPreviewSchema,
    tags: () => ["nestMigration"],
  },
  applyNestMigration: {
    input: nestMigrationApplyInputSchema,
    output: nestMigrationApplyResultSchema,
  },
  dismissNestMigrationTip: {
    input: z.object({}),
    output: z.object({ ok: z.boolean() }),
  },
  listWorkspacePaths: {
    input: z.object({}),
    output: z.object({
      truncated: truncatedSchema,
      environments: z.record(z.string(), workspaceEnvironmentDescriptorSchema),
      projects: z.record(z.string(), workspaceProjectDescriptorSchema),
    }),
  },
  listRepoFacts: {
    input: z.object({}),
    output: repoFactsSchema.extend({ truncated: truncatedSchema }),
  },
  inspectWorktree: {
    input: z.object({ environmentId: z.string().trim().min(1) }),
    output: z.object({
      survey: worktreeSurveySchema,
      plan: worktreeRemovalPlanSchema,
      digest: z.string(),
    }),
  },
  removeWorktree: {
    input: z.object({
      environmentId: z.string().trim().min(1),
      deleteDirectory: z.boolean(),
      acknowledged: z.boolean(),
      expectedDigest: z.string().min(1).nullable(),
    }),
    output: workspaceRemovalOutcomeSchema,
  },
  batchSurveyWorktrees: {
    input: z.object({
      environmentIds: z.array(z.string().trim().min(1)).max(MAX_BATCH_WORKTREES),
    }),
    output: z.object({
      items: z.array(batchWorktreeSurveyItemSchema),
    }),
  },
  batchRemoveWorktrees: {
    input: z.object({
      environmentIds: z.array(z.string().trim().min(1)).max(MAX_BATCH_WORKTREES),
      deleteDirectory: z.boolean(),
      force: z.boolean().default(false),
    }),
    output: batchRemoveWorktreesResultSchema,
  },
  createGroup: {
    input: z.object({
      name: z.string().trim().min(1).max(MAX_GROUP_NAME_LENGTH),
      icon: groupIconSchema.default(DEFAULT_GROUP_ICON),
    }),
    output: projectGroupSchema,
  },
  renameGroup: {
    input: z.object({
      groupId: z.string().trim().min(1),
      name: z.string().trim().min(1).max(MAX_GROUP_NAME_LENGTH),
      icon: groupIconSchema.optional(),
    }),
    output: z.object({ ok: z.boolean() }),
  },
  deleteGroup: {
    input: z.object({ groupId: z.string().trim().min(1) }),
    output: z.object({ ok: z.boolean() }),
  },
  assignProjectToGroup: {
    input: z.object({
      projectId: projectIdSchema,
      groupId: z.string().trim().min(1).nullable(),
    }),
    output: z.object({ ok: z.boolean() }),
  },
  listFeatures: {
    input: z.object({}),
    output: z.object({
      features: z.array(featureSchema).readonly(),
      members: z.array(featureMemberSchema).readonly(),
      refLinks: z.array(featureRefLinkSchema).readonly(),
      adoptions: z.record(z.string(), z.string()),
      homeProjects: z.record(z.string(), z.string()),
      featureProjectIds: z.array(z.string()).readonly(),
      meta: z.record(z.string(), featureMetaSummarySchema),
    }),
    tags: () => ["features"],
  },
  createFeature: {
    input: z.object({
      name: featureNameSchema,
      slug: z.string().trim().nullable(),
      baseBranch: z.string().trim().min(1).max(200).nullable().optional(),
      repositories: z
        .array(
          z.object({
            projectId: projectIdSchema,
            branch: z.string().trim().min(1).max(200).nullable(),
            role: featureRepoRoleSchema.optional(),
            baseBranch: z.string().trim().min(1).max(200).nullable().optional(),
          }),
        )
        .max(20),
    }),
    output: z.object({
      feature: featureSchema,
      repositories: z.array(repositoryResultSchema).readonly(),
    }),
  },
  renameFeature: {
    input: z.object({ featureId: featureIdSchema, name: featureNameSchema }),
    output: z.object({ ok: z.boolean() }),
  },
  adoptWorkspace: {
    input: z.object({
      environmentId: z.string().trim().min(1),
      featureId: featureIdSchema.nullable(),
    }),
    output: z.object({ ok: z.boolean() }),
  },
  planFeatureRepositories: {
    input: z.object({
      featureId: featureIdSchema,
      repositories: z
        .array(
          z.object({
            projectId: projectIdSchema,
            branch: z.string().nullable(),
            role: featureRepoRoleSchema.optional(),
            baseBranch: z.string().trim().min(1).max(200).nullable().optional(),
          }),
        )
        .max(20),
    }),
    output: z.object({
      plans: z
        .array(
          z.object({
            projectId: z.string(),
            repository: z.string(),
            branch: z.string(),
            path: z.string(),
            outcome: z.enum(["create", "reuse", "blocked"]),
            newBranch: z.boolean(),
            base: z.string().nullable(),
            reason: z.string().nullable(),
            role: featureRepoRoleSchema.optional(),
          }),
        )
        .readonly(),
    }),
  },
  addFeatureRepositories: {
    input: z.object({
      featureId: featureIdSchema,
      baseBranch: z.string().trim().min(1).max(200).nullable().optional(),
      repositories: z
        .array(
          z.object({
            projectId: projectIdSchema,
            branch: z.string().nullable(),
            role: featureRepoRoleSchema.optional(),
            baseBranch: z.string().trim().min(1).max(200).nullable().optional(),
          }),
        )
        .min(1)
        .max(20),
    }),
    output: z.object({
      results: z.array(repositoryResultSchema).readonly(),
    }),
  },
  renameFeatureMemberBranch: {
    input: z.object({
      featureId: featureIdSchema,
      directory: z.string().min(1),
      branch: z.string().trim().min(1).max(200),
    }),
    output: z.object({
      ok: z.boolean(),
      reason: z.string().nullable(),
    }),
  },
  removeFeatureRepository: {
    input: z.object({
      featureId: featureIdSchema,
      directory: z.string().min(1),
      force: z.boolean(),
    }),
    output: z.object({ removed: z.boolean() }),
  },
  inspectFeatureRemoval: {
    input: z.object({ featureId: featureIdSchema, deletesBranches: z.boolean() }),
    output: z.object({
      featureName: z.string(),
      rootPath: z.string().nullable(),
      repositories: z.array(z.string()),
      threadCount: z.number(),
      createdBranches: z.number(),
      warnings: z.array(z.string()),
      requiresConfirmation: z.boolean(),
    }),
  },
  finishFeature: {
    input: z.object({
      featureId: featureIdSchema,
      acknowledged: z.boolean(),
      syncDecisionsToRepos: z.boolean().optional(),
    }),
    output: z.object({
      archivedThreads: z.number(),
      removedWorktrees: z.number(),
      leftovers: z.array(z.string()).readonly(),
    }),
  },
  reopenFeature: {
    input: z.object({ featureId: featureIdSchema }),
    output: z.object({ ok: z.boolean() }),
  },
  deleteFeature: {
    input: z.object({
      featureId: featureIdSchema,
      acknowledged: z.boolean(),
      deleteBranches: z.boolean(),
    }),
    output: z.object({
      archivedThreads: z.number(),
      removedWorktrees: z.number(),
      leftovers: z.array(z.string()).readonly(),
      deletedBranches: z.number(),
      removedFolder: z.boolean(),
    }),
  },
  getFeatureMeta: {
    input: z.object({ featureId: featureIdSchema }),
    output: featureMetaSchema,
    tags: (input) => ["features", `feature:${input.featureId}`],
  },
  updateFeatureBrief: {
    input: z.object({ featureId: featureIdSchema, brief: featureBriefInputSchema }),
    output: z.object({ brief: featureBriefSchema }),
  },
  addFeatureRef: {
    input: z.object({ featureId: featureIdSchema, ref: featureRefInputSchema }),
    output: z.object({ ref: featureRefSchema }),
  },
  removeFeatureRef: {
    input: z.object({ featureId: featureIdSchema, refId: z.string().min(1) }),
    output: z.object({ ok: z.boolean() }),
  },
  addFeatureDecision: {
    input: featureDecisionInputSchema,
    output: z.object({ decision: featureDecisionSchema }),
  },
  confirmFeatureDecision: {
    input: z.object({
      featureId: featureIdSchema,
      decisionId: z.string().min(1),
    }),
    output: z.object({ decision: featureDecisionSchema }),
  },
  deleteFeatureDecisionDraft: {
    input: z.object({
      featureId: featureIdSchema,
      decisionId: z.string().min(1),
    }),
    output: z.object({ ok: z.boolean() }),
  },
  reorderGroups: {
    input: z.object({
      groupIds: z.array(z.string().trim().min(1)).max(MAX_GROUPS),
    }),
    output: z.object({ ok: z.boolean() }),
  },
  listManualOrder: {
    input: z.object({}),
    output: z.object({
      projects: orderMapSchema,
      families: orderMapSchema,
      workspaces: orderMapSchema,
      revision: z.number().int().nonnegative(),
    }),
    tags: () => ["order"],
  },
  reorderProjects: {
    input: z.object({
      groupId: orderScopeIdSchema,
      projectIds: orderItemsSchema,
      baseRevision: z.number().int().nonnegative(),
    }),
    output: orderWriteSchema,
  },
  reorderFamilies: {
    input: z.object({
      projectId: orderScopeIdSchema,
      rootIds: orderItemsSchema,
      baseRevision: z.number().int().nonnegative(),
    }),
    output: orderWriteSchema,
  },
  reorderWorkspaces: {
    input: z.object({
      projectId: orderScopeIdSchema,
      workspaceKeys: orderItemsSchema,
      baseRevision: z.number().int().nonnegative(),
    }),
    output: orderWriteSchema,
  },
  getViewPreferences: {
    input: z.object({}),
    output: z.object({
      projectSort: projectSortSchema,
      threadSort: threadSortSchema,
      worktreeSort: worktreeSortSchema,
      organizationMode: organizationModeSchema,
      sidebarMode: sidebarModeSchema,
      scopeStrip: scopeStripModeSchema,
    }),
    tags: () => ["prefs"],
  },
  setViewPreferences: {
    input: z.object({
      projectSort: projectSortSchema.optional(),
      threadSort: threadSortSchema.optional(),
      worktreeSort: worktreeSortSchema.optional(),
      organizationMode: organizationModeSchema.optional(),
      sidebarMode: sidebarModeSchema.optional(),
      scopeStrip: scopeStripModeSchema.optional(),
    }),
    output: z.object({
      projectSort: projectSortSchema,
      threadSort: threadSortSchema,
      worktreeSort: worktreeSortSchema,
      organizationMode: organizationModeSchema,
      sidebarMode: sidebarModeSchema,
      scopeStrip: scopeStripModeSchema,
    }),
  },
  renameProject: {
    input: z.object({
      projectId: projectIdSchema,
      name: z.string().trim().min(1),
    }),
    output: z.object({ name: z.string() }),
  },
  renameEnvironment: {
    input: z.object({
      environmentId: z.string().trim().min(1),
      name: z.string().trim().min(1).max(120),
    }),
    output: z.object({ name: z.string().nullable() }),
  },
  removeProject: {
    input: z.object({
      projectId: projectIdSchema,
      expectedName: z.string().trim().min(1),
    }),
    output: z.object({ ok: z.boolean() }),
  },
  spawnThread: {
    input: z.object({ request: z.record(z.string(), z.unknown()) }),
    output: z.object({ threadId: z.string().nullable() }),
  },
  listProviders: {
    input: z.object({}),
    output: z.object({
      providers: z.array(providerSchema).readonly(),
    }),
  },
  listLifecycle: {
    input: z.object({}),
    output: z.object({
      rows: z.array(lifecycleRowSchema).readonly(),
    }),
    tags: () => ["lifecycle"],
  },
  listSettledThreads: {
    input: z.object({}),
    output: z.object({
      truncated: truncatedSchema,
      threads: z.array(settledThreadRowSchema).readonly(),
    }),
  },
  listThreadsForRecovery: {
    input: z.object({}),
    output: z.object({
      truncated: truncatedSchema,
      threads: z.array(recoveryThreadRowSchema).readonly(),
      projects: z
        .array(
          z.object({
            id: z.string(),
            name: z.string(),
            isPersonal: z.boolean(),
          }),
        )
        .readonly(),
    }),
  },
  listProjectArchivedThreads: {
    input: z.object({
      projectId: z.string().trim().min(1),
      ownershipMode: z.enum(["claimed", "filesystem"]).default("claimed"),
      projectIds: z.array(z.string().trim().min(1)).max(32).optional(),
      environmentIds: z.array(z.string().trim().min(1)).max(500).optional(),
      limit: z.number().int().positive().max(MAX_ARCHIVED_SHELF_ROWS),
    }),
    output: z.object({
      truncated: truncatedSchema,
      threads: z.array(recoveryThreadRowSchema).readonly(),
    }),
  },
  listPinnedOrder: {
    input: z.object({}),
    output: z.object({
      threadIds: z.array(z.string()).readonly(),
      truncated: z.boolean().optional(),
    }),
  },
  reorderPinned: {
    input: z.object({
      threadId: z.string().trim().min(1),
      previousThreadId: z.string().trim().min(1).nullable(),
      nextThreadId: z.string().trim().min(1).nullable(),
    }),
    output: z.object({ ok: z.boolean() }),
  },
  previewBulkDelete: {
    input: z.object({
      threadIds: selectedThreadIdsSchema,
      protectedThreadId: z.string().trim().min(1).nullable(),
    }),
    output: z.object({
      token: z.string().nullable(),
      expiresAt: z.number().int().positive().nullable(),
      included: z.array(bulkDeleteIncludedRootSchema),
      skipped: z.array(bulkDeleteSkippedRootSchema),
      rootCount: z.number().int().nonnegative(),
      childCount: z.number().int().nonnegative(),
      totalThreadCount: z.number().int().nonnegative(),
    }),
  },
  confirmBulkDelete: {
    input: z.object({ token: z.string().trim().min(1).max(200) }),
    output: z.object({
      deleted: z.array(z.string()),
      skipped: z.array(bulkDeleteSkippedRootSchema),
      failed: z.array(bulkDeleteFailedRootSchema),
    }),
  },
  settle: {
    input: threadIdSchema,
    output: z.object({ ok: z.boolean(), archived: z.boolean() }),
  },
  unsettle: {
    input: threadIdSchema,
    output: z.object({ ok: z.boolean(), message: z.string().nullable() }),
  },
  snooze: {
    input: z.object({
      threadId: z.string().trim().min(1),
      snoozedUntil: z.number().int().positive(),
    }),
    output: z.object({ ok: z.boolean(), message: z.string().nullable() }),
  },
  unsnooze: { input: threadIdSchema, output: z.object({ ok: z.boolean() }) },
  parkFeature: {
    input: z.object({
      featureId: featureIdSchema,
      reason: z.string().trim().max(MAX_PARK_REASON_LENGTH).nullable().optional(),
      note: z.string().trim().max(MAX_PARK_NOTE_LENGTH).nullable().optional(),
      wakeAt: z.number().int().positive().nullable().optional(),
      wakeOnActivity: z.boolean().optional(),
    }),
    output: z.object({ feature: featureSchema }),
  },
  unparkFeature: {
    input: z.object({ featureId: featureIdSchema }),
    output: z.object({ feature: featureSchema }),
  },
  promoteToFeature: {
    input: z.object({
      environmentId: z.string().trim().min(1),
      name: featureNameSchema,
      slug: z.string().trim().nullable().optional(),
      baseBranch: z.string().trim().min(1).max(200).nullable().optional(),
      additionalRepositories: z.array(repoSpecInputSchema).max(20).optional(),
    }),
    output: z.object({
      feature: featureSchema,
      adoptedEnvironmentId: z.string(),
      repositories: z.array(repositoryResultSchema).readonly(),
    }),
  },
  addFeatureReferenceRepo: {
    input: z.object({
      featureId: featureIdSchema,
      projectId: projectIdSchema,
    }),
    output: z.object({ result: repositoryResultSchema }),
  },
  removeFeatureReferenceRepo: {
    input: z.object({
      featureId: featureIdSchema,
      directory: z.string().trim().min(1),
    }),
    output: z.object({ removed: z.boolean() }),
  },
  listFeaturePresets: {
    input: z.object({}),
    output: z.object({
      presets: z.array(featurePresetSchema).max(MAX_PRESETS).readonly(),
    }),
    tags: () => ["feature-presets"],
  },
  saveFeaturePreset: {
    input: z.object({
      id: z.string().trim().min(1).nullable().optional(),
      name: z.string().trim().min(1).max(MAX_PRESET_NAME_LENGTH),
      baseBranch: z.string().trim().min(1).max(200).nullable().optional(),
      repos: z.array(featurePresetRepoSchema).max(MAX_PRESET_REPOS),
    }),
    output: z.object({ preset: featurePresetSchema }),
  },
  deleteFeaturePreset: {
    input: z.object({ id: z.string().trim().min(1) }),
    output: z.object({ removed: z.boolean() }),
  },
  importCodeWorkspace: {
    input: z.object({
      hostId: z.string().trim().min(1),
      filePath: z.string().trim().min(1),
    }),
    output: z.object({
      name: z.string(),
      matched: z
        .array(
          z.object({
            projectId: z.string(),
            projectName: z.string(),
            path: z.string(),
            name: z.string().nullable(),
          }),
        )
        .readonly(),
      unmatchedPaths: z.array(z.string()).readonly(),
    }),
  },
  getFeatureGitStatus: {
    input: z.object({
      featureId: featureIdSchema,
      baseBranch: z.string().trim().min(1).max(200).nullable().optional(),
    }),
    output: featureGitSummarySchema,
    tags: (input) => ["features", `feature-git:${input.featureId}`],
  },
  readFeatureRepoDiff: {
    input: z.object({
      featureId: featureIdSchema,
      directory: z.string().trim().min(1),
      filePath: z.string().trim().min(1).nullable().optional(),
      includeUntracked: z.boolean().optional(),
    }),
    output: z.object({
      directory: z.string(),
      repository: z.string(),
      branch: z.string().nullable(),
      files: z.array(diffFileEntrySchema).readonly(),
    }),
    tags: (input) => [`feature-git:${input.featureId}`],
  },
  pushFeatureRepo: {
    input: z.object({
      featureId: featureIdSchema,
      directory: z.string().trim().min(1),
    }),
    output: z.object({
      status: z.literal("pushed"),
      branch: z.string().nullable(),
    }),
  },
  inspectFeatureHealth: {
    input: z.object({
      featureId: featureIdSchema,
      deletesBranches: z.boolean(),
    }),
    output: featureHealthReportSchema,
    tags: (input) => ["features", `feature-git:${input.featureId}`],
  },
  activateOrphanWorktree: {
    input: z.object({
      hostId: z.string().trim().min(1),
      projectId: projectIdSchema,
      path: z.string().trim().min(1),
      branch: z.string().trim().min(1).nullable().optional(),
      prompt: z.string().trim().max(4000).optional(),
      title: z.string().trim().max(120).optional(),
    }),
    output: z.object({
      environmentId: z.string().nullable(),
      threadId: z.string().nullable(),
    }),
  },
  batchSettleIdleThreads: {
    input: z.object({
      threadIds: z.array(z.string().trim().min(1)).min(1).max(100),
    }),
    output: z.object({
      settled: z.array(z.string()),
      failed: z.array(z.object({ threadId: z.string(), message: z.string() })),
    }),
  },
  getAgentAccess: {
    input: z.object({}),
    output: z.object({ tier: agentAccessTierSchema }),
    tags: () => ["agentAccess"],
  },
  setAgentAccess: {
    input: z.object({ tier: agentAccessTierSchema }),
    output: z.object({ tier: agentAccessTierSchema }),
  },
});

/** Slice of the Harbor RPC contract implemented by a server/rpc module. */
export type HarborRpcHandlers<Method extends keyof typeof harborRpcContract> = Pick<
  PluginRpcHandlers<typeof harborRpcContract>,
  Method
>;
