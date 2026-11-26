import { memo, useId, useRef, useState } from "react";

import {
  clearDropIndicator,
  setDropIndicator,
} from "@/components/inbox/drop-indicator";
import { buildWorkspaceHoverPreview } from "@/components/inbox/hover-preview-builders";
import { FamilyRow } from "@/components/inbox/family-row";
import { PageControls } from "@/components/inbox/page-controls";
import { RemoveWorktreeDialog } from "@/components/inbox/remove-worktree-dialog";
import {
  RowActionButton,
  RowActions,
  RowDisclosure,
} from "@/components/inbox/row-actions";
import { RowMenu, RowMenuButton } from "@/components/inbox/row-context-menu";
import { RollupJump } from "@/components/inbox/rollup-badge";
import { useTreeRowHandlers } from "@/components/inbox/tree-row-handlers-context";
import { ArchiveWorkspaceDialog } from "@/components/inbox/workspace-dialogs";
import { parseDraggedWorkspace } from "@/components/inbox/workspace-drag";
import { WorkspaceNameField } from "@/components/inbox/workspace-name-field";
import { useWorkspaceRowMenuModel } from "@/components/inbox/workspace-row-menu";
import { useHarborViewState } from "@/components/inbox/view-state-context";
import { Icon } from "@/components/ui/icon";
import { usePointerCoarse } from "@/components/ui/hooks/use-pointer-coarse";
import { InfoCard } from "@/components/ui/hover-card";
import { useListAutoAnimate } from "@/hooks/use-list-auto-animate";
import { usePagedRows } from "@/hooks/use-paged-rows";
import { useThreadActions } from "@/hooks/use-thread-actions";
import { renameIntent } from "@/lib/domain/groups";
import { visibleRows } from "@/lib/domain/paging";
import type { WorkspaceNode } from "@/lib/domain/tree";
import { cn } from "@/lib/ui/utils";
import { workspaceExpansionKeys } from "@/lib/ui/view-state";
import { workspaceRowLabel } from "@/lib/domain/workspace";
import type { Workspace } from "@/lib/domain/workspace-index";
import { changeCountFor } from "@/lib/ui/workspace-change-counts";

const EMPTY_WORKSPACE_CLASS =
  "ml-4 py-1 pl-3 text-2xs text-muted-foreground";

