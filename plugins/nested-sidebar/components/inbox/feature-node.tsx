import { useId } from "react";

import { RowDisclosure } from "@/components/inbox/row-actions";
import { useNestViewState } from "@/components/inbox/view-state-context";
import { useListAutoAnimate } from "@/hooks/use-list-auto-animate";
import { cn } from "@/lib/utils";
import type { FeatureNode as FeatureNodeModel } from "@/lib/feature-view";
import type { FeatureWorkspaceNode } from "@/lib/feature-view";

/**
 * One feature, and the workspaces filed under it.
 *
 * The disclosure is a real row element rather than a hover card: a hover-only
 * panel is unreachable on a touch screen and by keyboard, and this list is the
 * primary way to reach a feature's work.
 *
 * The row has two targets. The chevron opens and closes the list, and the name
 * is the feature itself. Splitting them is deliberate: an entire row that both
 * expands and navigates leaves the reader guessing which one a click will do.
 */
export function FeatureNode({
  node,
  onOpenWorkspace,
  onAddRepository,
}: {
  node: FeatureNodeModel;
  onOpenWorkspace: (workspace: FeatureWorkspaceNode) => void;
  onAddRepository?: (featureId: string) => void;
}) {
  const viewState = useNestViewState();
  const listId = useId();
  const attachListAutoAnimateRef = useListAutoAnimate<HTMLDivElement>();
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

  return (
    <div data-nest-feature-row="">
      <div
        className={cn(
          "group/feature flex w-full items-center gap-1 rounded-md px-1.5 py-1",
          "hover:bg-sidebar-accent/60",
        )}
      >
        <RowDisclosure
          label={`${expanded ? "Collapse" : "Expand"} ${node.feature.name}`}
          expanded={expanded}
          controls={listId}
          onToggle={() => setExpanded(!expanded)}
        />
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className={cn(
            "min-w-0 flex-1 truncate text-left text-xs font-medium text-foreground",
            "rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          )}
        >
          {node.feature.name}
        </button>
        <span className="shrink-0 text-2xs text-muted-foreground">
          {empty
            ? node.feature.state === "draft"
              ? "空壳"
              : "无 worktree"
            : `${node.workspaces.length} · ${threadCount}`}
        </span>
        {onAddRepository === undefined ? null : (
          <button
            type="button"
            title={`添加仓库到 ${node.feature.name}`}
            onClick={(event) => {
              event.stopPropagation();
              onAddRepository(node.feature.id);
            }}
            className="shrink-0 rounded px-1 text-2xs text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            +
          </button>
        )}
      </div>
      {expanded ? (
        <div id={listId} ref={attachListAutoAnimateRef} className="ml-3 border-l border-sidebar-border/60 pl-1">
          {empty ? (
            <p className="py-1 pl-4 text-2xs text-muted-foreground">
              还没有 worktree 归到这个功能下
            </p>
          ) : (
            node.workspaces.map((workspace) => (
              <button
                key={workspace.ref.key}
                type="button"
                onClick={() => onOpenWorkspace(workspace)}
                className={cn(
                  "flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left",
                  "hover:bg-sidebar-accent/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                )}
                title={workspace.ref.path ?? workspace.ref.label}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-2xs text-foreground/85">
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
    </div>
  );
}
