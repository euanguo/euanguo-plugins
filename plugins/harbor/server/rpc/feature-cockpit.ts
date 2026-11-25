/**
 * Harbor Feature Cockpit RPC handlers: Park/Wake, Promotion, Reference links,
 * Presets & `.code-workspace`, Multi-Repo Git Cockpit, Health, and Quick actions.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { normalizeFeaturePath } from "../../lib/domain/features.ts";
import type { FeaturePresetStore } from "../../lib/stores/feature-preset-store.ts";
import type { HarborRpcHandlers } from "../contract.ts";
import type { featureCockpitContract } from "../contract-feature-cockpit.ts";
import type { FeatureService } from "../feature/service.ts";
import type { createLifecycleService } from "../lifecycle-service.ts";

export function featureCockpitHandlers(deps: {
  readonly bb: BbPluginApi;
  readonly service: FeatureService;
  readonly presets: FeaturePresetStore;
  readonly lifecycle: ReturnType<typeof createLifecycleService>;
}): HarborRpcHandlers<keyof typeof featureCockpitContract> {
  const { bb, service, presets, lifecycle } = deps;

  return {
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
        repositories: [...result.repositories],
      };
    },

    async addFeatureReferenceRepo({ featureId, projectId }) {
      return { result: await service.addReferenceRepo({ featureId, projectId }) };
    },

    async removeFeatureReferenceRepo({ featureId, directory }) {
      return service.removeReferenceRepo({ featureId, directory });
    },

    async listFeaturePresets() {
      return {
        presets: presets.list().map((preset) => ({
          ...preset,
          repos: [...preset.repos],
        })),
      };
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
      return {
        preset: {
          ...saved,
          repos: [...saved.repos],
        },
      };
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
      const summary = await service.getFeatureGitStatus(featureId, baseBranch ?? null);
      return {
        ...summary,
        repos: summary.repos.map((repo) => ({
          ...repo,
          submodules: [...repo.submodules],
        })),
      };
    },

    async readFeatureRepoDiff({ featureId, directory, filePath, includeUntracked }) {
      const diff = await service.readFeatureRepoDiff({
        featureId,
        directory,
        filePath: filePath ?? null,
        includeUntracked: includeUntracked ?? true,
      });
      return {
        ...diff,
        files: [...diff.files],
      };
    },

    async commitFeatureRepo({ featureId, directory, message, files, push }) {
      return service.commitFeatureRepo({
        featureId,
        directory,
        message,
        files: files ?? null,
        push: push ?? false,
      });
    },

    async pushFeatureRepo({ featureId, directory }) {
      return service.pushFeatureRepo({ featureId, directory });
    },

    async suggestFeatureCommitMessage({ featureId, directory }) {
      return service.suggestFeatureCommitMessage({ featureId, directory });
    },

    async inspectFeatureHealth({ featureId, deletesBranches }) {
      const report = await service.inspectFeatureHealth({
        featureId,
        deletesBranches,
      });
      return {
        ...report,
        repos: [...report.repos],
        warnings: [...report.warnings],
      };
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
