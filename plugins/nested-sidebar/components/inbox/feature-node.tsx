import { useId, useState } from "react";

import {
  RowActionButton,
  RowActions,
  RowDisclosure,
} from "@/components/inbox/row-actions";
import { RowMenu, type RowMenuItem } from "@/components/inbox/row-context-menu";
import { RollupJump } from "@/components/inbox/rollup-badge";
import { useNestViewState } from "@/components/inbox/view-state-context";
import { useListAutoAnimate } from "@/hooks/use-list-auto-animate";
import { cn } from "@/lib/utils";
import type { FeatureWorkspaceNode, FeatureNode as FeatureNodeModel } from "@/lib/feature-view";

/**
 * One feature, and the workspaces filed under it.
 *
 * Drawn with the same parts every other row uses: `RowDisclosure` for the
 * chevron, `RowActions` for the trailing cluster, `RowMenu` for the right-click
 * surface, and `RollupJump` for the status cluster. A feature row that invented
 * its own buttons would be a second interaction language in one list.
 *
 * The row is a `section` with an aria-label like a worktree's, because it is a
 * whole branch of the tree rather than a leaf.
 */
export function FeatureNode({
  node,
  onOpenWorkspace,
  onAddRepository,
  onOpenThread,
  onRename,
  onRemove,
}: {
  node: FeatureNodeModel;
  onOpenWorkspace: (workspace: FeatureWorkspaceNode) => void;
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
  const threadCount = node.workspaces.reduce(
    (total, workspace) =>
      total +
      workspace.families.reduce(
        (count, family) => count + 1 + family.children.length,
        0,
      ),
    0,
  );
  const empty = node.workspaces.length === 0;
  const hasDirectory = node.feature.rootPath !== null;

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
                onRename(node.feature.id, draft);
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
            {empty ? "No worktrees" : `${node.workspaces.length} · ${threadCount}`}
          </span>
          <RowActions className="pointer-events-auto">
            {threadCount === 0 ? null : (
              <RollupJump
                rollup={node.rollup}
                onJump={(threadId) => {
                  const workspace = node.workspaces.find((candidate) =>
                    candidate.families.some(
                      (family) =>
                        family.root.id === threadId ||
                        family.children.some((child) => child.id === threadId),
                    ),
                  );
                  if (workspace === undefined) return;
                  const thread = workspace.families
                    .flatMap((family) => [family.root, ...family.children])
                    .find((candidate) => candidate.id === threadId);
                  if (thread === undefined) return;
                  onOpenWorkspace({
                    ...workspace,
                    families: workspace.families.filter((family) =>
                      [family.root, ...family.children].some(
                        (candidate) => candidate.id === thread.id,
                      ),
                    ),
                  });
                }}
                onFallback={() => setExpanded(true)}
              />
            )}
            <RowActionButton
              label={`Add a repository to ${node.feature.name}`}
              icon="Plus"
              onClick={() => onAddRepository(node.feature.id)}
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
            <p className="py-1 pl-4 text-2xs text-muted-foreground">
              No worktrees filed under this feature yet
            </p>
          ) : (
            node.workspaces.map((workspace) => (
              <button
                key={workspace.ref.key}
                type="button"
                onClick={() => onOpenWorkspace(workspace)}
                title={workspace.ref.path ?? workspace.ref.label}
                className={cn(
                  "flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left",
                  "hover:bg-sidebar-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                )}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-2xs text-muted-foreground/80">
                  {workspace.ref.label}
                </span>
                <span className="shrink-0 text-2xs text-muted-foreground">
                  {workspace.ref.branch ?? ""}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </section>
  );
}

/**
 * The inline rename field, matching the group and worktree rows.
 *
 * Commits on Enter or blur, abandons on Escape. The same rules every other
 * inline editor in this sidebar applies, so a rename behaves the same wherever
 * it starts.
 */
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
