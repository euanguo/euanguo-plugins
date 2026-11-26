import { memo, useId } from "react";

import { NEW_CHAT_PANEL_PATH } from "@/app/new-chat/route";
import { FamilyRow } from "@/components/inbox/family-row";
import { FamilyStatusIcon, StatusDot } from "@/components/inbox/family-status";
import { PageControls } from "@/components/inbox/page-controls";
import { RemoveWorktreeDialog } from "@/components/inbox/remove-worktree-dialog";
import {
  RowActionButton,
  RowActions,
  RowDisclosure,
} from "@/components/inbox/row-actions";
import { RowMenu, RowMenuButton } from "@/components/inbox/row-context-menu";
import { RollupJump } from "@/components/inbox/rollup-badge";
import { WorkspaceNameField } from "@/components/inbox/workspace-name-field";
import { Button } from "@/components/ui/button";
import { DialogActions } from "@/components/ui/control";
import { InfoCard } from "@/components/ui/hover-card";
import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/modal";
import { useListAutoAnimate } from "@/hooks/use-list-auto-animate";
import { usePagedRows } from "@/hooks/use-paged-rows";
import { useWorkspaceRow } from "@/hooks/use-workspace-row";
import { familyStatusPresentation } from "@/lib/domain/family-status";
import { renameIntent } from "@/lib/domain/groups";
import { visibleRows } from "@/lib/domain/paging";
import type { WorkspacePullRequest } from "@/lib/domain/pull-request";
import { pullRequestPresentation } from "@/lib/domain/pull-request-presentation";
import type { WorkspaceNode } from "@/lib/domain/tree";
import { formatLineCount } from "@/lib/domain/workspace";
import type { Workspace } from "@/lib/domain/workspace-index";
import { type workspaceGlyphKind, workspaceTypeIcon } from "@/lib/domain/workspace-view";
import { cn } from "@/lib/ui/utils";
import type { WorkspaceChangeCount } from "@/lib/ui/workspace-change-counts";

const EMPTY_WORKSPACE_CLASS = "ml-4 py-1 pl-3 text-2xs text-muted-foreground";

/**
 * Unified workspace row rendered in both sidebar modes:
 * - `variant="card"` (`Workspaces`): compact row opening the best conversation.
 * - `variant="group"` (`Threads`): expandable worktree section above its families.
 */
