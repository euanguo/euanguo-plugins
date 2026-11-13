import { useId, useRef, useState } from "react";

import { FamilyRow } from "@/components/inbox/family-row";
import { PageControls } from "@/components/inbox/page-controls";
import { RemoveWorktreeDialog } from "@/components/inbox/remove-worktree-dialog";
import {
  RowActionButton,
  RowActions,
  RowDisclosure,
} from "@/components/inbox/row-actions";
import { RollupJump } from "@/components/inbox/rollup-badge";
import type { TreeRowHandlers } from "@/components/inbox/tree-row-types";
import { ArchiveWorkspaceDialog } from "@/components/inbox/workspace-dialogs";
import { parseDraggedWorkspace } from "@/components/inbox/workspace-drag";
import { WorkspaceNameField } from "@/components/inbox/workspace-name-field";
import { WorkspaceRowMenu } from "@/components/inbox/workspace-row-menu";
import { useNestViewState } from "@/components/inbox/view-state-context";
import { Icon } from "@/components/ui/icon";
import { usePointerCoarse } from "@/components/ui/hooks/use-pointer-coarse";
import { InfoCard, type InfoCardRow } from "@/components/ui/hover-card";
import { useListAutoAnimate } from "@/hooks/use-list-auto-animate";
import { useThreadActions } from "@/hooks/use-thread-actions";
import { renameIntent } from "@/lib/groups";
import {
  hasMoreRows,
  nextPageSize,
  visibleRows,
} from "@/lib/paging";
import type { WorkspaceNode } from "@/lib/tree";
import { cn } from "@/lib/utils";
import { workspaceExpansionKeys } from "@/lib/view-state";
import {
  workspaceRowLabel,
  type WorkspaceKind,
} from "@/lib/workspace";

const EMPTY_WORKSPACE_CLASS =
  "ml-4 py-1 pl-3 text-2xs text-muted-foreground";

export function WorkspaceGroup({
  node,
  projectId,
  projectName,
  handlers,
}: {
  node: WorkspaceNode;
  projectId: string;
  projectName: string;
  handlers: TreeRowHandlers;
}) {
  const actions = useThreadActions();
  const viewState = useNestViewState();
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
  const [familyPages, setFamilyPages] = useState(1);
  const familyLimit =
    (handlers.searching ? Number.MAX_SAFE_INTEGER : familyPages) *
    handlers.preferences.pageSize;
  const visibleFamilies = visibleRows(
    node.families,
    familyLimit,
    handlers.activeThreadId,
    (family) => family.root.id,
  );
  const familyHasMore = hasMoreRows(node.families.length, familyLimit);
  const familyNextPage = nextPageSize(
    node.families.length,
    familyLimit,
    handlers.preferences.pageSize,
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
  const rows: InfoCardRow[] = [
    { label: "Kind", value: workspaceKindLabel(node.ref.kind) },
    { label: "Project", value: projectName },
    { label: "Threads", value: String(threadCount) },
    ...(alias === null ? [] : [{ label: "Alias", value: alias }]),
    ...(branch === null
      ? []
      : [{ label: "Branch", value: branch, mono: true, copy: true }]),
    ...(node.ref.environmentId === null
      ? []
      : [
          {
            label: "Env ID",
            value: node.ref.environmentId,
            mono: true,
            copy: true,
          },
        ]),
    ...(path === null
      ? []
      : [{ label: "Path", value: path, mono: true, copy: true }]),
    ...(node.ref.diagnostic === null
      ? []
      : [{ label: "Diagnostic", value: node.ref.diagnostic }]),
  ];
  const workspaceRowActions = (
    <RowActions className="pointer-events-auto">
      <RollupJump
        rollup={node.rollup}
        onJump={(threadId) => {
          actions.open(threadId);
          handlers.onNavigate();
        }}
        onFallback={() => setExpanded(!expanded)}
      />
      <RowActionButton
        label={`New thread in ${label}`}
        icon="Plus"
        onClick={() =>
          handlers.onNewThreadInWorkspace({ node, projectId, projectName })
        }
      />
      <RowDisclosure
        label={`${expanded ? "Collapse" : "Expand"} ${label}`}
        expanded={expanded}
        controls={listId}
        onToggle={() => setExpanded(!expanded)}
      />
    </RowActions>
  );

  return (
    <section aria-label={node.ref.label}>
      <InfoCard
        trigger={
          <WorkspaceRowMenu
            label={label}
            node={node}
            projectId={projectId}
            projectName={projectName}
            branch={branch}
            path={path}
            expanded={expanded}
            canRename={canRename}
            canRemove={canRemove}
            threadCount={threadCount}
            handlers={handlers}
            onToggleExpanded={() => setExpanded(!expanded)}
            onRename={() => setRenaming(true)}
            onArchiving={() => setArchiving(true)}
            onRemoving={() => setRemoving(true)}
          >
            <div
              className={cn(
                // The full-bleed button below resolves against this element.
                "group/ws relative flex w-full items-center gap-1.5 rounded-md pl-4 pr-1.5 hover:bg-sidebar-accent/50",
                stacked ? "min-h-11 py-1" : "h-7",
              )}
              onDragOver={(event) => {
                if (!canReorder) return;
                if (
                  !event.dataTransfer.types.includes(
                    "application/x-nest-workspace",
                  )
                ) {
                  return;
                }
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDrop={(event) => {
                if (!canReorder) return;
                const raw = event.dataTransfer.getData(
                  "application/x-nest-workspace",
                );
                if (raw.length === 0) return;
                event.preventDefault();
                const dragged = parseDraggedWorkspace(raw);
                if (dragged === null) return;
                const bounds = event.currentTarget.getBoundingClientRect();
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
                      "application/x-nest-workspace",
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
                      {rowLabel.label}
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
                    <span
                      className={cn(
                        "min-w-0 max-w-full truncate text-xs",
                        rowLabel.labelIsBranch
                          ? "font-mono text-2xs text-muted-foreground/80"
                          : "text-foreground/80",
                      )}
                    >
                      {rowLabel.label}
                    </span>
                    {rowLabel.detail === null ? null : (
                      <span className="min-w-0 max-w-full truncate font-mono text-2xs text-muted-foreground/80">
                        {rowLabel.detail}
                      </span>
                    )}
                    {workspaceRowActions}
                  </>
                )}
              </div>
            </div>
          </WorkspaceRowMenu>
        }
        label={label}
        rows={rows}
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
                    handlers={handlers}
                  />
                ))
              : null}
          </ul>
          {expanded &&
          !handlers.searching &&
          (familyHasMore || familyPages > 1) ? (
            <PageControls
              hasMore={familyHasMore}
              remaining={familyNextPage}
              page={familyPages}
              onLoadMore={() => setFamilyPages((pages) => pages + 1)}
              onShowLess={() => setFamilyPages(1)}
              className="ml-4"
            />
          ) : null}
        </>
      )}
    </section>
  );
}

function workspaceKindLabel(kind: WorkspaceKind): string {
  switch (kind) {
    case "project-checkout":
      return "Project checkout";
    case "git-worktree":
      return "Git worktree";
    case "nested-checkout":
      return "Nested checkout";
    case "external-checkout":
      return "External checkout";
    case "external-directory":
      return "External directory";
    case "unresolved":
      return "Unresolved workspace";
    case "personal":
      return "Personal workspace";
  }
}