export const WorkspaceGroup = memo(function WorkspaceGroup({
  node,
  projectId,
  projectName,
  displayPrefix,
  displayLabelOverride,
}: {
  node: WorkspaceNode;
  projectId: string;
  projectName: string;
  displayPrefix?: string;
  displayLabelOverride?: string;
}) {
  const handlers = useTreeRowHandlers();
  const actions = useThreadActions();
  const viewState = useHarborViewState();
  const expanded =
    viewState.isWorkspaceExpanded(node.ref.key) ||
    node.ref.environmentIds.some((id) => viewState.isWorkspaceExpanded(id));
  const setExpanded = (open: boolean) =>
    viewState.setWorkspaceFolded({
      keys: workspaceExpansionKeys(node.ref),
      openKey: node.ref.key,
      expanded: open,
    });
  const [renaming, setRenaming] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const dragStarted = useRef(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const coarse = usePointerCoarse();
  const canReorder =
    handlers.workspaceReorderEnabled &&
    node.ref.kind === "git-worktree" &&
    !coarse;
  const canRename =
    node.ref.environmentId !== null && node.ref.kind !== "unresolved";
  const canRemove =
    node.ref.environmentId !== null && node.ref.kind === "git-worktree";
  const listId = useId();
  const attachListAutoAnimateRef = useListAutoAnimate<HTMLUListElement>();
  const renameInput = useRef<HTMLInputElement>(null);
  const threadCount = node.families.reduce(
    (total, family) => total + 1 + family.children.length,
    0,
  );
  const paged = usePagedRows({
    total: node.families.length,
    pageSize: handlers.preferences.pageSize,
    searching: handlers.searching,
  });
  const visibleFamilies = visibleRows(
    node.families,
    paged.visibleCount,
    handlers.activeThreadId,
    (family) => family.root.id,
  );

  const label = node.ref.label;
  const branch = node.ref.branch;
  const alias = node.ref.alias;
  const rowLabel = workspaceRowLabel(
    node.ref,
    handlers.preferences.worktreeLabel,
  );
  const stacked = rowLabel.detail !== null && rowLabel.stacked;
  const path =
    node.ref.environmentId === null
      ? node.ref.path
      : (handlers.paths.environments[node.ref.environmentId]?.path ??
        node.ref.path);
  const ref = node.ref as Workspace;
  const pullRequest =
    ref.environmentIds
      .map((id) => handlers.pullRequests.get(id))
      .find((entry) => entry !== undefined) ?? null;
  const changes = changeCountFor(handlers.workspaceChanges, ref.environmentIds);
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
  const repoInfo = handlers.repoByProject?.get(projectId);
  const hostName =
    ref.hostId === null ? null : (handlers.hostNameById?.get(ref.hostId) ?? null);
  const preview = buildWorkspaceHoverPreview({
    title: rowLabel.label,
    ref,
    projectName,
    path,
    changes,
    pullRequest,
    threadCount,
    latestThreadUpdatedAt,
    now: handlers.now,
  });
  const workspaceMenu = useWorkspaceRowMenuModel({
    label,
    node,
    projectId,
    projectName,
    branch,
    path,
    expanded,
    canRename,
    canRemove,
    threadCount,
    repoKey: ref.repoKey ?? repoInfo?.repoKey ?? null,
    remoteUrl: repoInfo?.remoteUrl ?? null,
    hostName,
    onToggleExpanded: () => setExpanded(!expanded),
    onRename: () => setRenaming(true),
    onArchiving: () => setArchiving(true),
    onRemoving: () => setRemoving(true),
  });
  const showRollup = !expanded || paged.hasMore;
  const workspaceRowActions = (
    <RowActions className="pointer-events-auto">
      {showRollup ? (
        <RollupJump
          rollup={node.rollup}
          onJump={(threadId) => {
            actions.open(threadId);
            handlers.onNavigate();
          }}
          onFallback={() => setExpanded(!expanded)}
        />
      ) : null}
      <RowActionButton
        label={`New thread in ${label}`}
        icon="Plus"
        onClick={() =>
          handlers.onNewThreadInWorkspace({ node, projectId, projectName })
        }
      />
      <RowMenuButton label={`Actions for ${label}`} items={workspaceMenu.items} />
      <RowDisclosure
        label={`${expanded ? "Collapse" : "Expand"} ${label}`}
        expanded={expanded}
        controls={listId}
        onToggle={() => setExpanded(!expanded)}
      />
    </RowActions>
  );

  return (
    <section
      aria-label={node.ref.label}
      onDragOver={(event) => {
        if (!canReorder) return;
        if (
          !event.dataTransfer.types.includes("application/x-harbor-workspace")
        ) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const bounds = (rowRef.current ?? event.currentTarget).getBoundingClientRect();
        setDropIndicator(
          "workspace",
          event.currentTarget,
          event.clientY >= bounds.top + bounds.height / 2 ? "after" : "before",
        );
      }}
      onDrop={(event) => {
        clearDropIndicator("workspace");
        if (!canReorder) return;
        const raw = event.dataTransfer.getData("application/x-harbor-workspace");
        if (raw.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        const dragged = parseDraggedWorkspace(raw);
        if (dragged === null) return;
        const bounds = (rowRef.current ?? event.currentTarget).getBoundingClientRect();
        handlers.onWorkspaceReorder({
          sourceProjectId: dragged.projectId,
          sourceKey: dragged.workspaceKey,
          targetProjectId: projectId,
          targetKey: node.ref.key,
          position:
            event.clientY >= bounds.top + bounds.height / 2
              ? "after"
              : "before",
        });
      }}
    >
      <InfoCard
        trigger={
          <RowMenu
            label={`Actions for ${label}`}
            items={workspaceMenu.items}
            dialog={workspaceMenu.dialog}
          >
            <div
              ref={rowRef}
              className={cn(
                // The full-bleed button below resolves against this element.
                "group/ws relative flex w-full items-center gap-1.5 rounded-md pl-4 pr-1.5 hover:bg-sidebar-accent/50",
                stacked ? "min-h-11 py-1" : "h-7",
              )}
            >
              {renaming && node.ref.environmentId !== null ? (
                <WorkspaceNameField
                  inputRef={renameInput}
                  initial={alias ?? branch ?? ""}
                  fallback={label}
                  ariaLabel={`Rename worktree ${label}`}
                  onCommit={(draft) => {
                    const next = renameIntent(draft, alias ?? "");
                    setRenaming(false);
                    if (next !== null && node.ref.environmentId !== null) {
                      handlers.onRenameWorktree(
                        node.ref.environmentId,
                        next,
                      );
                    }
                  }}
                  onCancel={() => setRenaming(false)}
                />
              ) : (
                <button
                  type="button"
                  draggable={canReorder}
                  aria-expanded={expanded}
                  aria-controls={listId}
                  aria-keyshortcuts={
                    canReorder ? "Alt+ArrowUp Alt+ArrowDown" : undefined
                  }
                  aria-label={`${expanded ? "Collapse" : "Expand"} ${label}. ${canReorder ? "Drag this row to reorder worktrees, or press Alt+Up or Alt+Down." : "Worktree reordering is unavailable."}`}
                  onPointerDown={() => {
                    dragStarted.current = false;
                  }}
                  onClick={(event) => {
                    if (dragStarted.current) {
                      event.preventDefault();
                      return;
                    }
                    setExpanded(!expanded);
                  }}
                  onDragStart={(event) => {
                    if (!canReorder) {
                      event.preventDefault();
                      return;
                    }
                    dragStarted.current = true;
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData(
                      "application/x-harbor-workspace",
                      JSON.stringify({
                        projectId,
                        workspaceKey: node.ref.key,
                      }),
                    );
                  }}
                  onKeyDown={(event) => {
                    if (!event.altKey || !canReorder) return;
                    if (
                      event.key !== "ArrowUp" &&
                      event.key !== "ArrowDown"
                    ) {
                      return;
                    }
                    event.preventDefault();
                    handlers.onWorkspaceKeyboardMove(
                      projectId,
                      node.ref.key,
                      event.key === "ArrowUp" ? -1 : 1,
                    );
                  }}
                  className={cn(
                    "absolute inset-0 rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    canReorder && "cursor-grab active:cursor-grabbing",
                  )}
                />
              )}
              <div
                className={cn(
                  "pointer-events-none relative flex min-w-0 flex-1",
                  stacked ? "flex-col gap-0.5" : "items-center gap-1.5",
                )}
              >
                {stacked ? (
                  <>
                    <span className="min-w-0 max-w-full truncate text-xs text-foreground/80">
                      {displayLabelOverride ??
                        (displayPrefix ? `${displayPrefix} · ${rowLabel.label}` : rowLabel.label)}
                    </span>
                    <span className="flex min-w-0 max-w-full items-center gap-1.5">
                      <span className="flex min-w-0 flex-1 items-center gap-1 truncate">
                        <Icon
                          name={
                            node.ref.kind === "git-worktree"
                              ? "FolderGit"
                              : "GitBranch"
                          }
                          aria-label="Branch"
                          className="size-3 shrink-0 text-muted-foreground/60"
                        />
                        <span className="truncate font-mono text-2xs text-muted-foreground/80">
                          {rowLabel.detail}
                        </span>
                      </span>
                      {workspaceRowActions}
                    </span>
                  </>
                ) : (
                  <>
                    <Icon
                      name={
                        node.ref.kind === "project-checkout"
                          ? "Folder"
                          : node.ref.kind === "git-worktree"
                            ? "GitBranch"
                            : "Folder"
                      }
                      className="size-3 shrink-0 text-muted-foreground/60"
                      aria-hidden
                    />
                    {displayPrefix && !displayLabelOverride ? (
                      <span className="shrink-0 truncate text-xs font-medium text-foreground/85">
                        {displayPrefix}
                        <span className="mx-1 text-muted-foreground/60">·</span>
                      </span>
                    ) : null}
                    <span
                      className={cn(
                        "min-w-0 max-w-full truncate text-xs",
                        rowLabel.labelIsBranch && !displayLabelOverride
                          ? "font-mono text-2xs text-muted-foreground/80"
                          : "text-foreground/80",
                      )}
                    >
                      {displayLabelOverride ?? rowLabel.label}
                    </span>
                    {rowLabel.detail === null || displayLabelOverride ? null : (
                      <span className="min-w-0 max-w-full truncate font-mono text-2xs text-muted-foreground/80">
                        {rowLabel.detail}
                      </span>
                    )}
                    {workspaceRowActions}
                  </>
                )}
              </div>
            </div>
          </RowMenu>
        }
        label={preview.label}
        subtitle={preview.subtitle}
        summary={preview.summary}
        rows={preview.rows}
      />
      {archiving ? (
        <ArchiveWorkspaceDialog
          label={label}
          threadIds={node.families.map((family) => family.root.id)}
          onCancel={() => setArchiving(false)}
          onArchive={() => {
            setArchiving(false);
            for (const family of node.families) actions.archive(family.root.id);
          }}
        />
      ) : null}
      {removing ? (
        <RemoveWorktreeDialog
          open
          environmentId={node.ref.environmentId}
          label={label}
          onClose={() => setRemoving(false)}
        />
      ) : null}
      {node.families.length === 0 ? (
        expanded ? (
          <p id={listId} className={EMPTY_WORKSPACE_CLASS}>
            No threads yet
          </p>
        ) : null
      ) : (
        <>
          <ul
            id={listId}
            ref={attachListAutoAnimateRef}
            className={cn(
              "ml-4 flex flex-col gap-px",
              expanded && "border-l border-sidebar-border pl-3",
            )}
          >
            {expanded
              ? visibleFamilies.map((family) => (
                  <FamilyRow
                    key={family.root.id}
                    family={family}
                    projectId={projectId}
                  />
                ))
              : null}
          </ul>
          {expanded && !handlers.searching && (paged.hasMore || paged.page > 1) ? (
            <PageControls {...paged.controlsProps} className="ml-4" />
          ) : null}
        </>
      )}
    </section>
  );
});
