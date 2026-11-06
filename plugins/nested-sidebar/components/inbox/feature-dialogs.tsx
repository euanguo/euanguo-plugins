import { useState } from "react";
import type { PluginSidebarProject } from "@get-bb/plugin-sdk/app";

import { FeatureCreateDialog } from "@/components/inbox/feature-create-dialog";
import { FeatureEndDialog, FeatureRenameDialog } from "@/components/inbox/feature-end-dialog";
import { FeatureRepositoriesDialog } from "@/components/inbox/feature-repositories-dialog";
import type { FeaturesApi } from "@/hooks/use-features";
import type { Feature } from "@/lib/features";
import type { ProjectGroup } from "@/lib/groups";

/**
 * Which feature dialog is open, and the dialogs themselves.
 *
 * One state rather than five booleans in the inbox, because only one of them is
 * ever open, and the inbox already owns the tree, the shelves, the selection and
 * the reorder gestures.
 */
export type FeatureDialogState =
  | { readonly kind: "closed" }
  | { readonly kind: "create" }
  | { readonly kind: "repositories"; readonly featureId: string }
  | { readonly kind: "rename"; readonly featureId: string }
  | { readonly kind: "finish"; readonly featureId: string }
  | { readonly kind: "delete"; readonly featureId: string };

export function useFeatureDialogs() {
  const [state, setState] = useState<FeatureDialogState>({ kind: "closed" });
  return {
    state,
    open: setState,
    close: () => setState({ kind: "closed" }),
  };
}

export function FeatureDialogs({
  state,
  api,
  groups,
  projects,
  projectPaths,
  defaultGroupId,
  onClose,
  onCreated,
}: {
  state: FeatureDialogState;
  api: FeaturesApi;
  groups: readonly ProjectGroup[];
  /** The repositories a feature can hold: every project but personal and Features. */
  projects: readonly PluginSidebarProject[];
  projectPaths: ReadonlyMap<string, string | null>;
  defaultGroupId: string | null;
  onClose: () => void;
  onCreated: (feature: Feature, startConversation: boolean) => void;
}) {
  const featureId = state.kind === "closed" || state.kind === "create" ? null : state.featureId;
  const feature = featureId === null ? null : (api.byId.get(featureId) ?? null);
  return (
    <>
      <FeatureCreateDialog
        open={state.kind === "create"}
        groups={groups}
        projects={projects}
        defaultGroupId={defaultGroupId}
        onClose={onClose}
        onCreate={api.create}
        onCreated={(created, start) => {
          onClose();
          onCreated(created, start);
        }}
      />
      <FeatureRepositoriesDialog
        open={state.kind === "repositories"}
        feature={state.kind === "repositories" ? feature : null}
        members={api.members.filter((member) => member.featureId === featureId)}
        projects={projects}
        paths={projectPaths}
        api={api}
        onClose={onClose}
      />
      <FeatureRenameDialog
        feature={state.kind === "rename" ? feature : null}
        onClose={onClose}
        onRename={api.rename}
      />
      <FeatureEndDialog
        mode={state.kind === "finish" || state.kind === "delete" ? state.kind : null}
        feature={feature}
        onClose={onClose}
      />
    </>
  );
}
