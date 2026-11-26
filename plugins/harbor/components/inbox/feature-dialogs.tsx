import { useState } from "react";
import type { PluginSidebarProject } from "@get-bb/plugin-sdk/app";

import { FeatureHubModal } from "@/components/feature-hub/feature-hub-modal";
import type { FeatureHubSection } from "@/components/feature-hub/hub-tab-ref";
import { FeatureCreateDialog } from "@/components/inbox/feature-create-dialog";
import { FeatureEndDialog } from "@/components/inbox/feature-end-dialog";
import { FeaturePromoteDialog } from "@/components/inbox/feature-promote-dialog";
import { RenameDialog } from "@/components/inbox/rename-dialog";
import type { FeaturesApi } from "@/hooks/use-features";
import type { Feature } from "@/lib/domain/features";

/**
 * Which feature dialog is open, and the dialogs themselves.
 *
 * Requirement, repository, and park workflows live in the canonical
 * FeatureHubModal; only instant create/rename/promote/finish/delete dialogs
 * remain separate.
 */
export type FeatureDialogState =
  | { readonly kind: "closed" }
  | { readonly kind: "create" }
  | {
      readonly kind: "hub";
      readonly featureId: string;
      readonly section?: FeatureHubSection;
      readonly directory?: string | null;
    }
  | { readonly kind: "rename"; readonly featureId: string }
  | {
      readonly kind: "promote";
      readonly environmentId: string;
      readonly workspaceLabel: string;
      readonly branch: string | null;
      readonly projectId: string;
    }
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
  projects,
  onClose,
  onCreated,
}: {
  state: FeatureDialogState;
  api: FeaturesApi;
  /** The repositories a feature can hold: every project but personal and Features. */
  projects: readonly PluginSidebarProject[];
  onClose: () => void;
  onCreated: (feature: Feature, startConversation: boolean) => void;
}) {
  const featureId =
    state.kind === "closed" ||
    state.kind === "create" ||
    state.kind === "promote"
      ? null
      : state.featureId;
  const feature = featureId === null ? null : (api.byId.get(featureId) ?? null);
  return (
    <>
      <FeatureCreateDialog
        open={state.kind === "create"}
        projects={projects}
        onClose={onClose}
        onCreate={api.create}
        onCreated={(created, start) => {
          onClose();
          onCreated(created, start);
        }}
      />
      <FeatureHubModal
        open={state.kind === "hub"}
        featureId={state.kind === "hub" ? state.featureId : null}
        initialSection={state.kind === "hub" ? state.section : undefined}
        initialDirectory={state.kind === "hub" ? state.directory : undefined}
        onClose={onClose}
      />
      {state.kind === "rename" && feature !== null ? (
        <RenameDialog
          open
          title="Rename feature"
          subtitle="The folder and the branch keep their name."
          fieldLabel="Feature name"
          currentName={feature.name}
          maxLength={60}
          inputAriaLabel={`Rename ${feature.name}`}
          errorFallback="Could not rename the feature."
          onClose={onClose}
          onSubmit={(next) => api.rename(feature.id, next).then(() => undefined)}
        />
      ) : null}
      <FeaturePromoteDialog
        open={state.kind === "promote"}
        source={state.kind === "promote" ? state : null}
        projects={projects}
        onPromote={api.promote}
        onPromoted={(promoted) => {
          onClose();
          onCreated(promoted, false);
        }}
        onClose={onClose}
      />
      <FeatureEndDialog
        mode={state.kind === "finish" || state.kind === "delete" ? state.kind : null}
        feature={feature}
        onClose={onClose}
      />
    </>
  );
}
