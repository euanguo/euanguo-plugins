import { useState } from "react";
import type { PluginSidebarProject } from "@get-bb/plugin-sdk/app";

import { FeatureManagerDialog } from "@/components/inbox/feature-manager-dialog";
import { FeatureMaterializeDialog } from "@/components/inbox/feature-materialize-dialog";
import { RemoveFeatureDialog } from "@/components/inbox/remove-feature-dialog";
import type { FeaturesApi } from "@/hooks/use-features";
import type { ProjectGroup } from "@/lib/groups";

/**
 * Which feature dialog is open, and the dialogs themselves.
 *
 * One component rather than three states in the inbox: the inbox already owns
 * the tree, the shelves, the selection and the reorder gestures, and a fourth
 * concern there made the file the largest in the plugin for modals that share
 * nothing with the tree.
 */
export type FeatureDialogState =
  | { readonly kind: "closed" }
  | { readonly kind: "create" }
  | { readonly kind: "materialize"; readonly featureId: string }
  | { readonly kind: "remove"; readonly featureId: string };

export function useFeatureDialogs() {
  const [state, setState] = useState<FeatureDialogState>({ kind: "closed" });
  return {
    state,
    openCreate: () => setState({ kind: "create" }),
    openMaterialize: (featureId: string) =>
      setState({ kind: "materialize", featureId }),
    openRemove: (featureId: string) => setState({ kind: "remove", featureId }),
    close: () => setState({ kind: "closed" }),
  };
}

export function FeatureDialogs({
  state,
  features,
  groups,
  projects,
  defaultGroupId,
  onClose,
  onCreate,
  onSetGroup,
  onPlan,
  onCreateWorkspace,
  onRemoved,
}: {
  state: FeatureDialogState;
  features: FeaturesApi;
  groups: readonly ProjectGroup[];
  projects: readonly PluginSidebarProject[];
  defaultGroupId: string | null;
  onClose: () => void;
  onCreate: FeaturesApi["create"];
  onSetGroup: FeaturesApi["setGroup"];
  onPlan: FeaturesApi["planWorkspace"];
  onCreateWorkspace: FeaturesApi["materializeWorkspace"];
  onRemoved: () => void;
}) {
  const materializeFeature =
    state.kind === "materialize"
      ? (features.features.find((feature) => feature.id === state.featureId) ??
        null)
      : null;
  return (
    <>
      <FeatureManagerDialog
        open={state.kind === "create"}
        features={features.features}
        groups={groups}
        defaultGroupId={defaultGroupId}
        onClose={onClose}
        onCreate={onCreate}
        onSetGroup={onSetGroup}
      />
      <FeatureMaterializeDialog
        open={state.kind === "materialize"}
        feature={materializeFeature}
        projects={projects}
        onClose={onClose}
        onPlan={onPlan}
        onCreate={onCreateWorkspace}
      />
      <RemoveFeatureDialog
        open={state.kind === "remove"}
        featureId={state.kind === "remove" ? state.featureId : null}
        onClose={onClose}
        onRemoved={onRemoved}
      />
    </>
  );
}
