import { useCallback, useMemo } from "react";
import type { PluginSidebarProject } from "@get-bb/plugin-sdk/app";

import type { FeaturesApi } from "@/hooks/use-features";
import type { NewThreadApi } from "@/hooks/use-new-thread";
import type { Feature } from "@/lib/features";

/**
 * Starting a conversation in a feature.
 *
 * It opens the same compose dialog every other `+` opens, with the feature
 * folder as the workspace, and sends nothing: the agent learns where it is from
 * `AGENTS.md` in that folder and from the instructions Nest adds for a thread
 * inside a feature. The first sentence is the person's.
 *
 * The thread belongs to the machine's Features project, because a bb thread
 * belongs to exactly one project and a feature spans several.
 */
export function useFeatureCompose(input: {
  readonly features: FeaturesApi;
  readonly newThread: NewThreadApi;
  readonly projects: readonly PluginSidebarProject[];
}) {
  const { features, projects } = input;
  const { seedFromFeature } = input.newThread;

  const homeProjectOf = useCallback(
    (feature: Feature) =>
      feature.hostId === null ? undefined : features.homeProjects[feature.hostId],
    [features.homeProjects],
  );

  /** Why `+` cannot start a conversation here, or null when it can. */
  const blocker = useCallback(
    (featureId: string): string | null => {
      const feature = features.byId.get(featureId);
      if (feature === undefined) return "This feature no longer exists.";
      if (feature.rootPath === null) return "This feature's folder is still being created.";
      if (homeProjectOf(feature) === undefined) {
        return "The Features project is not available yet. Try again in a moment.";
      }
      return null;
    },
    [features.byId, homeProjectOf],
  );

  const open = useCallback(
    (featureId: string) => {
      const feature = features.byId.get(featureId);
      if (feature === undefined || feature.rootPath === null) return;
      const projectId = homeProjectOf(feature);
      if (projectId === undefined) return;
      seedFromFeature({
        featureName: feature.name,
        projectId,
        projectName: projects.find((project) => project.id === projectId)?.name ?? "Features",
        rootPath: feature.rootPath,
        hostId: feature.hostId,
      });
    },
    [features.byId, homeProjectOf, projects, seedFromFeature],
  );

  return useMemo(() => ({ open, blocker }), [blocker, open]);
}
