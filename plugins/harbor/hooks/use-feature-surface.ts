import { useCallback, useEffect, useMemo, useState } from "react";
import {
  experimental_useAppPanel as useAppPanel,
  useBbNavigate,
  useRpc,
  type PluginSidebarProject,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";

import {
  featureNewChatSubPath,
  NEW_CHAT_PANEL_PATH,
} from "@/app/new-chat/route";
import {
  FEATURE_HUB_TAB_REF,
  type FeatureHubSection,
} from "@/components/feature-hub/hub-tab-ref";
import type { FeatureDialogState } from "@/components/inbox/feature-dialogs";
import type { FeatureRowActions } from "@/components/inbox/feature-node";
import type { TreeActions } from "@/components/inbox/tree-row-types";
import { useFeatureCompose } from "@/hooks/use-feature-compose";
import type { FeaturesApi } from "@/hooks/use-features";
import type { HarborViewState } from "@/lib/ui/view-state";
import {
  featureForPath,
  featureOfWorkspace,
  isFeatureRoot,
  type Feature,
} from "@/lib/domain/features";
import { featureOpenTarget } from "@/lib/domain/feature-view";
import { threadFamilies } from "@/lib/domain/inbox";
import { rollupThreads } from "@/lib/domain/rollup";
import type { WorkspaceIndex } from "@/lib/domain/workspace-index";
import {
  featureLastActiveKey,
  lastActiveFor,
  recordLastActive,
} from "@/lib/ui/last-active";
import type { harborRpcContract } from "@/server/contract";

const HUB_PANEL_RETRY_MS = 50;
const HUB_PANEL_MAX_RETRIES = 10;

interface PendingHubOpen {
  readonly featureId: string;
  readonly threadId: string;
  readonly section: FeatureHubSection;
  readonly directory: string | null;
}

/**
 * Everything the inbox needs to draw and act on features, in one place.
 *
 * Feature clicks resolve straight to the best conversation (`openFeature`),
 * `+` routes directly to the full-screen `NewChatPage` targeted at the
 * feature root folder, and opening Feature Hub prefers the non-blocking right
 * app-panel tab whenever the feature already has a thread.
 */
export function useFeatureSurface(input: {
  readonly api: FeaturesApi;
  readonly projects: readonly PluginSidebarProject[];
  readonly projectPaths: ReadonlyMap<string, string | null>;
  readonly threads: readonly PluginSidebarThread[];
  readonly workspaceIndex: WorkspaceIndex;
  readonly activeThreadId: string | null;
  readonly activeFeatureId: string | null;
  readonly now: number;
  readonly openThread: (threadId: string) => void;
  readonly onNavigate: () => void;
  readonly patchViewStateWith: (
    update: (current: HarborViewState) => HarborViewState,
  ) => void;
  readonly openDialog: (state: FeatureDialogState) => void;
}) {
  const {
    api,
    projects,
    projectPaths,
    threads,
    workspaceIndex,
    activeThreadId,
    activeFeatureId,
    now,
    openThread,
    onNavigate,
    patchViewStateWith,
    openDialog,
  } = input;
  const compose = useFeatureCompose({ features: api, onNavigate });
  const rpc = useRpc<typeof harborRpcContract>();
  const navigate = useBbNavigate();
  const panel = useAppPanel();
  const { adopt, reopen, unpark } = api;
  const active = useMemo(
    () => api.features.filter((feature) => feature.state !== "archived"),
    [api.features],
  );

  /** Remember the most recent conversation opened anywhere inside each feature. */
  useEffect(() => {
    if (activeThreadId !== null && activeFeatureId !== null) {
      recordLastActive(featureLastActiveKey(activeFeatureId), activeThreadId);
    }
  }, [activeFeatureId, activeThreadId]);

  /** The repositories a feature can hold: everything but personal projects and the Features projects. */
  const repositoryProjects = useMemo(() => {
    const homes = new Set(Object.values(api.homeProjects));
    return projects.filter(
      (project) => !project.isPersonal && !homes.has(project.id),
    );
  }, [api.homeProjects, projects]);

  /**
   * Switch to the Features surface and scroll to a feature without forcing
   * its child workspace rows open (feature root stays collapsed by default).
   */
  const [pendingReveal, setPendingReveal] = useState<string | null>(null);
  const reveal = useCallback(
    (featureId: string) => {
      const targetFeature = api.byId.get(featureId);
      const needsParkedShelf = targetFeature?.state === "parked";
      patchViewStateWith((current) => ({
        ...current,
        surface: "features",
        featureFilter: "all",
        collapsedProjects: current.collapsedProjects.filter(
          (id) => id !== featureId,
        ),
        parkedFeaturesOpen: needsParkedShelf ? true : current.parkedFeaturesOpen,
      }));
      setPendingReveal(featureId);
    },
    [api.byId, patchViewStateWith],
  );

  // Scroll the feature into view once it is drawn.
  useEffect(() => {
    if (pendingReveal === null) return;
    let frames = 0;
    let handle = 0;
    const step = () => {
      const escaped = CSS.escape(pendingReveal);
      const element =
        document.querySelector(`[data-harbor-feature="${escaped}"]`) ??
        document.querySelector(`[data-harbor-parked-feature="${escaped}"]`);
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

  /** Switch to Features and optionally go straight to the full-screen NewChatPage. */
  const onCreated = useCallback(
    (feature: Feature, startConversation: boolean) => {
      reveal(feature.id);
      if (startConversation) {
        navigate.toPluginPanel(NEW_CHAT_PANEL_PATH, {
          subPath: featureNewChatSubPath(feature.id),
        });
        onNavigate();
      }
    },
    [navigate, onNavigate, reveal],
  );

  const resolveFeatureTarget = useCallback(
    (featureId: string) => {
      const feature = api.byId.get(featureId) ?? null;
      const featureWorkspaces = workspaceIndex.byFeature.get(featureId) ?? [];
      const rootWorkspace =
        feature === null
          ? null
          : (featureWorkspaces.find((ws) => isFeatureRoot(feature, ws.path)) ??
            null);
      const liveThreads = threads.filter(
        (thread) =>
          !thread.isArchived &&
          workspaceIndex.workspaceOfThread(thread)?.featureId === featureId,
      );
      const families = threadFamilies(liveThreads, () => featureId);
      const rootFamilies = families.filter((family) => {
        if (feature === null) return false;
        const ws = workspaceIndex.workspaceOfThread(family.root);
        return ws !== null && isFeatureRoot(feature, ws.path);
      });
      const rootFamilyIds = new Set(rootFamilies.map((f) => f.root.id));
      const memberFamilies = families.filter(
        (family) => !rootFamilyIds.has(family.root.id),
      );
      const allThreads = families.flatMap((f) => [f.root, ...f.children]);
      const rollup = rollupThreads(allThreads, now);
      const candidateKeys = [
        featureLastActiveKey(featureId),
        ...(rootWorkspace ? [rootWorkspace.key] : []),
        ...featureWorkspaces
          .filter((ws) => ws !== rootWorkspace)
          .map((ws) => ws.key),
      ];
      const lastActiveThreadId =
        candidateKeys.map((key) => lastActiveFor(key)).find((id) => id !== null) ??
        null;

      return featureOpenTarget({
        featureId,
        rollup,
        rootFamilies,
        memberFamilies,
        lastActiveThreadId,
      });
    },
    [api.byId, now, threads, workspaceIndex],
  );

  const openFeature = useCallback(
    (featureId: string) => {
      const target = resolveFeatureTarget(featureId);
      if (target.kind === "thread") {
        openThread(target.threadId);
        onNavigate();
        return;
      }
      navigate.toPluginPanel(NEW_CHAT_PANEL_PATH, {
        subPath: featureNewChatSubPath(target.featureId),
      });
      onNavigate();
    },
    [navigate, onNavigate, openThread, resolveFeatureTarget],
  );

  const [pendingHubOpen, setPendingHubOpen] = useState<PendingHubOpen | null>(null);

  useEffect(() => {
    if (pendingHubOpen === null) return;
    if (activeThreadId !== pendingHubOpen.threadId) return;

    let cancelled = false;
    let attempts = 0;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const tryOpenTab = () => {
      if (cancelled) return;
      const accepted = panel.openTab({
        tab: FEATURE_HUB_TAB_REF,
        target: {
          section: pendingHubOpen.section,
          directory: pendingHubOpen.directory,
        },
      });
      if (accepted) {
        setPendingHubOpen(null);
        return;
      }
      attempts += 1;
      if (attempts >= HUB_PANEL_MAX_RETRIES) {
        setPendingHubOpen(null);
        openDialog({
          kind: "hub",
          featureId: pendingHubOpen.featureId,
          section: pendingHubOpen.section,
          directory: pendingHubOpen.directory,
        });
        return;
      }
      timerId = setTimeout(tryOpenTab, HUB_PANEL_RETRY_MS);
    };

    tryOpenTab();
    return () => {
      cancelled = true;
      if (timerId !== null) clearTimeout(timerId);
    };
  }, [activeThreadId, openDialog, panel, pendingHubOpen]);

  const openHub = useCallback(
    (
      featureId: string,
      section: FeatureHubSection = "overview",
      directory: string | null = null,
    ) => {
      if (activeFeatureId === featureId) {
        setPendingHubOpen(null);
        const accepted = panel.openTab({
          tab: FEATURE_HUB_TAB_REF,
          target: { section, directory },
        });
        if (!accepted) {
          openDialog({ kind: "hub", featureId, section, directory });
        }
        return;
      }

      const target = resolveFeatureTarget(featureId);
      if (target.kind === "thread") {
        setPendingHubOpen({
          featureId,
          threadId: target.threadId,
          section,
          directory,
        });
        openThread(target.threadId);
        onNavigate();
        return;
      }

      setPendingHubOpen(null);
      openDialog({ kind: "hub", featureId, section, directory });
    },
    [
      activeFeatureId,
      onNavigate,
      openDialog,
      openThread,
      panel,
      resolveFeatureTarget,
    ],
  );

  const workspaceHandlers: Pick<
    TreeActions,
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
      onAdoptWorkspace: (environmentId, featureId) =>
        void adopt(environmentId, featureId),
      adoptableFeatures: active.map((feature) => ({
        id: feature.id,
        name: feature.name,
      })),
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
      onOpenFeature: openFeature,
      onOpenHub: openHub,
      onRename: (featureId) => openDialog({ kind: "rename", featureId }),
      onPark: (featureId) => openDialog({ kind: "park", featureId }),
      onFinish: (featureId) => openDialog({ kind: "finish", featureId }),
      onDelete: (featureId) => openDialog({ kind: "delete", featureId }),
    }),
    [compose.blocker, compose.open, openDialog, openFeature, openHub],
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
