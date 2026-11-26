import { useEffect, useMemo, useState } from "react";

import type {
  TreeActions,
  TreeLiveState,
} from "@/components/inbox/tree-row-types";
import type { InboxActions } from "@/hooks/use-inbox-actions";
import type { useInboxSources } from "@/hooks/use-inbox-sources";
import type { useInboxTreeModel } from "@/hooks/use-inbox-tree-model";
import type { useReorder } from "@/hooks/use-reorder";
import type { useFeatureSurface } from "@/hooks/use-feature-surface";
import type { RootSelectionIntent } from "@/lib/domain/thread-management";
import { SIDEBAR_ANNOUNCEMENT_EVENT } from "@/lib/ui/clipboard";

/**
 * Splits inbox context assembly into stable actions (`TreeActions`) and
 * frequently-updating live state (`TreeLiveState`), plus sidebar announcement state.
 */
export function useInboxTreeContexts({
  sources,
  treeModel,
  featureSurface,
  reorder,
  inboxActions,
  selectionMode,
  selectedRootIds,
  selectionHintId,
  onToggleRoot,
  onNavigate,
  activeThreadId,
  now,
}: {
  readonly sources: ReturnType<typeof useInboxSources>;
  readonly treeModel: ReturnType<typeof useInboxTreeModel>;
  readonly featureSurface: ReturnType<typeof useFeatureSurface>;
  readonly reorder: ReturnType<typeof useReorder>;
  readonly inboxActions: InboxActions;
  readonly selectionMode: boolean;
  readonly selectedRootIds: ReadonlySet<string>;
  readonly selectionHintId: string;
  readonly onToggleRoot: (threadId: string, intent: RootSelectionIntent) => void;
  readonly onNavigate: () => void;
  readonly activeThreadId: string | null;
  readonly now: number;
}) {
  const [sidebarAnnouncement, setSidebarAnnouncement] = useState("");
  useEffect(() => {
    const onAnnounce = (event: Event) => {
      if (event instanceof CustomEvent && typeof event.detail === "string") {
        setSidebarAnnouncement(event.detail);
      }
    };
    window.addEventListener(SIDEBAR_ANNOUNCEMENT_EVENT, onAnnounce);
    return () => window.removeEventListener(SIDEBAR_ANNOUNCEMENT_EVENT, onAnnounce);
  }, []);

  const projectReorder = useMemo(
    () => ({
      enabled: reorder.projectReorderEnabled,
      next: reorder.reorderProjectByKeyboard,
      drop: (sourceProjectId: string, targetProjectId: string, position: "before" | "after") =>
        reorder.reorderProjectByDrag({ sourceProjectId, targetProjectId, position }),
    }),
    [reorder.projectReorderEnabled, reorder.reorderProjectByKeyboard, reorder.reorderProjectByDrag],
  );

  const treeActions: TreeActions = useMemo(
    () => ({
      firstLevel: treeModel.firstLevel,
      providerInfoById: sources.providerInfoById,
      hostNameById: treeModel.hostNameById,
      repoByProject: treeModel.repoByProject,
      preferences: sources.preferences,
      onNavigate,
      selectionHintId,
      onToggleRoot,
      onNewThreadInWorkspace: sources.newThread.seedFromWorkspace,
      reorderEnabled: reorder.reorderEnabled,
      reorderDisabledReason: reorder.familyReorderDisabledReason,
      onReorder: reorder.reorderByDrag,
      onKeyboardMove: reorder.reorderByKeyboard,
      pinnedReorderEnabled: reorder.pinnedReorderEnabled,
      pinnedReorderDisabledReason: reorder.pinnedReorderDisabledReason,
      onPinnedKeyboardMove: treeModel.reorderPinnedByKeyboard,
      workspaceReorderEnabled: reorder.workspaceReorderEnabled,
      workspaceReorderDisabledReason: reorder.workspaceReorderDisabledReason,
      onWorkspaceReorder: reorder.reorderWorkspaceByDrag,
      onWorkspaceKeyboardMove: reorder.reorderWorkspaceByKeyboard,
      onUnarchiveArchived: treeModel.archived.unarchive,
      onGroupMove: inboxActions.moveGroup,
      onRenameGroup: inboxActions.renameGroup,
      onRemoveGroup: inboxActions.removeGroup,
      onRenameWorktree: inboxActions.renameWorktree,
      ...featureSurface.workspaceHandlers,
    }),
    [
      treeModel.firstLevel,
      sources.providerInfoById,
      treeModel.hostNameById,
      treeModel.repoByProject,
      sources.preferences,
      onNavigate,
      selectionHintId,
      onToggleRoot,
      sources.newThread.seedFromWorkspace,
      reorder.reorderEnabled,
      reorder.familyReorderDisabledReason,
      reorder.reorderByDrag,
      reorder.reorderByKeyboard,
      reorder.pinnedReorderEnabled,
      reorder.pinnedReorderDisabledReason,
      treeModel.reorderPinnedByKeyboard,
      reorder.workspaceReorderEnabled,
      reorder.workspaceReorderDisabledReason,
      reorder.reorderWorkspaceByDrag,
      reorder.reorderWorkspaceByKeyboard,
      treeModel.archived.unarchive,
      inboxActions.moveGroup,
      inboxActions.renameGroup,
      inboxActions.removeGroup,
      inboxActions.renameWorktree,
      featureSurface.workspaceHandlers,
    ],
  );

  const treeLiveState: TreeLiveState = useMemo(
    () => ({
      activeThreadId,
      activeWorkspaceKey: treeModel.activeWorkspaceKey,
      activeFeatureId: treeModel.activeFeatureId,
      searching: treeModel.searching,
      forceExpanded: treeModel.searching,
      now,
      lifecycle: sources.lifecycle,
      paths: sources.paths,
      pullRequests: sources.pullRequests,
      workspaceChanges: treeModel.workspaceChanges,
      selectionMode,
      selectedRootIds,
      archivedByProject: treeModel.archived.byProject,
    }),
    [
      activeThreadId,
      treeModel.activeWorkspaceKey,
      treeModel.activeFeatureId,
      treeModel.searching,
      now,
      sources.lifecycle,
      sources.paths,
      sources.pullRequests,
      treeModel.workspaceChanges,
      selectionMode,
      selectedRootIds,
      treeModel.archived.byProject,
    ],
  );

  return { sidebarAnnouncement, projectReorder, treeActions, treeLiveState };
}
