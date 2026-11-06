import { useCallback } from "react";

import type { FeaturesApi } from "@/hooks/use-features";

/**
 * Opening the conversation that belongs to a feature.
 *
 * bb needs a project for every thread and a feature spans several, so the
 * project of its first member wins. That is a decision about how a feature maps
 * onto bb's model, which is why it lives here rather than in the row that
 * happens to draw the button.
 */
export function useFeatureThread(input: {
  readonly features: FeaturesApi;
  readonly fallbackProjectId: string | null;
  readonly openThread: (threadId: string) => void;
  readonly onNavigate: () => void;
}): (featureId: string) => void {
  const { features, fallbackProjectId, openThread, onNavigate } = input;
  return useCallback(
    (featureId: string) => {
      const member = features.members.find(
        (candidate) => candidate.featureId === featureId,
      );
      const projectId = member?.projectId ?? fallbackProjectId;
      if (projectId === null || projectId.length === 0) return;
      void features.openThread(featureId, projectId).then((result) => {
        if (result.threadId === null) return;
        openThread(result.threadId);
        onNavigate();
      });
    },
    [features, fallbackProjectId, openThread, onNavigate],
  );
}
