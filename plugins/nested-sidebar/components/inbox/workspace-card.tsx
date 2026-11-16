import { memo, useRef, useState } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";

import { NEW_CHAT_PANEL_PATH } from "@/app/new-chat/route";
import { RemoveWorktreeDialog } from "@/components/inbox/remove-worktree-dialog";
import { RowActionButton, RowActions } from "@/components/inbox/row-actions";
import {
  FamilyStatusIcon,
  StatusDot,
} from "@/components/inbox/family-status";
import { StatusOrTime } from "@/components/inbox/status-slot";
import { ThreadRowMenu } from "@/components/inbox/thread-menu-items";
import { ThreadRowLink } from "@/components/inbox/thread-row-link";
import { useTreeRowHandlers } from "@/components/inbox/tree-row-handlers-context";
import type { TreeRowHandlers } from "@/components/inbox/tree-row-types";
import { ArchiveWorkspaceDialog } from "@/components/inbox/workspace-dialogs";
import { WorkspaceNameField } from "@/components/inbox/workspace-name-field";
import { WorkspaceRowMenu } from "@/components/inbox/workspace-row-menu";
import { parseDraggedWorkspace } from "@/components/inbox/workspace-drag";
import { Icon } from "@/components/ui/icon";
import { InfoCard, type InfoCardRow } from "@/components/ui/hover-card";
import { usePointerCoarse } from "@/components/ui/hooks/use-pointer-coarse";
import { useThreadActions } from "@/hooks/use-thread-actions";
import { familyStatusPresentation } from "@/lib/family-status";
import type { ThreadFamily } from "@/lib/inbox";
import { threadDisplayTitle } from "@/lib/inbox";
import { renameIntent } from "@/lib/groups";
import { lastActiveFor } from "@/lib/last-active";
import { pullRequestPresentation } from "@/lib/pull-request-presentation";
import type { WorkspaceNode } from "@/lib/tree";
import { cn } from "@/lib/utils";
import { formatLineCount, workspaceKindLabel, workspaceRowLabel } from "@/lib/workspace";
import {
  changeCountFor,
  type WorkspaceChangeCount,
} from "@/lib/workspace-change-counts";
import type { Workspace } from "@/lib/workspace-index";
import {
  workspaceGlyphKind,
  workspaceOpenTarget,
  workspaceTypeIcon,
} from "@/lib/workspace-view";

/**
 * One workspace, as the workspaces view draws it.
 *
 * The row is the whole of what this mode says about a workspace: what it is
 * called, what its conversations are doing, and how much is uncommitted. The
 * conversations themselves are in the header's tabs, so there is no disclosure
 * and nothing below the row.
 *
 * A click opens the conversation that most deserves it — something failed or
 * needs you, else the one last open here, else the oldest — and a workspace
 * with nothing in it opens a new conversation bound to it. `+` always does the
 * latter, whatever the row holds.
 */
