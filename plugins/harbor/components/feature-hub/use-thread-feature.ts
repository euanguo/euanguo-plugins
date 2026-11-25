import { useMemo } from "react";
import type { ExperimentalThreadTabProps } from "@get-bb/plugin-sdk/app";

import { resolveThreadFeature } from "@/components/feature-hub/hub-tab-ref";
import { useFeatures } from "@/hooks/use-features";
import { useWorkspaceIndex } from "@/hooks/use-workspace-index";

export function useThreadFeature(
  environment: ExperimentalThreadTabProps["environment"],
) {
  const api = useFeatures();
  const index = useWorkspaceIndex();

  const environmentId = environment?.id ?? null;
  const indexedKey =
    environmentId === null ? undefined : index.byEnvironmentId.get(environmentId);
  const indexedPath =
    indexedKey === undefined ? null : (index.byKey?.get(indexedKey)?.path ?? null);
  const environmentPath = indexedPath;

  const feature = useMemo(
    () =>
      resolveThreadFeature({
        environmentId,
        environmentPath,
        features: api.features,
        adoptions: api.adoptions,
      }),
    [api.adoptions, api.features, environmentId, environmentPath],
  );

  const members = useMemo(
    () =>
      feature === null
        ? []
        : api.members.filter((member) => member.featureId === feature.id),
    [api.members, feature],
  );

  const refLinks = useMemo(
    () =>
      feature === null
        ? []
        : api.refLinks.filter((link) => link.featureId === feature.id),
    [api.refLinks, feature],
  );

  return {
    feature,
    members,
    refLinks,
    api,
    environmentId,
    environmentPath,
  };
}

export function useFeatureHubVisible(props: ExperimentalThreadTabProps): boolean {
  const { feature } = useThreadFeature(props.environment);
  return feature !== null;
}
