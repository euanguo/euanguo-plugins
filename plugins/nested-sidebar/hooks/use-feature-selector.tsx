import type { ReactNode } from "react";

import { FeatureSelector } from "@/components/inbox/feature-selector";
import { sortFeatures, type Feature } from "@/lib/features";

/**
 * The feature view's selector, built once for the inbox.
 *
 * It exists as its own hook so the inbox keeps to its job — order and wiring —
 * and so the selector's trigger, its empty case and the "everything hidden"
 * message are decided next to each other rather than spread through the file.
 */
export function useFeatureSelector(input: {
  readonly firstLevel: "project" | "feature";
  readonly showFeatures: boolean;
  readonly features: readonly Feature[];
  readonly hidden: readonly string[];
  readonly onSetHidden: (featureId: string, hidden: boolean) => void;
  readonly onSetAllHidden: (featureIds: readonly string[], hidden: boolean) => void;
}): { readonly selector: ReactNode; readonly allHidden: boolean } {
  const active = sortFeatures(
    input.features.filter((feature) => feature.state === "active"),
  );
  const visible = input.firstLevel === "feature" && input.showFeatures;
  const allHidden =
    visible &&
    active.length > 0 &&
    active.every((feature) => input.hidden.includes(feature.id));
  return {
    selector: visible ? (
      <FeatureSelector
        features={active}
        hidden={input.hidden}
        onSetHidden={input.onSetHidden}
        onSetAllHidden={input.onSetAllHidden}
      />
    ) : undefined,
    allHidden,
  };
}
