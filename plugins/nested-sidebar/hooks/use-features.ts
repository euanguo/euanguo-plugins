import { useCallback, useEffect, useMemo, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";

import type { nestRpcContract } from "@/server/contract";
import { FEATURE_CHANNEL } from "@/lib/realtime-channels";
import type { Feature, FeatureAssignment, FeatureMember } from "@/lib/features";
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

export interface FeaturesApi {
  readonly features: readonly Feature[];
  readonly members: readonly FeatureMember[];
  /** environmentId -> featureId, for worktrees adopted from outside a feature folder. */
  readonly adoptions: FeatureAssignment;
  /** hostId -> the Features project root conversations are created in. */
  readonly homeProjects: Readonly<Record<string, string>>;
  readonly ready: boolean;
  readonly byId: ReadonlyMap<string, Feature>;
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
export function useFeatures(): FeaturesApi {
  const rpc = useRpc<typeof nestRpcContract>();
  const [snapshot, setSnapshot] = useState<{
    features: readonly Feature[];
    members: readonly FeatureMember[];
    adoptions: FeatureAssignment;
    homeProjects: Readonly<Record<string, string>>;
  }>({ features: [], members: [], adoptions: {}, homeProjects: {} });
  const [ready, setReady] = useState(false);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
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
  }, [nonce, rpc]);

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

  return {
    ...snapshot,
    ready,
    byId,
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
