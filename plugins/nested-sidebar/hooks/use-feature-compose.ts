import { useCallback } from "react";
import type { PluginSidebarProject } from "@get-bb/plugin-sdk/app";

import type { FeaturesApi } from "@/hooks/use-features";
import type { NewThreadApi } from "@/hooks/use-new-thread";

/**
 * Starting a conversation in a feature.
 *
 * It opens the same compose dialog every other `+` opens, with the feature
 * directory as its environment, and sends nothing. A thread whose first turn is
 * a prompt the sidebar wrote is not a thread the user started; the directory
 * already carries `NEST.md` and `.nest-feature.json`, and an agent asked to work
 * there reads them.
 *
 * Which project the thread belongs to is a decision about bb's model, not about
 * the row that draws the button, so it lives here: a feature spans projects and
 * every bb thread takes exactly one.
 */
export function useFeatureCompose(input: {
  readonly features: FeaturesApi;
  readonly newThread: NewThreadApi;
  readonly projects: readonly PluginSidebarProject[];
}): (featureId: string) => void {
  const { features, newThread, projects } = input;
  return useCallback(
    (featureId: string) => {
      const feature = features.features.find(
        (candidate) => candidate.id === featureId,
      );
      if (feature === undefined || feature.rootPath === null) return;
      const member = features.members.find(
        (candidate) => candidate.featureId === featureId,
      );
      const projectId = member?.projectId ?? projects[0]?.id;
      if (projectId === undefined) return;
      newThread.seedFromFeature({
        featureId,
        featureName: feature.name,
        projectId,
        projectName:
          projects.find((project) => project.id === projectId)?.name ?? "",
        rootPath: feature.rootPath,
        hostId: feature.hostId,
      });
    },
    [features, newThread, projects],
  );
}
