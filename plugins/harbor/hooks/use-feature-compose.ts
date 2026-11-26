import { useCallback, useMemo } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";

import {
  featureNewChatSubPath,
  NEW_CHAT_PANEL_PATH,
} from "@/app/new-chat/route";
import type { FeaturesApi } from "@/hooks/use-features";
import type { Feature } from "@/lib/domain/features";
import { featureRootParent, normalizePath } from "@/lib/domain/feature-root";

/**
 * Starting a root conversation inside a feature.
 *
 * Routes straight into Harbor's full-screen `NewChatPage` targeted at the
 * feature folder rather than interrupting the user with a centered compose
 * modal.
 */
export function useFeatureCompose(input: {
  readonly features: FeaturesApi;
  readonly onNavigate?: () => void;
}) {
  const { features, onNavigate } = input;
  const navigate = useBbNavigate();

  const homeProjectOf = useCallback(
    (feature: Feature) =>
      feature.rootPath === null
        ? undefined
        : features.homeProjects[normalizePath(featureRootParent(feature.rootPath))],
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
      if (blocker(featureId) !== null) return;
      navigate.toPluginPanel(NEW_CHAT_PANEL_PATH, {
        subPath: featureNewChatSubPath(featureId),
      });
      onNavigate?.();
    },
    [blocker, navigate, onNavigate],
  );

  return useMemo(() => ({ open, blocker }), [blocker, open]);
}