export const WorkspaceCard = memo(function WorkspaceCard({
  node,
  projectId,
  projectName,
}: {
  node: WorkspaceNode;
  projectId: string;
  projectName: string;
}) {
  const handlers = useTreeRowHandlers();
  const navigate = useBbNavigate();
  const actions = useThreadActions();
  const [renaming, setRenaming] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const dragStarted = useRef(false);
  const renameInput = useRef<HTMLInputElement>(null);
  const coarse = usePointerCoarse();
  const ref = node.ref as Workspace;
  const canReorder = handlers.workspaceReorderEnabled && ref.kind === "git-worktree" && !coarse;
  const canRename = ref.environmentId !== null && ref.kind !== "unresolved";
  const canRemove = ref.environmentId !== null && ref.kind === "git-worktree";
  const threadCount = node.families.reduce(
    (total, family) => total + 1 + family.children.length,
    0,
  );
  const rowLabel = workspaceRowLabel(ref, handlers.preferences.worktreeLabel);
  const path =
    ref.environmentId === null
      ? ref.path
      : (handlers.paths.environments[ref.environmentId]?.path ?? ref.path);
  const active = handlers.activeWorkspaceKey !== null && handlers.activeWorkspaceKey === ref.key;
  const pullRequest = firstPullRequest(handlers, ref);
  const changes = changeCountFor(handlers.workspaceChanges, ref.environmentIds);
  const glyphKind = workspaceGlyphKind({
    rollupKind: node.rollup.kind,
    hasPullRequest: pullRequest !== null,
  });

  const open = () => {
    const target = workspaceOpenTarget({
      rollup: node.rollup,
      families: node.families,
      lastActiveThreadId: lastActiveFor(ref.key),
    });
    if (target.kind === "thread") {
      actions.open(target.threadId);
      handlers.onNavigate();
      return;
    }
    if (ref.canonicalEnvironmentId !== null) {
      navigate.toPluginPanel(NEW_CHAT_PANEL_PATH, { subPath: ref.canonicalEnvironmentId });
    }
  };

  const rows: InfoCardRow[] = [
    { label: "Kind", value: workspaceKindLabel(ref.kind) },
    { label: "Project", value: projectName },
    { label: "Threads", value: String(threadCount) },
    ...(ref.alias === null ? [] : [{ label: "Alias", value: ref.alias }]),
    ...(ref.branch === null
      ? []
      : [{ label: "Branch", value: ref.branch, mono: true, copy: true }]),
    ...(ref.environmentId === null
      ? []
      : [{ label: "Env ID", value: ref.environmentId, mono: true, copy: true }]),
    ...(path === null
      ? []
      : [{ label: "Path", value: path, mono: true, copy: true }]),
    ...(ref.diagnostic === null ? [] : [{ label: "Diagnostic", value: ref.diagnostic }]),
  ];

  return (
    <section aria-label={rowLabel.label} data-nest-workspace-card={ref.key}>
      <InfoCard
        trigger={
          <WorkspaceRowMenu
            label={rowLabel.label}
            node={node}
            projectId={projectId}
            projectName={projectName}
            branch={ref.branch}
            path={path}
            expanded={false}
            disclosable={false}
            canRename={canRename}
            canRemove={canRemove}
            threadCount={threadCount}
            onToggleExpanded={() => undefined}
            onRename={() => setRenaming(true)}
            onArchiving={() => setArchiving(true)}
            onRemoving={() => setRemoving(true)}
          >
            <div
              data-active={active ? "true" : undefined}
              className={cn(
                "group/ws relative flex min-h-7 w-full items-center gap-1.5 rounded-md pl-2 pr-1.5",
                active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/50",
              )}
              onDragOver={(event) => {
                if (!canReorder) return;
                if (!event.dataTransfer.types.includes("application/x-nest-workspace")) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDrop={(event) => {
                if (!canReorder) return;
                const raw = event.dataTransfer.getData("application/x-nest-workspace");
                if (raw.length === 0) return;
                const dragged = parseDraggedWorkspace(raw);
                if (dragged === null) return;
                event.preventDefault();
                const bounds = event.currentTarget.getBoundingClientRect();
                handlers.onWorkspaceReorder({
                  sourceProjectId: dragged.projectId,
                  sourceKey: dragged.workspaceKey,
                  targetProjectId: projectId,
                  targetKey: ref.key,
                  position: event.clientY >= bounds.top + bounds.height / 2 ? "after" : "before",
                });
              }}
            >
              {renaming && ref.environmentId !== null ? (
                <WorkspaceNameField
                  inputRef={renameInput}
                  initial={ref.alias ?? ref.branch ?? ""}
                  fallback={ref.label}
                  ariaLabel={`Rename worktree ${rowLabel.label}`}
                  onCommit={(draft) => {
                    const next = renameIntent(draft, ref.alias ?? "");
                    setRenaming(false);
                    if (next !== null && ref.environmentId !== null) {
                      handlers.onRenameWorktree(ref.environmentId, next);
                    }
                  }}
                  onCancel={() => setRenaming(false)}
                />
              ) : (
                <button
                  type="button"
                  draggable={canReorder}
                  aria-label={rowLabel.label}
                  aria-current={active ? "page" : undefined}
                  onPointerDown={() => {
                    dragStarted.current = false;
                  }}
                  onClick={(event) => {
                    if (dragStarted.current) {
                      event.preventDefault();
                      return;
                    }
                    open();
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
                      JSON.stringify({ projectId, workspaceKey: ref.key }),
                    );
                  }}
                  onKeyDown={(event) => {
                    if (!event.altKey || !canReorder) return;
                    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                    event.preventDefault();
                    handlers.onWorkspaceKeyboardMove(
                      projectId,
                      ref.key,
                      event.key === "ArrowUp" ? -1 : 1,
                    );
                  }}
                  className={cn(
                    "absolute inset-0 rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    canReorder && "cursor-grab active:cursor-grabbing",
                  )}
                />
              )}
              <span className="pointer-events-none relative flex size-4 shrink-0 items-center justify-center">
                <WorkspaceGlyph
                  kind={glyphKind}
                  node={node}
                  pullRequest={pullRequest}
                  workspace={ref}
                />
              </span>
              <span
                className={cn(
                  "pointer-events-none relative min-w-0 flex-1 truncate text-xs",
                  rowLabel.labelIsBranch ? "font-mono text-2xs text-muted-foreground/80" : "text-foreground/85",
                )}
              >
                {rowLabel.label}
              </span>
              <span className="pointer-events-none relative flex shrink-0 items-center gap-1.5 text-2xs tabular-nums text-muted-foreground">
                {threadCount > 1 ? (
                  <span title={`${threadCount} conversations`}>{threadCount}</span>
                ) : null}
                <ChangeCounts changes={changes} />
                {node.rollup.unread === 0 ? null : (
                  <StatusDot status={familyStatusPresentation("unread")} title={`${node.rollup.unread} unread`} />
                )}
              </span>
              <RowActions className="relative">
                <RowActionButton
                  label={`New conversation in ${rowLabel.label}`}
                  icon="Plus"
                  disabled={ref.canonicalEnvironmentId === null}
                  onClick={() => {
                    if (ref.canonicalEnvironmentId !== null) {
                      navigate.toPluginPanel(NEW_CHAT_PANEL_PATH, {
                        subPath: ref.canonicalEnvironmentId,
                      });
                    }
                  }}
                />
              </RowActions>
            </div>
          </WorkspaceRowMenu>
        }
        label={rowLabel.label}
        rows={rows}
      />
      {archiving ? (
        <ArchiveWorkspaceDialog
          label={rowLabel.label}
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
          environmentId={ref.environmentId}
          label={rowLabel.label}
          onClose={() => setRemoving(false)}
        />
      ) : null}
    </section>
  );
});

function firstPullRequest(handlers: TreeRowHandlers, ref: Workspace) {
  for (const environmentId of ref.environmentIds) {
    const pullRequest = handlers.pullRequests.get(environmentId);
    if (pullRequest !== undefined) return pullRequest;
  }
  return null;
}

/**
 * The leading glyph, one slot whatever is in it: the threads' state when there
 * is one, else the pull request, else what kind of directory this is.
 */
function WorkspaceGlyph({
  kind,
  node,
  pullRequest,
  workspace,
}: {
  kind: ReturnType<typeof workspaceGlyphKind>;
  node: WorkspaceNode;
  pullRequest: ReturnType<typeof firstPullRequest>;
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
    const color = `var(--nest-pr-${presentation.colorRole}, currentColor)`;
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

function ChangeCounts({ changes }: { changes: WorkspaceChangeCount | null }) {
  if (changes === null || (changes.insertions === 0 && changes.deletions === 0)) return null;
  return (
    <>
      {changes.insertions > 0 ? (
        <span className="text-success-foreground">+{formatLineCount(changes.insertions)}</span>
      ) : null}
      {changes.deletions > 0 ? (
        <span className="text-destructive">-{formatLineCount(changes.deletions)}</span>
      ) : null}
    </>
  );
}

/**
 * A conversation with no workspace, as a compact row.
 *
 * The personal project's conversations are one per workspace they never had, so
 * the workspaces view draws them as rows of their own — no children, because a
 * child belongs to its root's workspace and this row is not a family.
 */
export function CompactThreadRow({
  family,
}: {
  family: ThreadFamily;
}) {
  const handlers = useTreeRowHandlers();
  const thread = family.root;
  const title = threadDisplayTitle(thread);
  const active = handlers.activeThreadId === thread.id;
  return (
    <ThreadRowMenu thread={thread}>
      <div
        className={cn(
          "group/compact relative flex h-7 items-center gap-2 rounded-md pl-4 pr-1.5 text-xs",
          active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/50",
        )}
      >
        <ThreadRowLink
          thread={thread}
          active={active}
          onNavigate={handlers.onNavigate}
          ariaLabel={title}
          shortcutTarget={false}
          splitSource={false}
          className="rounded-md"
        />
        <span className="pointer-events-none relative min-w-0 flex-1 truncate text-foreground/85">
          {title}
        </span>
        <span className="pointer-events-none relative shrink-0">
          <StatusOrTime thread={thread} now={handlers.now} />
        </span>
      </div>
    </ThreadRowMenu>
  );
}
