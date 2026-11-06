import { FeatureNode } from "@/components/inbox/feature-node";
import { useListAutoAnimate } from "@/hooks/use-list-auto-animate";
import { GroupIcon } from "@/components/ui/group-icon";
import { EMPTY_STATE_CLASS } from "@/components/inbox/inbox-layout";
import type { FeatureGroupNode } from "@/lib/feature-view";
import type { TreeRowHandlers } from "@/components/inbox/tree-row-types";
import type { ThreadFilterPreset } from "@/lib/thread-management";

/**
 * The feature view of the tree.
 *
 * It draws the same group header the project view draws, because the strip
 * above is shared and a group means the same thing in both. What changes is the
 * level below: features instead of projects, and workspaces instead of
 * worktrees. The empty state is the tree's own class, so a filter that matches
 * nothing reads the same in either view.
 */
export function FeatureTreePanel({
  nodes,
  handlers,
  empty,
  onOpenThreadById,
  onAddRepository,
  onOpenThread,
  onRename,
  onRemove,
  onManage,
}: {
  nodes: readonly FeatureGroupNode[];
  handlers: TreeRowHandlers;
  empty: {
    readonly ready: boolean;
    readonly searching: boolean;
    readonly filter: ThreadFilterPreset;
  };
  onOpenThreadById: (threadId: string) => void;
  onAddRepository: (featureId: string) => void;
  onOpenThread: (featureId: string) => void;
  onRename: (featureId: string, name: string) => void;
  onRemove: (featureId: string) => void;
  onManage: () => void;
}) {
  const attachListAutoAnimateRef = useListAutoAnimate<HTMLDivElement>();

  if (!empty.ready) return null;

  if (nodes.length === 0) {
    return (
      <div className={EMPTY_STATE_CLASS}>
        {empty.searching
          ? "No features found"
          : empty.filter === "all"
            ? "No features yet"
            : "No features match this filter"}
      </div>
    );
  }

  return (
    <div ref={attachListAutoAnimateRef}>
      {nodes.map((node) => (
        <section key={node.groupId ?? "__ungrouped__"} className="mb-1">
          <div className="flex items-center gap-1.5 px-1.5 py-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            <GroupIcon name={node.icon} className="size-3" ariaHidden />
            <span className="truncate">{node.name}</span>
            <span className="ml-auto shrink-0 font-normal normal-case">
              {node.features.length}
              {node.draftCount > 0 ? ` · ${node.draftCount} not started` : ""}
            </span>
          </div>
          {node.features.map((feature) => (
            <FeatureNode
              key={feature.feature.id}
              node={feature}
              handlers={handlers}
              onOpenWorkspace={(_path, threadId) => {
                if (threadId !== null) onOpenThreadById(threadId);
              }}
              onAddRepository={onAddRepository}
              onOpenThread={onOpenThread}
              onRename={onRename}
              onRemove={onRemove}
            />
          ))}
        </section>
      ))}
      <button
        type="button"
        onClick={onManage}
        className="mt-1 flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-2xs text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        New feature…
      </button>
    </div>
  );
}
