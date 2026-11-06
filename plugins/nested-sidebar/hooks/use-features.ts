import { useCallback, useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { nestRpcContract } from "@/server/contract";
import { FEATURE_CHANNEL } from "@/lib/realtime-channels";
import type { Feature, FeatureAssignment, FeatureState } from "@/lib/features";
import { useCoalescedRealtime } from "@/hooks/use-coalesced-realtime";

export interface FeaturesApi {
  readonly features: readonly Feature[];
  /** environmentId -> featureId. */
  readonly labels: FeatureAssignment;
  readonly ready: boolean;
  create: (name: string, groupId: string | null) => Promise<Feature | null>;
  rename: (featureId: string, name: string) => Promise<boolean>;
  setState: (featureId: string, state: FeatureState) => Promise<boolean>;
  setGroup: (featureId: string, groupId: string | null) => Promise<boolean>;
  remove: (featureId: string) => Promise<boolean>;
  label: (environmentId: string, featureId: string | null) => Promise<boolean>;
}

/**
 * The features and their workspace labels.
 *
 * A feature that cannot be read is not a reason to hide the project tree: the
 * list starts empty and the hook reports `ready` so the view can fall back to
 * drawing projects rather than a blank sidebar.
 */
export function useFeatures(): FeaturesApi {
  const rpc = useRpc<typeof nestRpcContract>();
  const [features, setFeatures] = useState<Feature[]>([]);
  const [labels, setLabels] = useState<FeatureAssignment>({});
  const [ready, setReady] = useState(false);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    rpc
      .call("listFeatures", {})
      .then((result) => {
        if (cancelled) return;
        setFeatures(result.features);
        setLabels(result.labels);
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

  const create = useCallback(
    async (name: string, groupId: string | null) => {
      const result = await rpc.call("createFeature", { name, groupId });
      if (result.feature !== null) refresh();
      return result.feature;
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

  const setState = useCallback(
    async (featureId: string, state: FeatureState) => {
      const result = await rpc.call("setFeatureState", { featureId, state });
      if (result.ok) refresh();
      return result.ok;
    },
    [rpc, refresh],
  );

  const setGroup = useCallback(
    async (featureId: string, groupId: string | null) => {
      const result = await rpc.call("setFeatureGroup", { featureId, groupId });
      if (result.ok) refresh();
      return result.ok;
    },
    [rpc, refresh],
  );

  const remove = useCallback(
    async (featureId: string) => {
      const result = await rpc.call("deleteFeature", { featureId });
      if (result.ok) refresh();
      return result.ok;
    },
    [rpc, refresh],
  );

  const label = useCallback(
    async (environmentId: string, featureId: string | null) => {
      const result = await rpc.call("setWorkspaceFeature", {
        environmentId,
        featureId,
      });
      if (result.ok) refresh();
      return result.ok;
    },
    [rpc, refresh],
  );

  return {
    features,
    labels,
    ready,
    create,
    rename,
    setState,
    setGroup,
    remove,
    label,
  };
}
