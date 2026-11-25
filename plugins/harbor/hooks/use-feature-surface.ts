import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useBbNavigate,
  useRpc,
  type PluginSidebarProject,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";

import type { harborRpcContract } from "@/server/contract";

import type { FeatureDialogState } from "@/components/inbox/feature-dialogs";
import type { FeatureRowActions } from "@/components/inbox/feature-node";
import type { TreeRowHandlers } from "@/components/inbox/tree-row-types";
import { useFeatureCompose } from "@/hooks/use-feature-compose";
import type { FeaturesApi } from "@/hooks/use-features";
import type { NewThreadApi } from "@/hooks/use-new-thread";
import { announceToSidebar } from "@/lib/ui/clipboard";
import { featureForPath, featureOfWorkspace, type Feature } from "@/lib/domain/features";
import {
  ALL_SCOPE_KEY,
  FEATURES_SCOPE_KEY,
  type HarborViewState,
} from "@/lib/ui/view-state";

/** How long a just-created feature waits for its first read before giving up on opening. */
const PENDING_COMPOSE_TIMEOUT_MS = 15_000;

/**
 * Everything the inbox needs to draw and act on features, in one place.
 *
 * Three surfaces share it: the Features section's rows, the worktree rows'
 * menus and the projects' "in features" links, and the dialogs. Keeping the
 * decisions here — which feature a worktree is in, what revealing a feature
 * means, what happens after one is created — is what keeps those three
 * agreeing.
 */
