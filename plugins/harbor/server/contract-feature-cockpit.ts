/**
 * Harbor Feature Cockpit RPC schemas: Park/Wake, Promotion, Reference repos,
 * Presets & `.code-workspace`, Multi-Repo Git Cockpit, Health, and Quick actions.
 */
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

import {
  MAX_PRESET_NAME_LENGTH,
  MAX_PRESET_REPOS,
  MAX_PRESETS,
} from "../lib/domain/feature-presets.ts";
import {
  MAX_PARK_NOTE_LENGTH,
  MAX_PARK_REASON_LENGTH,
} from "../lib/domain/features.ts";
import {
  cockpitRepoRoleSchema,
  featureIdSchema,
  featureNameSchema,
  featureSchema,
  projectIdSchema,
  repositoryResultSchema,
} from "./contract-schemas.ts";

export const repoSubmoduleStatusSchema = z.object({
  path: z.string(),
  name: z.string(),
  dirty: z.boolean(),
  commit: z.string().nullable(),
});

export const featureRepoGitStatusSchema = z.object({
  directory: z.string(),
  repository: z.string(),
  role: cockpitRepoRoleSchema,
  path: z.string(),
  branch: z.string().nullable(),
  upstream: z.string().nullable(),
  exists: z.boolean(),
  stagedFiles: z.number(),
  unstagedFiles: z.number(),
  untrackedFiles: z.number(),
  changedFiles: z.number(),
  additions: z.number(),
  deletions: z.number(),
  aheadCommits: z.number().nullable(),
  behindCommits: z.number().nullable(),
  clean: z.boolean(),
  statusError: z.string().nullable().optional(),
  lastCommitSubject: z.string().nullable(),
  submodules: z.array(repoSubmoduleStatusSchema),
});

export const featureGitSummarySchema = z.object({
  featureId: z.string(),
  additions: z.number(),
  deletions: z.number(),
  dirtyRepoCount: z.number(),
  behindRepoCount: z.number(),
  unpushedRepoCount: z.number(),
  repos: z.array(featureRepoGitStatusSchema),
});

export const diffFileEntrySchema = z.object({
  filePath: z.string(),
  status: z.enum(["modified", "added", "deleted", "renamed", "untracked"]),
  staged: z.boolean(),
  additions: z.number(),
  deletions: z.number(),
  patch: z.string(),
  truncated: z.boolean(),
});

export const featureHealthRepoSchema = z.object({
  directory: z.string(),
  repository: z.string(),
  role: cockpitRepoRoleSchema,
  path: z.string(),
  branch: z.string().nullable(),
  clean: z.boolean(),
  changedFiles: z.number(),
  untrackedFiles: z.number(),
  aheadCommits: z.number().nullable(),
  behindCommits: z.number().nullable(),
  additions: z.number(),
  deletions: z.number(),
  blockerReason: z.string().nullable(),
});

export const featureHealthReportSchema = z.object({
  featureId: z.string(),
  featureName: z.string(),
  rootPath: z.string().nullable(),
  repos: z.array(featureHealthRepoSchema),
  blockedCount: z.number(),
  threadCount: z.number(),
  createdBranches: z.number(),
  canDeleteBranches: z.boolean(),
  warnings: z.array(z.string()),
});

export const featurePresetRepoSchema = z.object({
  projectId: projectIdSchema,
  role: z.enum(["worktree", "ref"]),
  branchTemplate: z.string().trim().min(1).max(200).nullable(),
});

export const featurePresetSchema = z.object({
  id: z.string(),
  name: z.string(),
  baseBranch: z.string().nullable(),
  repos: z.array(featurePresetRepoSchema),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const repoSpecInputSchema = z.object({
  projectId: projectIdSchema,
  branch: z.string().trim().min(1).max(200).nullable().optional(),
  role: z.enum(["worktree", "ref"]).optional(),
  baseBranch: z.string().trim().min(1).max(200).nullable().optional(),
});

export const featureCockpitContract = defineRpcContract({
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
      repositories: z.array(repositoryResultSchema),
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
    output: z.object({ presets: z.array(featurePresetSchema).max(MAX_PRESETS) }),
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
      matched: z.array(
        z.object({
          projectId: z.string(),
          projectName: z.string(),
          path: z.string(),
          name: z.string().nullable(),
        }),
      ),
      unmatchedPaths: z.array(z.string()),
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
      files: z.array(diffFileEntrySchema),
    }),
    tags: (input) => [`feature-git:${input.featureId}`],
  },
  commitFeatureRepo: {
    input: z.object({
      featureId: featureIdSchema,
      directory: z.string().trim().min(1),
      message: z.string().trim().min(1).max(2000),
      files: z.array(z.string().trim().min(1)).max(500).nullable().optional(),
      push: z.boolean().optional(),
    }),
    output: z.object({
      status: z.literal("committed"),
      sha: z.string().nullable(),
      branch: z.string().nullable(),
      pushed: z.boolean(),
      pushError: z.string().nullable(),
    }),
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
  suggestFeatureCommitMessage: {
    input: z.object({
      featureId: featureIdSchema,
      directory: z.string().trim().min(1),
    }),
    output: z.object({ message: z.string() }),
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
});
