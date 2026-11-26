import { type DragEvent, type KeyboardEvent, useRef, useState } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";

import { NEW_CHAT_PANEL_PATH } from "@/app/new-chat/route";
import {
  clearDropIndicator,
  setDropIndicator,
} from "@/components/inbox/drop-indicator";
import { buildWorkspaceHoverPreview } from "@/components/inbox/hover-preview-builders";
import {
  useTreeActions,
  useTreeLiveState,
} from "@/components/inbox/tree-row-handlers-context";
import { useHarborViewState } from "@/components/inbox/view-state-context";
import { useWorkspaceRowMenuModel } from "@/components/inbox/workspace-row-menu";
import { usePointerCoarse } from "@/components/ui/hooks/use-pointer-coarse";
import { useThreadActions } from "@/hooks/use-thread-actions";
import { lastActiveFor } from "@/lib/ui/last-active";
import { workspaceExpansionKeys } from "@/lib/ui/view-state";
import { changeCountFor } from "@/lib/ui/workspace-change-counts";
import type { WorkspaceNode } from "@/lib/domain/tree";
import { workspaceRowLabel } from "@/lib/domain/workspace";
import type { Workspace } from "@/lib/domain/workspace-index";
import { workspaceGlyphKind, workspaceOpenTarget } from "@/lib/domain/workspace-view";

const WORKSPACE_DRAG_TYPE = "application/x-harbor-workspace";

function parseDraggedWorkspace(
  raw: string,
): { projectId: string; workspaceKey: string } | null {
  if (raw.length === 0 || raw.length > 500) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("projectId" in parsed) ||
      !("workspaceKey" in parsed) ||
      typeof parsed.projectId !== "string" ||
      typeof parsed.workspaceKey !== "string"
    ) {
      return null;
    }
    return {
      projectId: parsed.projectId,
      workspaceKey: parsed.workspaceKey,
    };
  } catch {
    return null;
  }
}

