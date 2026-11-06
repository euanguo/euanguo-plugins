import { useState } from "react";
import type { PluginSidebarProject } from "@get-bb/plugin-sdk/app";

import { FeatureManagerDialog } from "@/components/inbox/feature-manager-dialog";
import { FeatureMaterializeDialog } from "@/components/inbox/feature-materialize-dialog";
import type { FeaturesApi } from "@/hooks/use-features";
import type { ProjectGroup } from "@/lib/groups";

/**
 * Which feature dialog is open, and the two dialogs themselves.
 *
 * One component rather than two states in the inbox: the inbox already carries
 * the tree, the shelves, the selection and the reorder gestures, and adding a
 * third concern there made the file the largest in the plugin for two modals
 * that share nothing with the tree.
 */
export type FeatureDialogState =
  | { readonly kind: "closed" }
  | { readonly kind: "manage" }
  | { readonly kind: "materialize"; readonly featureId: string };

export function useFeatureDialogs() {
  const [state, setState] = useState<FeatureDialogState>({ kind: "closed" });
  return {
    state,
    openManager: () => setState({ kind: "manage" }),
    openMaterialize: (featureId: string) =>
      setState({ kind: "materialize", featureId }),
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
  onRename,
  onSetGroup,
  onDelete,
  onPlan,
  onCreateWorkspace,
}: {
  state: FeatureDialogState;
  features: FeaturesApi;
  groups: readonly ProjectGroup[];
  projects: readonly PluginSidebarProject[];
  defaultGroupId: string | null;
  onClose: () => void;
  onCreate: FeaturesApi["create"];
  onRename: FeaturesApi["rename"];
  onSetGroup: FeaturesApi["setGroup"];
  onDelete: FeaturesApi["remove"];
  onPlan: FeaturesApi["planWorkspace"];
  onCreateWorkspace: FeaturesApi["materializeWorkspace"];
}) {
  const materializeFeature =
    state.kind === "materialize"
      ? (features.features.find((feature) => feature.id === state.featureId) ??
        null)
      : null;
  return (
    <>
      <FeatureManagerDialog
        open={state.kind === "manage"}
        features={features.features}
        groups={groups}
        defaultGroupId={defaultGroupId}
        onClose={onClose}
        onCreate={onCreate}
        onRename={onRename}
        onSetGroup={onSetGroup}
        onDelete={onDelete}
      />
      <FeatureMaterializeDialog
        open={state.kind === "materialize"}
        feature={materializeFeature}
        projects={projects}
        onClose={onClose}
        onPlan={onPlan}
        onCreate={onCreateWorkspace}
      />
    </>
  );
}
