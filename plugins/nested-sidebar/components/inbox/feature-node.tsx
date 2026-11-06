import { useId, useState } from "react";

import {
  RowActionButton,
  RowActions,
  RowDisclosure,
} from "@/components/inbox/row-actions";
import { RowMenu, type RowMenuItem } from "@/components/inbox/row-context-menu";
import { RollupJump } from "@/components/inbox/rollup-badge";
import { FamilyRow } from "@/components/inbox/family-row";
import { useNestViewState } from "@/components/inbox/view-state-context";
import { useListAutoAnimate } from "@/hooks/use-list-auto-animate";
import { cn } from "@/lib/utils";
import type { ThreadFamily } from "@/lib/inbox";
import type { FeatureNode as FeatureNodeModel } from "@/lib/feature-view";
import type { TreeRowHandlers } from "@/components/inbox/tree-row-types";

/**
 * One feature, and the conversations inside it.
 *
 * The list under a feature is its threads, not its directories. A person
 * opening a feature is asking what is happening in this piece of work; the
 * worktree a thread runs in is an attribute of that thread, drawn on its row.
 * Listing four empty worktrees first pushed the actual work off screen, which
 * is the opposite of what the view is for.
 *
 * A feature with no thread yet says so in one line and offers the two things a
 * person would want: start a conversation, or add a repository to it.
 */