export const WorkspaceRow = memo(function WorkspaceRow({
  node,
  projectId,
  projectName,
  variant,
  displayPrefix,
  displayLabelOverride,
}: {
  node: WorkspaceNode;
  projectId: string;
  projectName: string;
  variant: "card" | "group";
  displayPrefix?: string;
  displayLabelOverride?: string;
}) {
  const row = useWorkspaceRow({ node, projectId, projectName, variant });
  const listId = useId();
  const attachListAutoAnimateRef = useListAutoAnimate<HTMLUListElement>();
  const isCard = variant === "card";
  const paged = usePagedRows({
    total: node.families.length,
    pageSize: row.treeActions.preferences.pageSize,
    searching: row.live.searching,
  });
  const visibleFamilies = isCard
    ? []
    : visibleRows(
        node.families,
        paged.visibleCount,
        row.live.activeThreadId,
        (family) => family.root.id,
      );

  const label = isCard ? row.rowLabel.label : row.ref.label;
  const showRollup = !isCard && (!row.expanded || paged.hasMore);

  const rowActions = isCard ? (
    <RowActions className="relative">
      <RowActionButton
        label={
          row.ref.canonicalEnvironmentId === null && row.ref.unseen
            ? `Activate & chat in ${row.rowLabel.label}`
            : `New conversation in ${row.rowLabel.label}`
        }
        icon="Plus"
        disabled={row.ref.canonicalEnvironmentId === null && !row.ref.unseen}
        onClick={() => {
          if (row.ref.canonicalEnvironmentId !== null) {
            row.navigate.toPluginPanel(NEW_CHAT_PANEL_PATH, {
              subPath: row.ref.canonicalEnvironmentId,
            });
          } else if (row.ref.unseen) {
            row.activateOrphan();
          }
        }}
      />
      <RowMenuButton
        label={`Actions for ${row.rowLabel.label}`}
        items={row.workspaceMenu.items}
      />
    </RowActions>
  ) : (
    <RowActions className="pointer-events-auto">
      {showRollup ? (
        <RollupJump
          rollup={node.rollup}
          onJump={(threadId) => {
            row.actions.open(threadId);
            row.treeActions.onNavigate();
          }}
          onFallback={() => row.setExpanded(!row.expanded)}
        />
      ) : null}
      <RowActionButton
        label={`New thread in ${label}`}
        icon="Plus"
        onClick={() =>
          row.treeActions.onNewThreadInWorkspace({ node, projectId, projectName })
        }
      />
      <RowMenuButton label={`Actions for ${label}`} items={row.workspaceMenu.items} />
      <RowDisclosure
        label={`${row.expanded ? "Collapse" : "Expand"} ${label}`}
        expanded={row.expanded}
        controls={listId}
        onToggle={() => row.setExpanded(!row.expanded)}
      />
    </RowActions>
  );

  return (
    <section
      aria-label={label}
      data-harbor-workspace-card={isCard ? row.ref.key : undefined}
      onDragOver={row.onSectionDragOver}
      onDrop={row.onSectionDrop}
    >
      <InfoCard
        trigger={
          <RowMenu
            label={`Actions for ${label}`}
            items={row.workspaceMenu.items}
            dialog={row.workspaceMenu.dialog}
          >
            <div
              ref={row.rowRef}
              data-active={row.active ? "true" : undefined}
              className={cn(
                "group/ws relative flex w-full items-center gap-1.5 rounded-md pr-1.5",
                isCard ? "min-h-7 pl-2" : "pl-4",
                !isCard && (row.stacked ? "min-h-11 py-1" : "h-7"),
                row.active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/50",
              )}
            >
              {row.renaming && row.ref.environmentId !== null ? (
                <WorkspaceNameField
                  inputRef={row.renameInput}
                  initial={row.ref.alias ?? row.ref.branch ?? ""}
                  fallback={row.ref.label}
                  ariaLabel={`Rename worktree ${label}`}
                  onCommit={(draft) => {
                    const next = renameIntent(draft, row.ref.alias ?? "");
                    row.setRenaming(false);
                    if (next !== null && row.ref.environmentId !== null) {
                      row.treeActions.onRenameWorktree(row.ref.environmentId, next);
                    }
                  }}
                  onCancel={() => row.setRenaming(false)}
                />
              ) : (
                <button
                  type="button"
                  draggable={row.canReorder}
                  aria-expanded={isCard ? undefined : row.expanded}
                  aria-controls={isCard ? undefined : listId}
                  aria-current={row.active ? "page" : undefined}
                  aria-keyshortcuts={
                    !isCard && row.canReorder ? "Alt+ArrowUp Alt+ArrowDown" : undefined
                  }
                  aria-label={
                    isCard
                      ? row.rowLabel.label
                      : `${row.expanded ? "Collapse" : "Expand"} ${label}. ${row.canReorder ? "Drag this row to reorder worktrees, or press Alt+Up or Alt+Down." : "Worktree reordering is unavailable."}`
                  }
                  onPointerDown={() => {
                    row.dragStarted.current = false;
                  }}
                  onClick={(event) => {
                    if (row.dragStarted.current) {
                      event.preventDefault();
                      return;
                    }
                    if (isCard) row.openCard();
                    else row.setExpanded(!row.expanded);
                  }}
                  onDragStart={row.onButtonDragStart}
                  onKeyDown={row.onButtonKeyDown}
                  className={cn(
                    "absolute inset-0 rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    row.canReorder && "cursor-grab active:cursor-grabbing",
                  )}
                />
              )}
              {isCard ? (
                <>
                  <span className="pointer-events-none relative flex size-4 shrink-0 items-center justify-center">
                    <WorkspaceGlyph
                      kind={row.glyphKind}
                      node={node}
                      pullRequest={row.pullRequest}
                      workspace={row.ref}
                    />
                  </span>
                  {displayPrefix && !displayLabelOverride ? (
                    <span className="pointer-events-none relative shrink-0 truncate text-xs font-medium text-foreground/90">
                      {displayPrefix}
                      <span className="mx-1 text-muted-foreground/60">·</span>
                    </span>
                  ) : null}
                  <span
                    className={cn(
                      "pointer-events-none relative min-w-0 flex-1 truncate text-xs",
                      row.rowLabel.labelIsBranch && !displayLabelOverride
                        ? "font-mono text-2xs text-muted-foreground/80"
                        : "text-foreground/85",
                    )}
                  >
                    {displayLabelOverride ?? row.rowLabel.label}
                  </span>
                  <span className="pointer-events-none relative flex shrink-0 items-center gap-1.5 text-2xs tabular-nums text-muted-foreground">
                    {row.threadCount > 1 ? (
                      <span title={`${row.threadCount} conversations`}>{row.threadCount}</span>
                    ) : null}
                    <ChangeCounts changes={row.changes} muted={row.active} />
                    {node.rollup.unread === 0 ? null : (
                      <StatusDot
                        status={familyStatusPresentation("unread")}
                        title={`${node.rollup.unread} unread`}
                      />
                    )}
                  </span>
                  {rowActions}
                </>
              ) : (
                <div
                  className={cn(
                    "pointer-events-none relative flex min-w-0 flex-1",
                    row.stacked ? "flex-col gap-0.5" : "items-center gap-1.5",
                  )}
                >
                  {row.stacked ? (
                    <>
                      <span className="min-w-0 max-w-full truncate text-xs text-foreground/80">
                        {displayLabelOverride ??
                          (displayPrefix
                            ? `${displayPrefix} · ${row.rowLabel.label}`
                            : row.rowLabel.label)}
                      </span>
                      <span className="flex min-w-0 max-w-full items-center gap-1.5">
                        <span className="flex min-w-0 flex-1 items-center gap-1 truncate">
                          <Icon
                            name={row.ref.kind === "git-worktree" ? "FolderGit" : "GitBranch"}
                            aria-label="Branch"
                            className="size-3 shrink-0 text-muted-foreground/60"
                          />
                          <span className="truncate font-mono text-2xs text-muted-foreground/80">
                            {row.rowLabel.detail}
                          </span>
                        </span>
                        {rowActions}
                      </span>
                    </>
                  ) : (
                    <>
                      <Icon
                        name={row.ref.kind === "git-worktree" ? "GitBranch" : "Folder"}
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
                          row.rowLabel.labelIsBranch && !displayLabelOverride
                            ? "font-mono text-2xs text-muted-foreground/80"
                            : "text-foreground/80",
                        )}
                      >
                        {displayLabelOverride ?? row.rowLabel.label}
                      </span>
                      {row.rowLabel.detail === null || displayLabelOverride ? null : (
                        <span className="min-w-0 max-w-full truncate font-mono text-2xs text-muted-foreground/80">
                          {row.rowLabel.detail}
                        </span>
                      )}
                      {rowActions}
                    </>
                  )}
                </div>
              )}
            </div>
          </RowMenu>
        }
        label={row.preview.label}
        subtitle={row.preview.subtitle}
        summary={row.preview.summary}
        rows={row.preview.rows}
      />
      {row.archiving ? (
        <ArchiveWorkspaceDialog
          label={label}
          threadIds={node.families.map((family) => family.root.id)}
          onCancel={() => row.setArchiving(false)}
          onArchive={() => {
            row.setArchiving(false);
            for (const family of node.families) row.actions.archive(family.root.id);
          }}
        />
      ) : null}
      {row.removing ? (
        <RemoveWorktreeDialog
          open
          environmentId={row.ref.environmentId}
          label={label}
          onClose={() => row.setRemoving(false)}
        />
      ) : null}
      {isCard ? null : node.families.length === 0 ? (
        row.expanded ? (
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
              row.expanded && "border-l border-sidebar-border pl-3",
            )}
          >
            {row.expanded
              ? visibleFamilies.map((family) => (
                  <FamilyRow
                    key={family.root.id}
                    family={family}
                    projectId={projectId}
                  />
                ))
              : null}
          </ul>
          {row.expanded && !row.live.searching && (paged.hasMore || paged.page > 1) ? (
            <PageControls {...paged.controlsProps} className="ml-4" />
          ) : null}
        </>
      )}
    </section>
  );
});