export function useWorkspaceRow({
  node,
  projectId,
  projectName,
  variant,
}: {
  node: WorkspaceNode;
  projectId: string;
  projectName: string;
  variant: "card" | "group";
}) {
  const treeActions = useTreeActions();
  const live = useTreeLiveState();
  const navigate = useBbNavigate();
  const actions = useThreadActions();
  const viewState = useHarborViewState();
  const coarse = usePointerCoarse();
  const [renaming, setRenaming] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const dragStarted = useRef(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const renameInput = useRef<HTMLInputElement>(null);

  const ref = node.ref as Workspace;
  const expanded =
    variant === "group" &&
    (viewState.isWorkspaceExpanded(ref.key) ||
      ref.environmentIds.some((id) => viewState.isWorkspaceExpanded(id)));
  const setExpanded = (open: boolean) =>
    viewState.setWorkspaceFolded({
      keys: workspaceExpansionKeys(ref),
      openKey: ref.key,
      expanded: open,
    });

  const canReorder =
    treeActions.workspaceReorderEnabled && ref.kind === "git-worktree" && !coarse;
  const canRename = ref.environmentId !== null && ref.kind !== "unresolved";
  const canRemove = ref.environmentId !== null && ref.kind === "git-worktree";
  const threadCount = node.families.reduce(
    (total, family) => total + 1 + family.children.length,
    0,
  );
  const rowLabel = workspaceRowLabel(ref, treeActions.preferences.worktreeLabel);
  const path =
    ref.environmentId === null
      ? ref.path
      : (live.paths.environments[ref.environmentId]?.path ?? ref.path);
  const active =
    variant === "card" &&
    live.activeWorkspaceKey !== null &&
    live.activeWorkspaceKey === ref.key;
  const pullRequest =
    ref.environmentIds
      .map((id) => live.pullRequests.get(id))
      .find((entry) => entry !== undefined) ?? null;
  const changes = changeCountFor(live.workspaceChanges, ref.environmentIds);
  const glyphKind = workspaceGlyphKind({
    rollupKind: node.rollup.kind,
    hasPullRequest: pullRequest !== null,
  });

  const latestThreadUpdatedAt = node.families.reduce<number | null>(
    (latest, family) => {
      let next =
        latest === null
          ? family.root.updatedAt
          : Math.max(latest, family.root.updatedAt);
      for (const child of family.children) {
        next = Math.max(next, child.updatedAt);
      }
      return next;
    },
    null,
  );

  const repoInfo = treeActions.repoByProject?.get(projectId);
  const hostName =
    ref.hostId === null ? null : (treeActions.hostNameById?.get(ref.hostId) ?? null);
  const preview = buildWorkspaceHoverPreview({
    title: rowLabel.label,
    ref,
    projectName,
    path,
    changes,
    pullRequest,
    threadCount,
    latestThreadUpdatedAt,
    now: live.now,
  });

  const workspaceMenu = useWorkspaceRowMenuModel({
    label: variant === "card" ? rowLabel.label : ref.label,
    node,
    projectId,
    projectName,
    branch: ref.branch,
    path,
    expanded,
    disclosable: variant === "group",
    canRename,
    canRemove,
    threadCount,
    repoKey: ref.repoKey ?? repoInfo?.repoKey ?? null,
    remoteUrl: repoInfo?.remoteUrl ?? null,
    hostName,
    onToggleExpanded:
      variant === "group" ? () => setExpanded(!expanded) : () => undefined,
    onRename: () => setRenaming(true),
    onArchiving: () => setArchiving(true),
    onRemoving: () => setRemoving(true),
  });

  const activateOrphan = () => {
    if (ref.path !== null && ref.hostId !== null) {
      treeActions.onActivateOrphanWorktree?.({
        hostId: ref.hostId,
        projectId,
        path: ref.path,
        branch: ref.branch,
      });
    }
  };

  const openCard = () => {
    const target = workspaceOpenTarget({
      rollup: node.rollup,
      families: node.families,
      lastActiveThreadId: lastActiveFor(ref.key),
    });
    if (target.kind === "thread") {
      actions.open(target.threadId);
      treeActions.onNavigate();
      return;
    }
    if (ref.canonicalEnvironmentId !== null) {
      navigate.toPluginPanel(NEW_CHAT_PANEL_PATH, {
        subPath: ref.canonicalEnvironmentId,
      });
      return;
    }
    if (ref.unseen) activateOrphan();
  };

  const onSectionDragOver = (event: DragEvent<HTMLElement>) => {
    if (!canReorder) return;
    if (!event.dataTransfer.types.includes(WORKSPACE_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const bounds = (rowRef.current ?? event.currentTarget).getBoundingClientRect();
    setDropIndicator(
      "workspace",
      event.currentTarget,
      event.clientY >= bounds.top + bounds.height / 2 ? "after" : "before",
    );
  };

  const onSectionDrop = (event: DragEvent<HTMLElement>) => {
    clearDropIndicator("workspace");
    if (!canReorder) return;
    const raw = event.dataTransfer.getData(WORKSPACE_DRAG_TYPE);
    if (raw.length === 0) return;
    const dragged = parseDraggedWorkspace(raw);
    if (dragged === null) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = (rowRef.current ?? event.currentTarget).getBoundingClientRect();
    treeActions.onWorkspaceReorder({
      sourceProjectId: dragged.projectId,
      sourceKey: dragged.workspaceKey,
      targetProjectId: projectId,
      targetKey: ref.key,
      position:
        event.clientY >= bounds.top + bounds.height / 2 ? "after" : "before",
    });
  };

  const onButtonDragStart = (event: DragEvent<HTMLButtonElement>) => {
    if (!canReorder) {
      event.preventDefault();
      return;
    }
    dragStarted.current = true;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(
      WORKSPACE_DRAG_TYPE,
      JSON.stringify({ projectId, workspaceKey: ref.key }),
    );
  };

  const onButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!event.altKey || !canReorder) return;
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    treeActions.onWorkspaceKeyboardMove(
      projectId,
      ref.key,
      event.key === "ArrowUp" ? -1 : 1,
    );
  };

  return {
    actions,
    active,
    activateOrphan,
    archiving,
    canReorder,
    changes,
    dragStarted,
    expanded,
    glyphKind,
    live,
    navigate,
    onButtonDragStart,
    onButtonKeyDown,
    onSectionDragOver,
    onSectionDrop,
    openCard,
    preview,
    pullRequest,
    ref,
    removing,
    renameInput,
    renaming,
    rowLabel,
    rowRef,
    setArchiving,
    setExpanded,
    setRemoving,
    setRenaming,
    stacked: variant === "group" && rowLabel.detail !== null && rowLabel.stacked,
    threadCount,
    treeActions,
    workspaceMenu,
  };
}