export function useFeatureSurface(input: {
  readonly api: FeaturesApi;
  readonly newThread: NewThreadApi;
  readonly projects: readonly PluginSidebarProject[];
  readonly projectPaths: ReadonlyMap<string, string | null>;
  readonly patchViewStateWith: (
    update: (current: HarborViewState) => HarborViewState,
  ) => void;
  readonly openDialog: (state: FeatureDialogState) => void;
}) {
  const {
    api,
    newThread,
    projects,
    projectPaths,
    patchViewStateWith,
    openDialog,
  } = input;
  const compose = useFeatureCompose({ features: api, newThread, projects });
  const rpc = useRpc<typeof harborRpcContract>();
  const navigate = useBbNavigate();
  const { adopt, reopen, unpark } = api;
  const active = useMemo(
    () => api.features.filter((feature) => feature.state !== "archived"),
    [api.features],
  );

  /** The repositories a feature can hold: everything but personal projects and the Features projects. */
  const repositoryProjects = useMemo(() => {
    const homes = new Set(Object.values(api.homeProjects));
    return projects.filter((project) => !project.isPersonal && !homes.has(project.id));
  }, [api.homeProjects, projects]);

  /**
   * Open a feature where it is drawn and scroll to it.
   *
   * The mode stays: the Features section is in both. A feature the selector
   * hid is shown again, since asking for it is the opposite of hiding it.
   */
  const [pendingReveal, setPendingReveal] = useState<string | null>(null);
  const reveal = useCallback(
    (featureId: string) => {
      patchViewStateWith((current) => ({
        ...current,
        hiddenFeatureIds: current.hiddenFeatureIds.filter((id) => id !== featureId),
        collapsedProjects: current.collapsedProjects.filter((id) => id !== featureId),
      }));
      setPendingReveal(featureId);
    },
    [patchViewStateWith],
  );

  // Scroll the feature into view once it is drawn. A few frames at most: the
  // expansion lands on the next render, not this one.
  useEffect(() => {
    if (pendingReveal === null) return;
    let frames = 0;
    let handle = 0;
    const step = () => {
      const element = document.querySelector(`[data-harbor-feature="${CSS.escape(pendingReveal)}"]`);
      if (element !== null) {
        element.scrollIntoView({ block: "nearest", behavior: "smooth" });
        setPendingReveal(null);
        return;
      }
      frames += 1;
      if (frames < 30) handle = requestAnimationFrame(step);
      else setPendingReveal(null);
    };
    handle = requestAnimationFrame(step);
    return () => cancelAnimationFrame(handle);
  }, [pendingReveal]);

  /**
   * A conversation asked for at creation, opened once the feature is readable.
   *
   * The create answers before the feature list and the Features project are
   * re-read, so the compose dialog waits here for both rather than opening on a
   * feature it cannot yet place.
   */
  const [pendingCompose, setPendingCompose] = useState<string | null>(null);
  useEffect(() => {
    if (pendingCompose === null) return;
    if (compose.blocker(pendingCompose) === null) {
      setPendingCompose(null);
      compose.open(pendingCompose);
      return;
    }
    const timer = setTimeout(() => {
      setPendingCompose(null);
      announceToSidebar(compose.blocker(pendingCompose) ?? "The feature is ready.");
    }, PENDING_COMPOSE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [compose, pendingCompose]);

  /**
   * A new feature has no members yet, so a group tab would not draw it. The
   * strip moves to Features unless it already shows every feature.
   */
  const onCreated = useCallback(
    (feature: Feature, startConversation: boolean) => {
      patchViewStateWith((current) =>
        current.scope === ALL_SCOPE_KEY || current.scope === FEATURES_SCOPE_KEY
          ? current
          : { ...current, scope: FEATURES_SCOPE_KEY },
      );
      reveal(feature.id);
      if (startConversation) setPendingCompose(feature.id);
    },
    [patchViewStateWith, reveal],
  );

  const workspaceHandlers: Pick<
    TreeRowHandlers,
    | "featureOfWorkspace"
    | "onRevealFeature"
    | "onAdoptWorkspace"
    | "adoptableFeatures"
    | "onPromoteWorkspace"
    | "onActivateOrphanWorktree"
  > = useMemo(
    () => ({
      featureOfWorkspace: (ref) => {
        const feature = featureOfWorkspace({
          features: active,
          adoptions: api.adoptions,
          environmentId: ref.environmentId,
          path: ref.path,
        });
        if (feature === null) return null;
        return {
          id: feature.id,
          name: feature.name,
          byPath: featureForPath(active, ref.path) !== null,
        };
      },
      onRevealFeature: reveal,
      onAdoptWorkspace: (environmentId, featureId) => void adopt(environmentId, featureId),
      adoptableFeatures: active.map((feature) => ({ id: feature.id, name: feature.name })),
      onPromoteWorkspace: (source) =>
        openDialog({ kind: "promote", ...source }),
      onActivateOrphanWorktree: (target) => {
        void rpc
          .call("activateOrphanWorktree", target)
          .then((outcome) => {
            if (outcome.threadId) {
              navigate.toThread(outcome.threadId);
            } else {
              toast.success("Workspace registered with BB.");
            }
          })
          .catch((error: unknown) =>
            toast.error(
              error instanceof Error
                ? error.message
                : "Could not activate orphan worktree.",
            ),
          );
      },
    }),
    [active, adopt, api.adoptions, navigate, openDialog, reveal, rpc],
  );

  const rowActions: FeatureRowActions = useMemo(
    () => ({
      newThreadBlocker: compose.blocker,
      onNewThread: compose.open,
      onRepositories: (featureId) => openDialog({ kind: "repositories", featureId }),
      onRequirement: (featureId, tab) =>
        openDialog({
          kind: "requirement",
          featureId,
          ...(tab === undefined ? {} : { tab }),
        }),
      onRename: (featureId) => openDialog({ kind: "rename", featureId }),
      onPark: (featureId) => openDialog({ kind: "park", featureId }),
      onFinish: (featureId) => openDialog({ kind: "finish", featureId }),
      onDelete: (featureId) => openDialog({ kind: "delete", featureId }),
    }),
    [compose.blocker, compose.open, openDialog],
  );

  return {
    repositoryProjects,
    projectPaths,
    workspaceHandlers,
    rowActions,
    onCreated,
    onCreate: () => openDialog({ kind: "create" }),
    onUnpark: (featureId: string) => void unpark(featureId),
    onReopen: (featureId: string) => void reopen(featureId),
  };
}
