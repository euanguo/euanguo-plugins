/**
 * Consolidated Feature and Feature Cockpit RPC handlers: lifecycle CRUD,
 * metadata/decisions, parking, presets, multi-repo git cockpit, and quick actions.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { featureNameIntent, normalizeFeaturePath } from "../../lib/domain/features.ts";
import type { FeaturePresetStore } from "../../lib/stores/feature-preset-store.ts";
import type { HarborRpcHandlers } from "../contract.ts";
import type { FeatureService } from "../feature/service.ts";
import type { createLifecycleService } from "../lifecycle-service.ts";

type FeatureRpcMethod =
  | "listFeatures"
  | "createFeature"
  | "renameFeature"
  | "adoptWorkspace"
  | "planFeatureRepositories"
  | "addFeatureRepositories"
  | "renameFeatureMemberBranch"
  | "removeFeatureRepository"
  | "inspectFeatureRemoval"
  | "finishFeature"
  | "reopenFeature"
  | "deleteFeature"
  | "getFeatureMeta"
  | "updateFeatureBrief"
  | "addFeatureRef"
  | "removeFeatureRef"
  | "addFeatureDecision"
  | "confirmFeatureDecision"
  | "deleteFeatureDecisionDraft"
  | "parkFeature"
  | "unparkFeature"
  | "promoteToFeature"
  | "addFeatureReferenceRepo"
  | "removeFeatureReferenceRepo"
  | "listFeaturePresets"
  | "saveFeaturePreset"
  | "deleteFeaturePreset"
  | "importCodeWorkspace"
  | "getFeatureGitStatus"
  | "readFeatureRepoDiff"
  | "pushFeatureRepo"
  | "inspectFeatureHealth"
  | "activateOrphanWorktree"
  | "batchSettleIdleThreads";

export function featureHandlers(deps: {
  readonly bb: BbPluginApi;
  readonly service: FeatureService;
  readonly presets: FeaturePresetStore;
  readonly lifecycle: ReturnType<typeof createLifecycleService>;
}): HarborRpcHandlers<FeatureRpcMethod> {
  const { bb, service, presets, lifecycle } = deps;

  return {
    async listFeatures() {
      const snapshot = await service.refresh();
      return {
        features: snapshot.features,
        members: snapshot.members,
        refLinks: snapshot.refLinks,
        adoptions: snapshot.adoptions,
        homeProjects: snapshot.homeProjects,
        featureProjectIds: snapshot.featureProjectIds,
        meta: snapshot.meta,
      };
    },

    async createFeature({ name, slug, baseBranch, repositories }) {
      const stored = featureNameIntent(name);
      if (stored === null) throw new Error("A feature needs a name of up to 60 characters.");
      const created = await service.create({
        name: stored,
        slug,
        baseBranch: baseBranch ?? null,
        repositories: repositories.map((repo) => ({
          projectId: repo.projectId,
          branch: repo.branch,
          ...(repo.role === undefined ? {} : { role: repo.role }),
          baseBranch: repo.baseBranch ?? null,
        })),
      });
      return { feature: created.feature, repositories: created.repositories };
    },

    async renameFeature({ featureId, name }) {
      const stored = featureNameIntent(name);
      if (stored === null) return { ok: false };
      return { ok: await service.rename(featureId, stored) };
    },

    async adoptWorkspace({ environmentId, featureId }) {
      return { ok: service.adopt(environmentId, featureId) };
    },

    async planFeatureRepositories({ featureId, repositories }) {
      const plans = await Promise.all(
        repositories.map((repository) =>
          service.plan({ featureId, ...repository }),
        ),
      );
      return {
        plans: plans.map((plan) => ({
          projectId: plan.projectId,
          repository: plan.repository,
          branch: plan.branch,
          path: plan.path,
          outcome: plan.outcome,
          newBranch: plan.newBranch,
          base: plan.base,
          reason: plan.reason,
          ...(plan.role === undefined ? {} : { role: plan.role }),
        })),
      };
    },

    async addFeatureRepositories({ featureId, baseBranch, repositories }) {
      return {
        results: await service.addRepositories({
          featureId,
          baseBranch: baseBranch ?? null,
          repositories,
        }),
      };
    },

    async renameFeatureMemberBranch({ featureId, directory, branch }) {
      return service.renameMemberBranch({ featureId, directory, branch });
    },

    async removeFeatureRepository({ featureId, directory, force }) {
      return service.removeRepository({ featureId, directory, force });
    },

    async inspectFeatureRemoval({ featureId, deletesBranches }) {
      const surveyed = await service.survey(featureId, { deletesBranches });
      return {
        featureName: surveyed.feature.name,
        rootPath: surveyed.feature.rootPath,
        repositories: surveyed.members.map((member) => member.directory),
        threadCount: surveyed.threadCount,
        createdBranches: service.createdBranchCount(featureId),
        warnings: surveyed.warnings,
        requiresConfirmation: surveyed.requiresConfirmation,
      };
    },

    async finishFeature({ featureId, acknowledged }) {
      return service.finish(featureId, acknowledged);
    },

    async reopenFeature({ featureId }) {
      await service.reopen(featureId);
      return { ok: true };
    },

    async deleteFeature({ featureId, acknowledged, deleteBranches }) {
      return service.remove({ featureId, acknowledged, deleteBranches });
    },

    async getFeatureMeta({ featureId }) {
      return service.meta(featureId);
    },

    async updateFeatureBrief({ featureId, brief }) {
      return { brief: await service.setBrief(featureId, brief) };
    },

    async addFeatureRef({ featureId, ref }) {
      return { ref: await service.addRef(featureId, ref) };
    },

    async removeFeatureRef({ featureId, refId }) {
      return { ok: await service.removeRef(featureId, refId) };
    },

    async addFeatureDecision(input) {
      const decision = await service.addDecision({
        ...input,
        alternatives: input.alternatives,
        status: "confirmed",
        author: "human",
      });
      return { decision };
    },

    async confirmFeatureDecision({ featureId, decisionId }) {
      const ok = await service.confirmDecision(featureId, decisionId);
      const decision = service
        .meta(featureId)
        .decisions.find((entry) => entry.id === decisionId);
      if (!ok || decision === undefined) {
        throw new Error("That draft could not be confirmed; it may no longer be a draft.");
      }
      return { decision };
    },

    async deleteFeatureDecisionDraft({ featureId, decisionId }) {
      return { ok: await service.removeDraft(featureId, decisionId) };
    },

    async parkFeature({ featureId, reason, note, wakeAt, wakeOnActivity }) {
      return {
        feature: await service.park({
          featureId,
          reason: reason ?? null,
          note: note ?? null,
          wakeAt: wakeAt ?? null,
          wakeOnActivity: wakeOnActivity ?? false,
        }),
      };
    },

    async unparkFeature({ featureId }) {
      return { feature: await service.unpark(featureId) };
    },

    async promoteToFeature({
      environmentId,
      name,
      slug,
      baseBranch,
      additionalRepositories,
    }) {
      const result = await service.promoteToFeature({
        environmentId,
        name,
        slug: slug ?? null,
        baseBranch: baseBranch ?? null,
        additionalRepositories: additionalRepositories?.map((repo) => ({
          projectId: repo.projectId,
          branch: repo.branch ?? null,
          ...(repo.role === undefined ? {} : { role: repo.role }),
          baseBranch: repo.baseBranch ?? null,
        })),
      });
      return {
        feature: result.feature,
        adoptedEnvironmentId: result.adoptedEnvironmentId,
        repositories: result.repositories,
      };
    },

    async addFeatureReferenceRepo({ featureId, projectId }) {
      return { result: await service.addReferenceRepo({ featureId, projectId }) };
    },

    async removeFeatureReferenceRepo({ featureId, directory }) {
      return service.removeReferenceRepo({ featureId, directory });
    },

    async listFeaturePresets() {
      return { presets: presets.list() };
    },

    async saveFeaturePreset({ id, name, baseBranch, repos }) {
      const saved = presets.save({
        id: id ?? null,
        name,
        baseBranch: baseBranch ?? null,
        repos,
      });
      if (saved === null) {
        throw new Error("Could not save feature preset.");
      }
      bb.rpc?.experimental_invalidate?.(["feature-presets"]);
      return { preset: saved };
    },

    async deleteFeaturePreset({ id }) {
      const removed = presets.remove(id);
      if (removed) {
        bb.rpc?.experimental_invalidate?.(["feature-presets"]);
      }
      return { removed };
    },

    async importCodeWorkspace({ hostId, filePath }) {
      return service.importCodeWorkspace({ hostId, filePath });
    },

    async getFeatureGitStatus({ featureId, baseBranch }) {
      return service.getFeatureGitStatus(featureId, baseBranch ?? null);
    },

    async readFeatureRepoDiff({ featureId, directory, filePath, includeUntracked }) {
      return service.readFeatureRepoDiff({
        featureId,
        directory,
        filePath: filePath ?? null,
        includeUntracked: includeUntracked ?? true,
      });
    },

    async pushFeatureRepo({ featureId, directory }) {
      return service.pushFeatureRepo({ featureId, directory });
    },

    async inspectFeatureHealth({ featureId, deletesBranches }) {
      return service.inspectFeatureHealth({
        featureId,
        deletesBranches,
      });
    },

    async activateOrphanWorktree({ hostId, projectId, path, prompt, title }) {
      const normalizedTarget = normalizeFeaturePath(path);
      const environments = await bb.sdk.environments
        .list({ hostId, limit: 1_000 })
        .catch(() => []);
      const existingEnv = environments.find(
        (candidate) =>
          typeof candidate.path === "string" &&
          normalizeFeaturePath(candidate.path) === normalizedTarget,
      );

      if (existingEnv !== undefined && (!prompt || prompt.trim().length === 0)) {
        const threads = await bb.sdk.threads
          .list({ environmentId: existingEnv.id, archived: false })
          .catch(() => []);
        if (threads[0] !== undefined) {
          return { environmentId: existingEnv.id, threadId: threads[0].id };
        }
      }

      const launchedPrompt =
        prompt?.trim() || `Review workspace at ${normalizedTarget}`;
      const spawned = await bb.sdk.threads.spawn({
        projectId,
        prompt: launchedPrompt,
        origin: "plugin",
        ...(title?.trim() ? { title: title.trim() } : {}),
        environment:
          existingEnv !== undefined
            ? { type: "reuse", environmentId: existingEnv.id }
            : {
                type: "host",
                hostId,
                workspace: { type: "unmanaged", path: normalizedTarget },
              },
      } as Parameters<typeof bb.sdk.threads.spawn>[0]);
      const spawnedEnvId =
        existingEnv?.id ??
        ("environmentId" in spawned && typeof spawned.environmentId === "string"
          ? spawned.environmentId
          : null);
      return {
        environmentId: spawnedEnvId,
        threadId: spawned.id ?? null,
      };
    },

    async batchSettleIdleThreads({ threadIds }) {
      const settled: string[] = [];
      const failed: { threadId: string; message: string }[] = [];
      for (const threadId of threadIds) {
        try {
          const outcome = await lifecycle.settleThread(threadId);
          if (outcome.ok) {
            settled.push(threadId);
          } else {
            failed.push({ threadId, message: "Could not settle thread." });
          }
        } catch (error) {
          failed.push({
            threadId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      bb.rpc?.experimental_invalidate?.(["lifecycle"]);
      return { settled, failed };
    },
  };
}
