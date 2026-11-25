import type { ReactNode } from "react";

import { FeatureSelector } from "@/components/inbox/feature-selector";
import { useHarborViewState } from "@/components/inbox/view-state-context";
import { sortFeatures, type Feature } from "@/lib/domain/features";

/**
 * The Features section's selector, and whether it has hidden everything.
 *
 * Decided together because they answer one question: an empty section says
 * "No features selected" exactly when this selector is the reason.
 */
export function useFeatureSelector(features: readonly Feature[]): {
  readonly selector: ReactNode;
  readonly allHidden: boolean;
} {
  const viewState = useHarborViewState();
  const active = sortFeatures(features.filter((feature) => feature.state === "active"));
  const hidden = active
    .filter((feature) => viewState.isFeatureHidden(feature.id))
    .map((feature) => feature.id);
  return {
    selector:
      active.length === 0 ? null : (
        <FeatureSelector
          features={active}
          hidden={hidden}
          onSetHidden={viewState.setFeatureHidden}
          onSetAllHidden={viewState.setAllFeaturesHidden}
        />
      ),
    allHidden: active.length > 0 && hidden.length === active.length,
  };
}