export function FeatureNode({
  node,
  handlers,
  onOpenWorkspace,
  onAddRepository,
  onOpenThread,
  onRename,
  onRemove,
}: {
  node: FeatureNodeModel;
  handlers: TreeRowHandlers;
  onOpenWorkspace: (path: string, threadId: string | null) => void;
  onAddRepository: (featureId: string) => void;
  onOpenThread: (featureId: string) => void;
  onRename: (featureId: string, name: string) => void;
  onRemove: (featureId: string) => void;
}) {
  const viewState = useNestViewState();
  const listId = useId();
  const attachListAutoAnimateRef = useListAutoAnimate<HTMLDivElement>();
  const [renaming, setRenaming] = useState(false);
  const expanded = !viewState.isProjectCollapsed(node.feature.id);
  const setExpanded = (open: boolean) =>
    viewState.setProjectCollapsed(node.feature.id, !open);
  const threadCount = node.families.reduce(
    (total, family) => total + 1 + family.children.length,
    0,
  );
  const empty = node.families.length === 0;
  const hasDirectory = node.feature.rootPath !== null;
  /** Which workspace a thread runs in, for the row's own clue. */
  const workspaceOf = (family: ThreadFamily): string | null =>
    node.workspaces.find((workspace) =>
      workspace.families.some((candidate) => candidate.root.id === family.root.id),
    )?.ref.label ?? null;
  /**
   * Reordering is a project-view statement.
   *
   * A feature's threads come from several projects, and their order here is by
   * the feature's own grouping rather than by any project's stored arrangement.
   * Offering the drag here would write to a project order this view does not
   * read, so the control is turned off rather than wired to the wrong place.
   */
  const featureHandlers: TreeRowHandlers = {
    ...handlers,
    reorderEnabled: false,
    reorderDisabledReason:
      "A feature's threads come from several projects. Reorder them in the project view.",
    pinnedReorderEnabled: false,
  };

  const items: RowMenuItem[] = [
    {
      key: "new-thread",
      icon: "Plus",
      label: hasDirectory ? "New thread here" : "New thread needs a worktree",
      disabled: !hasDirectory,
      onSelect: () => onOpenThread(node.feature.id),
    },
    {
      key: "add-repository",
      icon: "FolderGit",
      label: "Add repository…",
      onSelect: () => onAddRepository(node.feature.id),
    },
    {
      key: "rename",
      icon: "Edit",
      label: "Rename feature…",
      onSelect: () => setRenaming(true),
    },
    {
      key: "remove",
      icon: "Trash2",
      label: "Remove feature…",
      destructive: true,
      separatorBefore: true,
      onSelect: () => onRemove(node.feature.id),
    },
  ];

  return (
    <section aria-label={node.feature.name}>
      <RowMenu label={`${node.feature.name} actions`} items={items}>
        <div
          className={cn(
            "group/feature relative flex h-7 w-full items-center gap-1.5 rounded-md px-1.5",
            "hover:bg-sidebar-accent/60",
          )}
        >
          <RowDisclosure
            label={`${expanded ? "Collapse" : "Expand"} ${node.feature.name}`}
            expanded={expanded}
            controls={listId}
            onToggle={() => setExpanded(!expanded)}
          />
          {renaming ? (
            <FeatureNameField
              initial={node.feature.name}
              onCommit={(draft) => {
                setRenaming(false);
                if (draft.trim().length > 0) onRename(node.feature.id, draft);
              }}
              onCancel={() => setRenaming(false)}
            />
          ) : (
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={listId}
              onClick={() => setExpanded(!expanded)}
              className="absolute inset-0 rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          )}
          <span className="pointer-events-none relative min-w-0 flex-1 truncate text-xs font-medium text-foreground">
            {node.feature.name}
          </span>
          <span className="pointer-events-none relative shrink-0 text-2xs text-muted-foreground">
            {threadCount === 0
              ? node.workspaces.length === 0
                ? "not started"
                : `${node.workspaces.length} ${node.workspaces.length === 1 ? "repo" : "repos"}`
              : threadCount}
          </span>
          <RowActions className="pointer-events-auto">
            {threadCount === 0 ? null : (
              <RollupJump
                rollup={node.rollup}
                onJump={(threadId) => onOpenWorkspace("", threadId)}
                onFallback={() => setExpanded(true)}
              />
            )}
            <RowActionButton
              label={
                hasDirectory
                  ? `New thread in ${node.feature.name}`
                  : `Add a repository to ${node.feature.name} first`
              }
              icon="Plus"
              onClick={() =>
                hasDirectory
                  ? onOpenThread(node.feature.id)
                  : onAddRepository(node.feature.id)
              }
            />
          </RowActions>
        </div>
      </RowMenu>
      {expanded ? (
        <div
          id={listId}
          ref={attachListAutoAnimateRef}
          className="ml-3 border-l border-sidebar-border/60 pb-0.5 pl-1"
        >
          {empty ? (
            <div className="py-1 pl-3">
              <p className="text-2xs text-muted-foreground">
                {node.workspaces.length === 0
                  ? "No worktrees yet."
                  : `${node.workspaces.length} ${node.workspaces.length === 1 ? "worktree" : "worktrees"}, no conversation yet.`}
              </p>
              <div className="mt-1 flex gap-2">
                <button
                  type="button"
                  disabled={!hasDirectory}
                  onClick={() => onOpenThread(node.feature.id)}
                  className="rounded px-1 text-2xs font-medium text-primary hover:underline disabled:text-muted-foreground disabled:no-underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  Start a conversation
                </button>
                <button
                  type="button"
                  onClick={() => onAddRepository(node.feature.id)}
                  className="rounded px-1 text-2xs text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  Add a repository
                </button>
              </div>
            </div>
          ) : (
            <ul>
              {node.families.map((family) => (
                <li key={family.root.id}>
                  <FamilyRow
                    family={family}
                    projectId={family.root.projectId}
                    handlers={featureHandlers}
                  />
                  {workspaceOf(family) === null ? null : (
                    <p className="pl-6 text-2xs text-muted-foreground">
                      {workspaceOf(family)}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}

/** The inline rename field, matching the group and worktree rows. */
function FeatureNameField({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (draft: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  return (
    <input
      autoFocus
      value={draft}
      aria-label="Feature name"
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
        if (event.key === "Enter") {
          event.preventDefault();
          onCommit(draft);
        }
      }}
      className="relative z-10 h-5 min-w-0 flex-1 rounded-sm border border-input bg-transparent px-1 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    />
  );
}
