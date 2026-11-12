import { useCallback, useEffect, useMemo, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";

import type { nestRpcContract } from "@/server/contract";
import { FEATURE_CHANNEL } from "@/lib/realtime-channels";
import type { Feature, FeatureAssignment, FeatureMember } from "@/lib/features";
import {
  EMPTY_META_SUMMARY,
  type FeatureBrief,
  type FeatureDecision,
  type FeatureMeta,
  type FeatureMetaSummary,
  type FeatureRef,
  type RefKind,
} from "@/lib/feature-meta";
import { useCoalescedRealtime } from "@/hooks/use-coalesced-realtime";

export interface RepositoryResult {
  readonly projectId: string;
  readonly repository: string;
  readonly outcome: "created" | "reused" | "blocked";
  readonly path: string | null;
  readonly branch: string | null;
  readonly setup: readonly string[];
  readonly reason: string | null;
}

export interface RepositoryPlan {
  readonly projectId: string;
  readonly repository: string;
  readonly branch: string;
  readonly path: string;
  readonly outcome: "create" | "reuse" | "blocked";
  readonly newBranch: boolean;
  readonly base: string | null;
  readonly reason: string | null;
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

export interface FeaturesApi {
  readonly features: readonly Feature[];
  readonly members: readonly FeatureMember[];
  /** environmentId -> featureId, for worktrees adopted from outside a feature folder. */
  readonly adoptions: FeatureAssignment;
  /** Feature container path -> the Features project root conversations are created in. */
  readonly homeProjects: Readonly<Record<string, string>>;
  /** Projects that hold feature folders, old roots included; hidden from the project view. */
  readonly featureProjectIds: readonly string[];
  /** featureId -> what the feature has recorded, as counts. */
  readonly meta: Readonly<Record<string, FeatureMetaSummary>>;
  readonly ready: boolean;
  readonly byId: ReadonlyMap<string, Feature>;
  /** The counts for one feature, or an empty summary when nothing is recorded. */
  metaOf: (featureId: string) => FeatureMetaSummary;
  getMeta: (featureId: string) => Promise<FeatureMeta>;
  saveBrief: (featureId: string, brief: BriefInput) => Promise<FeatureBrief>;
  addRef: (featureId: string, ref: RefInput) => Promise<FeatureRef>;
  removeRef: (featureId: string, refId: string) => Promise<boolean>;
  addDecision: (featureId: string, decision: DecisionInput) => Promise<FeatureDecision>;
  confirmDecision: (featureId: string, decisionId: string) => Promise<FeatureDecision>;
  deleteDraft: (featureId: string, decisionId: string) => Promise<boolean>;
  create: (input: {
    name: string;
    slug: string | null;
    repositories: readonly { projectId: string; branch: string | null }[];
  }) => Promise<{ feature: Feature; repositories: readonly RepositoryResult[] }>;
  rename: (featureId: string, name: string) => Promise<boolean>;
  adopt: (environmentId: string, featureId: string | null) => Promise<boolean>;
  planRepositories: (
    featureId: string,
    repositories: readonly { projectId: string; branch: string | null }[],
  ) => Promise<readonly RepositoryPlan[]>;
  addRepositories: (
    featureId: string,
    repositories: readonly { projectId: string; branch: string | null }[],
  ) => Promise<readonly RepositoryResult[]>;
  renameMemberBranch: (
    featureId: string,
    directory: string,
    branch: string,
  ) => Promise<{ ok: boolean; reason: string | null }>;
  removeRepository: (
    featureId: string,
    directory: string,
    force: boolean,
  ) => Promise<boolean>;
  reopen: (featureId: string) => Promise<void>;
  refresh: () => void;
}

/**
 * The features, the worktrees inside their folders, and the writes on them.
 *
 * A feature list that cannot be read is not a reason to hide the project tree:
 * it starts empty and reports `ready`, so the feature view says it has nothing
 * rather than the sidebar drawing nothing at all.
 */
export function useFeatures(enabled = true): FeaturesApi {
  const rpc = useRpc<typeof nestRpcContract>();
  const [snapshot, setSnapshot] = useState<{
    features: readonly Feature[];
    members: readonly FeatureMember[];
    adoptions: FeatureAssignment;
    homeProjects: Readonly<Record<string, string>>;
    featureProjectIds: readonly string[];
    meta: Readonly<Record<string, FeatureMetaSummary>>;
  }>({
    features: [],
    members: [],
    adoptions: {},
    homeProjects: {},
    featureProjectIds: [],
    meta: {},
  });
  const [ready, setReady] = useState(false);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) {
      // The view is off: do not read, and do not let the read create the
      // Features project behind the user's back.
      setReady(true);
      return;
    }
    let cancelled = false;
    void rpc
      .call("listFeatures", {})
      .then((result) => {
        if (cancelled) return;
        setSnapshot(result);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, nonce, rpc]);

  useCoalescedRealtime(FEATURE_CHANNEL, refresh);

  const byId = useMemo(
    () => new Map(snapshot.features.map((feature) => [feature.id, feature])),
    [snapshot.features],
  );

  const create = useCallback<FeaturesApi["create"]>(
    async (input) => {
      const result = await rpc.call("createFeature", {
        ...input,
        repositories: [...input.repositories],
      });
      refresh();
      return result;
    },
    [rpc, refresh],
  );

  const rename = useCallback(
    async (featureId: string, name: string) => {
      const result = await rpc.call("renameFeature", { featureId, name });
      if (result.ok) refresh();
      return result.ok;
    },
    [rpc, refresh],
  );

  const adopt = useCallback(
    async (environmentId: string, featureId: string | null) => {
      const result = await rpc.call("adoptWorkspace", { environmentId, featureId });
      if (result.ok) refresh();
      return result.ok;
    },
    [rpc, refresh],
  );

  const planRepositories = useCallback<FeaturesApi["planRepositories"]>(
    async (featureId, repositories) =>
      (await rpc.call("planFeatureRepositories", {
        featureId,
        repositories: [...repositories],
      })).plans,
    [rpc],
  );

  const addRepositories = useCallback<FeaturesApi["addRepositories"]>(
    async (featureId, repositories) => {
      const result = await rpc.call("addFeatureRepositories", {
        featureId,
        repositories: [...repositories],
      });
      refresh();
      return result.results;
    },
    [rpc, refresh],
  );

  const renameMemberBranch = useCallback<FeaturesApi["renameMemberBranch"]>(
    async (featureId, directory, branch) => {
      const result = await rpc.call("renameFeatureMemberBranch", {
        featureId,
        directory,
        branch,
      });
      if (result.ok) refresh();
      return result;
    },
    [rpc, refresh],
  );

  const removeRepository = useCallback(
    async (featureId: string, directory: string, force: boolean) => {
      const result = await rpc.call("removeFeatureRepository", {
        featureId,
        directory,
        force,
      });
      refresh();
      return result.removed;
    },
    [rpc, refresh],
  );

  const reopen = useCallback(
    async (featureId: string) => {
      await rpc.call("reopenFeature", { featureId });
      refresh();
    },
    [rpc, refresh],
  );

  const metaOf = useCallback(
    (featureId: string): FeatureMetaSummary =>
      snapshot.meta[featureId] ?? EMPTY_META_SUMMARY,
    [snapshot.meta],
  );

  const getMeta = useCallback(
    async (featureId: string): Promise<FeatureMeta> =>
      rpc.call("getFeatureMeta", { featureId }),
    [rpc],
  );

  const saveBrief = useCallback(
    async (featureId: string, brief: BriefInput) => {
      const result = await rpc.call("updateFeatureBrief", {
        featureId,
        brief: {
          goal: brief.goal,
          nonGoals: brief.nonGoals,
          acceptance: brief.acceptance,
          notes: brief.notes,
          openQuestions: [...brief.openQuestions],
          blockers: [...brief.blockers],
        },
      });
      refresh();
      return result.brief;
    },
    [rpc, refresh],
  );

  const addRef = useCallback(
    async (featureId: string, ref: RefInput) => {
      const result = await rpc.call("addFeatureRef", {
        featureId,
        ref: {
          ...(ref.kind === undefined ? {} : { kind: ref.kind }),
          ...(ref.refId === undefined ? {} : { refId: ref.refId }),
          ...(ref.url === undefined ? {} : { url: ref.url }),
          ...(ref.title === undefined ? {} : { title: ref.title }),
        },
      });
      refresh();
      return result.ref;
    },
    [rpc, refresh],
  );

  const removeRef = useCallback(
    async (featureId: string, refId: string) => {
      const result = await rpc.call("removeFeatureRef", { featureId, refId });
      if (result.ok) refresh();
      return result.ok;
    },
    [rpc, refresh],
  );

  const addDecision = useCallback(
    async (featureId: string, decision: DecisionInput) => {
      const result = await rpc.call("addFeatureDecision", {
        featureId,
        title: decision.title,
        choice: decision.choice,
        rationale: decision.rationale,
        alternatives: [...decision.alternatives],
        impact: decision.impact,
        supersedes: decision.supersedes,
        threadId: null,
      });
      refresh();
      return result.decision;
    },
    [rpc, refresh],
  );

  const confirmDecision = useCallback(
    async (featureId: string, decisionId: string) => {
      const result = await rpc.call("confirmFeatureDecision", {
        featureId,
        decisionId,
      });
      refresh();
      return result.decision;
    },
    [rpc, refresh],
  );

  const deleteDraft = useCallback(
    async (featureId: string, decisionId: string) => {
      const result = await rpc.call("deleteFeatureDecisionDraft", {
        featureId,
        decisionId,
      });
      if (result.ok) refresh();
      return result.ok;
    },
    [rpc, refresh],
  );

  return {
    ...snapshot,
    ready,
    byId,
    metaOf,
    getMeta,
    saveBrief,
    addRef,
    removeRef,
    addDecision,
    confirmDecision,
    deleteDraft,
    create,
    rename,
    adopt,
    planRepositories,
    addRepositories,
    renameMemberBranch,
    removeRepository,
    reopen,
    refresh,
  };
}
