import { useCallback, useMemo } from "react";
import { experimental_useRpcQuery, useRpc } from "@get-bb/plugin-sdk/app";

import { harborRpcContract } from "@/server/contract";
import { FEATURE_CHANNEL } from "@/lib/realtime-channels";
import type { Feature, FeatureAssignment, FeatureMember, FeatureRefLink } from "@/lib/domain/features";
import {
  EMPTY_META_SUMMARY,
  type FeatureBrief,
  type FeatureDecision,
  type FeatureMeta,
  type FeatureMetaSummary,
  type FeatureRef,
  type RefKind,
} from "@/lib/domain/feature-meta";
import { useCoalescedRealtime } from "@/hooks/use-coalesced-realtime";
import type { RepositoryResult } from "@/lib/schemas/feature";

export type { RepositoryResult };

export interface RepositoryPlan {
  readonly projectId: string;
  readonly repository: string;
  readonly branch: string;
  readonly path: string;
  readonly outcome: "create" | "reuse" | "blocked";
  readonly newBranch: boolean;
  readonly base: string | null;
  readonly reason: string | null;
  readonly role?: "worktree" | "ref";
}

export interface RepositorySpecInput {
  readonly projectId: string;
  readonly branch: string | null;
  readonly role?: "worktree" | "ref";
  readonly baseBranch?: string | null;
}

export interface BriefInput {
  readonly goal: string;
  readonly nonGoals: string;
  readonly acceptance: string;
  readonly notes: string;
  readonly openQuestions: readonly string[];
  readonly blockers: readonly string[];
}

export interface RefInput {
  readonly kind?: RefKind;
  readonly refId?: string;
  readonly url?: string;
  readonly title?: string;
}

export interface DecisionInput {
  readonly title: string;
  readonly choice: string;
  readonly rationale: string;
  readonly alternatives: readonly string[];
  readonly impact: string;
  readonly supersedes: number | null;
}

export interface ParkFeatureInput {
  readonly featureId: string;
  readonly reason?: string | null;
  readonly note?: string | null;
  readonly wakeAt?: number | null;
  readonly wakeOnActivity?: boolean;
}

export interface PromoteFeatureInput {
  readonly environmentId: string;
  readonly name: string;
  readonly slug?: string | null;
  readonly baseBranch?: string | null;
  readonly additionalRepositories?: readonly {
    readonly projectId: string;
    readonly branch?: string | null;
    readonly role?: "worktree" | "ref";
    readonly baseBranch?: string | null;
  }[];
}

export interface FeaturesApi {
  readonly features: readonly Feature[];
  readonly members: readonly FeatureMember[];
  readonly refLinks: readonly FeatureRefLink[];
  readonly adoptions: FeatureAssignment;
  readonly homeProjects: Readonly<Record<string, string>>;
  readonly featureProjectIds: readonly string[];
  readonly meta: Readonly<Record<string, FeatureMetaSummary>>;
  readonly ready: boolean;
  readonly byId: ReadonlyMap<string, Feature>;
  metaOf: (featureId: string) => FeatureMetaSummary;
  getMeta: (featureId: string) => Promise<FeatureMeta>;
  saveBrief: (featureId: string, brief: BriefInput) => Promise<FeatureBrief>;
  addRef: (featureId: string, ref: RefInput) => Promise<FeatureRef>;
  removeRef: (featureId: string, refId: string) => Promise<boolean>;
  addDecision: (featureId: string, decision: DecisionInput) => Promise<FeatureDecision>;
  confirmDecision: (featureId: string, decisionId: string) => Promise<FeatureDecision>;
  deleteDraft: (featureId: string, decisionId: string) => Promise<boolean>;
  create: (input: { name?: string; slug: string | null; baseBranch?: string | null; repositories: readonly RepositorySpecInput[] }) => Promise<{ feature: Feature; repositories: readonly RepositoryResult[] }>;
  rename: (featureId: string, name: string) => Promise<boolean>;
  adopt: (environmentId: string, featureId: string | null) => Promise<boolean>;
  planRepositories: (featureId: string, repositories: readonly RepositorySpecInput[]) => Promise<readonly RepositoryPlan[]>;
  addRepositories: (featureId: string, repositories: readonly RepositorySpecInput[], baseBranch?: string | null) => Promise<readonly RepositoryResult[]>;
  addReferenceRepo: (featureId: string, projectId: string) => Promise<RepositoryResult>;
  removeReferenceRepo: (featureId: string, directory: string) => Promise<boolean>;
  upgradeReferenceRepo: (input: { featureId: string; directory: string; branch?: string | null; baseBranch?: string | null }) => Promise<RepositoryResult>;
  renameMemberBranch: (featureId: string, directory: string, branch: string) => Promise<{ ok: boolean; reason: string | null }>;
  removeRepository: (featureId: string, directory: string, force: boolean) => Promise<boolean>;
  park: (input: ParkFeatureInput) => Promise<Feature>;
  unpark: (featureId: string) => Promise<Feature>;
  promote: (input: PromoteFeatureInput) => Promise<{ feature: Feature; adoptedEnvironmentId: string; repositories: readonly RepositoryResult[] }>;
  reopen: (featureId: string) => Promise<void>;
  refresh: () => void;
}

const EMPTY_SNAPSHOT = {
  features: [] as readonly Feature[],
  members: [] as readonly FeatureMember[],
  refLinks: [] as readonly FeatureRefLink[],
  adoptions: {} as FeatureAssignment,
  homeProjects: {} as Readonly<Record<string, string>>,
  featureProjectIds: [] as readonly string[],
  meta: {} as Readonly<Record<string, FeatureMetaSummary>>,
};

