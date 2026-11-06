import { useId } from "react";

import { FeatureNode } from "@/components/inbox/feature-node";
import { useListAutoAnimate } from "@/hooks/use-list-auto-animate";
import { GroupIcon } from "@/components/ui/group-icon";
import type { FeatureGroupNode, FeatureWorkspaceNode } from "@/lib/feature-view";
import type { ThreadFilterPreset } from "@/lib/thread-management";

/**
 * The feature view of the tree.
 *
 * It draws the same group headers the project view does, because the strip above
 * is shared and a group means the same thing in both. What changes is the level
 * below: features instead of projects, and workspaces instead of worktrees.
 */
export function FeatureTreePanel({
  nodes,
  empty,
  onOpenWorkspace,
  onManage,
  onAddRepository,
}: {
  nodes: readonly FeatureGroupNode[];
  empty: {
    readonly ready: boolean;
    readonly searching: boolean;
    readonly filter: ThreadFilterPreset;
  };
  onOpenWorkspace: (workspace: FeatureWorkspaceNode) => void;
  onManage: () => void;
  onAddRepository?: (featureId: string) => void;
}) {
  const attachListAutoAnimateRef = useListAutoAnimate<HTMLDivElement>();

  if (!empty.ready) return null;

  if (nodes.length === 0) {
    return (
      <div className="px-3 py-6 text-center">
        <p className="text-xs text-muted-foreground">
          {empty.searching
            ? "没有匹配的功能"
            : empty.filter === "all"
              ? "还没有功能"
              : "没有符合筛选的功能"}
        </p>
        <button
          type="button"
          onClick={onManage}
          className="mt-2 rounded-md border border-border px-2 py-1 text-2xs text-foreground hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          新建功能
        </button>
      </div>
    );
  }

  return (
    <div ref={attachListAutoAnimateRef}>
      <button
        type="button"
        onClick={onManage}
        className="mb-1 flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-2xs text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        + 新建功能
      </button>
      {nodes.map((node) => (
        <FeatureGroupNodeView
          key={node.groupId ?? "__ungrouped__"}
          node={node}
          onOpenWorkspace={onOpenWorkspace}
          onAddRepository={onAddRepository}
        />
      ))}
    </div>
  );
}

function FeatureGroupNodeView({
  node,
  onOpenWorkspace,
  onAddRepository,
}: {
  node: FeatureGroupNode;
  onOpenWorkspace: (workspace: FeatureWorkspaceNode) => void;
  onAddRepository?: (featureId: string) => void;
}) {
  const listId = useId();
  return (
    <section className="mb-1">
      <div className="flex items-center gap-1.5 px-1.5 py-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
        <GroupIcon name={node.icon} className="size-3" ariaHidden />
        <span className="truncate">{node.name}</span>
        <span className="ml-auto shrink-0 font-normal normal-case">
          {node.features.length}
          {node.draftCount > 0 ? ` · ${node.draftCount} 未开工` : ""}
        </span>
      </div>
      <div id={listId}>
        {node.features.map((feature) => (
          <FeatureNode
            key={feature.feature.id}
            node={feature}
            onOpenWorkspace={onOpenWorkspace}
            onAddRepository={onAddRepository}
          />
        ))}
      </div>
    </section>
  );
}
