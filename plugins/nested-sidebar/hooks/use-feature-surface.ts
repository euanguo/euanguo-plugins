import { useCallback, useEffect, useMemo, useState } from "react";
import type { PluginSidebarProject } from "@get-bb/plugin-sdk/app";

import type { FeatureDialogState } from "@/components/inbox/feature-dialogs";
import type { FeatureRowActions } from "@/components/inbox/feature-node";
import type { TreeRowHandlers } from "@/components/inbox/tree-row-types";
import type { NestViewStateApi } from "@/components/inbox/view-state-context";
import { useFeatureCompose } from "@/hooks/use-feature-compose";
import type { FeaturesApi } from "@/hooks/use-features";
import type { NewThreadApi } from "@/hooks/use-new-thread";
import { announceToSidebar } from "@/lib/clipboard";
import {
  effectiveFeatureGroup,
  featureForPath,
  featureOfWorkspace,
  type Feature,
} from "@/lib/features";
import type { ProjectGroup } from "@/lib/groups";
import type { OrganizationMode } from "@/lib/organization";
import { ALL_SCOPE_KEY, UNGROUPED_SCOPE_KEY } from "@/lib/view-state";

/** How long a just-created feature waits for its first read before giving up on opening. */
const PENDING_COMPOSE_TIMEOUT_MS = 15_000;

/**
 * Everything the inbox needs to draw and act on features, in one place.
 *
 * Three surfaces share it: the feature view's rows, the worktree rows of the
 * project view (their pill and their menu), and the dialogs. Keeping the
 * decisions here — which feature a worktree is in, what revealing a feature
 * means, what happens after one is created — is what keeps those three
 * agreeing.
 */
export function useFeatureSurface(input: {
  readonly api: FeaturesApi;
  readonly newThread: NewThreadApi;
  readonly projects: readonly PluginSidebarProject[];
  readonly groups: readonly ProjectGroup[];
  readonly projectPaths: ReadonlyMap<string, string | null>;
  readonly viewState: NestViewStateApi;
  readonly scopeKey: string;
  readonly setScopeKey: (key: string) => void;
  readonly setOrganizationMode: (mode: OrganizationMode) => void;
  readonly openDialog: (state: FeatureDialogState) => void;
}) {
  const {
    api,
    newThread,
    projects,
    groups,
    projectPaths,
    viewState,
    scopeKey,
    setScopeKey,
    setOrganizationMode,
    openDialog,
  } = input;
  const compose = useFeatureCompose({ features: api, newThread, projects });
  const { adopt, setGroup, reopen } = api;
  const active = useMemo(
    () => api.features.filter((feature) => feature.state === "active"),
    [api.features],
  );

  /** The repositories a feature can hold: everything but personal projects and the Features projects. */
  const repositoryProjects = useMemo(() => {
    const homes = new Set(Object.values(api.homeProjects));
    return projects.filter((project) => !project.isPersonal && !homes.has(project.id));
  }, [api.homeProjects, projects]);

  const [pendingReveal, setPendingReveal] = useState<string | null>(null);
  const reveal = useCallback(
    (featureId: string) => {
      const feature = api.byId.get(featureId);
      setOrganizationMode("feature");
      const groupId =
        feature === undefined
          ? null
          : effectiveFeatureGroup(feature, new Set(groups.map((group) => group.id)));
      const groupKey = groupId ?? UNGROUPED_SCOPE_KEY;
      if (scopeKey !== ALL_SCOPE_KEY && scopeKey !== groupKey) setScopeKey(groupKey);
      viewState.setGroupCollapsed(groupKey, false);
      viewState.setProjectCollapsed(featureId, false);
      setPendingReveal(featureId);
    },
    [api.byId, groups, scopeKey, setOrganizationMode, setScopeKey, viewState],
  );

  // Scroll the feature into view once it is drawn. A few frames at most: the
  // mode switch and the expansion land on the next render, not this one.
  useEffect(() => {
    if (pendingReveal === null) return;
    let frames = 0;
    let handle = 0;
    const step = () => {
      const element = document.querySelector(`[data-nest-feature="${CSS.escape(pendingReveal)}"]`);
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

  const onCreated = useCallback(
    (feature: Feature, startConversation: boolean) => {
      reveal(feature.id);
      if (startConversation) setPendingCompose(feature.id);
    },
    [reveal],
  );

  const workspaceHandlers: Pick<
    TreeRowHandlers,
    "featureOfWorkspace" | "onRevealFeature" | "onAdoptWorkspace" | "adoptableFeatures"
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
    }),
    [active, adopt, api.adoptions, reveal],
  );

  const rowActions: FeatureRowActions = useMemo(
    () => ({
      groups,
      newThreadBlocker: compose.blocker,
      onNewThread: compose.open,
      onRepositories: (featureId) => openDialog({ kind: "repositories", featureId }),
      onRename: (featureId) => openDialog({ kind: "rename", featureId }),
      onSetGroup: (featureId, groupId) => void setGroup(featureId, groupId),
      onFinish: (featureId) => openDialog({ kind: "finish", featureId }),
      onDelete: (featureId) => openDialog({ kind: "delete", featureId }),
    }),
    [compose.blocker, compose.open, groups, openDialog, setGroup],
  );

  return {
    repositoryProjects,
    projectPaths,
    workspaceHandlers,
    rowActions,
    onCreated,
    onCreate: () => openDialog({ kind: "create" }),
    onReopen: (featureId: string) => void reopen(featureId),
  };
}