export function useFeatures(): FeaturesApi {
  const rpc = useRpc<typeof harborRpcContract>();
  const query = experimental_useRpcQuery({ contract: harborRpcContract, method: "listFeatures", input: {} });
  const snapshot = query.data ?? EMPTY_SNAPSHOT;
  const ready = !query.isLoading;
  const refresh = useCallback(() => void query.refetch(), [query.refetch]);
  useCoalescedRealtime(FEATURE_CHANNEL, refresh);

  const byId = useMemo(() => new Map(snapshot.features.map((f) => [f.id, f])), [snapshot.features]);
  const metaOf = useCallback((featureId: string): FeatureMetaSummary => snapshot.meta[featureId] ?? EMPTY_META_SUMMARY, [snapshot.meta]);

  const actions = useMemo(() => {
    const run = async <T>(call: () => Promise<T>, shouldRefresh: (v: T) => boolean = () => true): Promise<T> => {
      const value = await call();
      if (shouldRefresh(value)) refresh();
      return value;
    };
    const runOk = (call: () => Promise<{ ok: boolean }>) => run(call, (r) => r.ok).then((r) => r.ok);

    return {
      getMeta: (featureId: string) => rpc.call("getFeatureMeta", { featureId }),
      saveBrief: (featureId: string, brief: BriefInput) =>
        run(() => rpc.call("updateFeatureBrief", { featureId, brief: { ...brief, openQuestions: [...brief.openQuestions], blockers: [...brief.blockers] } })).then((r) => r.brief),
      addRef: (featureId: string, ref: RefInput) =>
        run(() =>
          rpc.call("addFeatureRef", {
            featureId,
            ref: {
              ...(ref.kind === undefined ? {} : { kind: ref.kind }),
              ...(ref.refId === undefined ? {} : { refId: ref.refId }),
              ...(ref.url === undefined ? {} : { url: ref.url }),
              ...(ref.title === undefined ? {} : { title: ref.title }),
            },
          }),
        ).then((r) => r.ref),
      removeRef: (featureId: string, refId: string) => runOk(() => rpc.call("removeFeatureRef", { featureId, refId })),
      addDecision: (featureId: string, decision: DecisionInput) =>
        run(() => rpc.call("addFeatureDecision", { featureId, ...decision, alternatives: [...decision.alternatives], threadId: null })).then((r) => r.decision),
      confirmDecision: (featureId: string, decisionId: string) =>
        run(() => rpc.call("confirmFeatureDecision", { featureId, decisionId })).then((r) => r.decision),
      deleteDraft: (featureId: string, decisionId: string) => runOk(() => rpc.call("deleteFeatureDecisionDraft", { featureId, decisionId })),
      create: (input: Parameters<FeaturesApi["create"]>[0]) => run(() => rpc.call("createFeature", { ...input, repositories: [...input.repositories] })),
      rename: (featureId: string, name: string) => runOk(() => rpc.call("renameFeature", { featureId, name })),
      adopt: (environmentId: string, featureId: string | null) => runOk(() => rpc.call("adoptWorkspace", { environmentId, featureId })),
      planRepositories: (featureId: string, repositories: readonly RepositorySpecInput[]) =>
        rpc.call("planFeatureRepositories", { featureId, repositories: [...repositories] }).then((r) => r.plans),
      addRepositories: (featureId: string, repositories: readonly RepositorySpecInput[], baseBranch?: string | null) =>
        run(() => rpc.call("addFeatureRepositories", { featureId, ...(baseBranch === undefined ? {} : { baseBranch }), repositories: [...repositories] })).then((r) => r.results),
      addReferenceRepo: (featureId: string, projectId: string) =>
        run(() => rpc.call("addFeatureReferenceRepo", { featureId, projectId })).then((r) => r.result),
      removeReferenceRepo: (featureId: string, directory: string) =>
        run(() => rpc.call("removeFeatureReferenceRepo", { featureId, directory }), (r) => r.removed).then((r) => r.removed),
      upgradeReferenceRepo: (input: { featureId: string; directory: string; branch?: string | null; baseBranch?: string | null }) =>
        run(() => rpc.call("upgradeFeatureReferenceRepo", input), (r) => r.result.outcome !== "blocked").then((r) => r.result),
      renameMemberBranch: (featureId: string, directory: string, branch: string) =>
        run(() => rpc.call("renameFeatureMemberBranch", { featureId, directory, branch }), (r) => r.ok),
      removeRepository: (featureId: string, directory: string, force: boolean) =>
        run(() => rpc.call("removeFeatureRepository", { featureId, directory, force })).then((r) => r.removed),
      park: (input: ParkFeatureInput) => run(() => rpc.call("parkFeature", input)).then((r) => r.feature),
      unpark: (featureId: string) => run(() => rpc.call("unparkFeature", { featureId })).then((r) => r.feature),
      promote: (input: PromoteFeatureInput) =>
        run(() => rpc.call("promoteToFeature", { ...input, additionalRepositories: input.additionalRepositories ? [...input.additionalRepositories] : undefined })),
      reopen: async (featureId: string) => { await run(() => rpc.call("reopenFeature", { featureId })); },
    };
  }, [rpc, refresh]);

  return useMemo(() => ({ ...snapshot, ready, byId, metaOf, refresh, ...actions }), [snapshot, ready, byId, metaOf, refresh, actions]);
}