function WorkspaceGlyph({
  kind,
  node,
  pullRequest,
  workspace,
}: {
  kind: ReturnType<typeof workspaceGlyphKind>;
  node: WorkspaceNode;
  pullRequest: WorkspacePullRequest | null;
  workspace: Workspace;
}) {
  if (kind === "status") {
    return (
      <FamilyStatusIcon
        status={familyStatusPresentation(node.rollup.kind)}
        variant="dot"
        className="size-4"
      />
    );
  }
  if (kind === "pull-request" && pullRequest !== null) {
    const presentation = pullRequestPresentation(pullRequest);
    const color = `var(--harbor-pr-${presentation.colorRole}, currentColor)`;
    return (
      <span
        role="img"
        aria-label={`${presentation.label} pull request ${pullRequest.number}`}
        title={`${presentation.label} · #${pullRequest.number}`}
        className="flex size-4 items-center justify-center rounded"
        style={{ color }}
      >
        <Icon name={presentation.icon} className="size-3" aria-hidden />
      </span>
    );
  }
  return (
    <Icon
      name={workspaceTypeIcon(workspace)}
      aria-hidden
      className="size-3.5 text-muted-foreground/60"
    />
  );
}

function ChangeCounts({
  changes,
  muted = false,
}: {
  changes: WorkspaceChangeCount | null;
  muted?: boolean;
}) {
  if (changes === null || (changes.insertions === 0 && changes.deletions === 0)) {
    return null;
  }
  return (
    <>
      {changes.insertions > 0 ? (
        <span className={muted ? "text-muted-foreground/80" : "text-success-foreground"}>
          +{formatLineCount(changes.insertions)}
        </span>
      ) : null}
      {changes.deletions > 0 ? (
        <span className={muted ? "text-muted-foreground/80" : "text-destructive"}>
          -{formatLineCount(changes.deletions)}
        </span>
      ) : null}
    </>
  );
}

function ArchiveWorkspaceDialog({
  label,
  threadIds,
  onCancel,
  onArchive,
}: {
  label: string;
  threadIds: readonly string[];
  onCancel: () => void;
  onArchive: () => void;
}) {
  return (
    <Modal
      open
      onClose={onCancel}
      icon="Archive"
      title={`Archive threads in ${label}`}
      width="28rem"
      footer={
        <DialogActions>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="default" size="sm" onClick={onArchive}>
            Archive
          </Button>
        </DialogActions>
      }
    >
      <p className="text-xs leading-relaxed text-muted-foreground">
        This archives {threadIds.length}{" "}
        {threadIds.length === 1 ? "thread family" : "thread families"} and their
        child agents. You can unarchive them from bb at any time.
      </p>
    </Modal>
  );
}
