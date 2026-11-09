/**
 * Features over RPC.
 *
 * Thin by design: every decision is in the feature service, so the sidebar and
 * the agent tools reach the same rules through the same calls. The handlers do
 * two things the service does not — validate a group id against the groups
 * that exist, and turn a service refusal into an error the dialog can show.
 */

import type { PluginRpcHandlers } from "@get-bb/plugin-sdk";

import type { nestRpcContract } from "../contract.ts";
import type { FeatureService } from "../feature-service.ts";
import { featureNameIntent } from "../../lib/features.ts";

type Handlers<Method extends keyof typeof nestRpcContract> = Pick<
  PluginRpcHandlers<typeof nestRpcContract>,
  Method
>;

export function featureHandlers(deps: {
  readonly service: FeatureService;
}): Handlers<
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
> {
  const { service } = deps;

  return {
    async listFeatures() {
      const snapshot = await service.refresh();
      return {
        features: [...snapshot.features],
        members: [...snapshot.members],
        adoptions: { ...snapshot.adoptions },
        homeProjects: { ...snapshot.homeProjects },
        featureProjectIds: [...snapshot.featureProjectIds],
      };
    },

    async createFeature({ name, slug, repositories }) {
      const stored = featureNameIntent(name);
      if (stored === null) throw new Error("A feature needs a name of up to 60 characters.");
      const created = await service.create({ name: stored, slug, repositories });
      return { feature: created.feature, repositories: [...created.repositories] };
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
        })),
      };
    },

    async addFeatureRepositories({ featureId, repositories }) {
      return { results: [...(await service.addRepositories({ featureId, repositories }))] };
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
        warnings: [...surveyed.warnings],
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
  };
}
