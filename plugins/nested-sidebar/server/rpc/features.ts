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
import type {
  FeatureBrief,
  FeatureDecision,
  FeatureMeta,
  FeatureRef,
} from "../../lib/feature-meta.ts";
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
  | "getFeatureMeta"
  | "updateFeatureBrief"
  | "addFeatureRef"
  | "removeFeatureRef"
  | "addFeatureDecision"
  | "confirmFeatureDecision"
  | "deleteFeatureDecisionDraft"
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
        meta: { ...snapshot.meta },
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

    async getFeatureMeta({ featureId }) {
      return metaWire(service.meta(featureId));
    },

    async updateFeatureBrief({ featureId, brief }) {
      return { brief: briefWire(await service.setBrief(featureId, brief)) };
    },

    async addFeatureRef({ featureId, ref }) {
      return { ref: refWire(await service.addRef(featureId, ref)) };
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
      return { decision: decisionWire(decision) };
    },

    async confirmFeatureDecision({ featureId, decisionId }) {
      const ok = await service.confirmDecision(featureId, decisionId);
      const decision = service
        .meta(featureId)
        .decisions.find((entry) => entry.id === decisionId);
      if (!ok || decision === undefined) {
        throw new Error("That draft could not be confirmed; it may no longer be a draft.");
      }
      return { decision: decisionWire(decision) };
    },

    async deleteFeatureDecisionDraft({ featureId, decisionId }) {
      return { ok: await service.removeDraft(featureId, decisionId) };
    },
  };
}

/**
 * The stored shapes, spelled out as mutable arrays for the wire.
 *
 * The domain types are readonly so nothing in the server mutates a record
 * another read is holding; the RPC contract's inferred output types are
 * mutable, so the boundary copies the two arrays that are lists.
 */
function briefWire(brief: FeatureBrief) {
  return {
    ...brief,
    openQuestions: [...brief.openQuestions],
    blockers: [...brief.blockers],
  };
}

function refWire(ref: FeatureRef) {
  return { ...ref };
}

function decisionWire(decision: FeatureDecision) {
  return {
    ...decision,
    alternativesRejected: [...decision.alternativesRejected],
  };
}

function metaWire(meta: FeatureMeta) {
  return {
    brief: briefWire(meta.brief),
    refs: meta.refs.map(refWire),
    decisions: meta.decisions.map(decisionWire),
  };
}
