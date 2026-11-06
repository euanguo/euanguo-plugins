import { useState } from "react";

import { FeatureNode, type FeatureRowActions } from "@/components/inbox/feature-node";
import { GroupShell } from "@/components/inbox/group-section";
import { ShelfHeader } from "@/components/inbox/parked-shelf";
import { ProjectBadge } from "@/components/inbox/project-node";
import { RowActionButton, RowActions } from "@/components/inbox/row-actions";
import type { TreeRowHandlers } from "@/components/inbox/tree-row-types";
import { Icon } from "@/components/ui/icon";
import type { FeatureGroupNode } from "@/lib/feature-view";
import type { Feature } from "@/lib/features";
import { projectBadgePresentation } from "@/lib/project-colors";

export interface FeatureTreeProps {
  readonly nodes: readonly FeatureGroupNode[];
  readonly archived: readonly Feature[];
  readonly actions: FeatureRowActions;
  readonly onCreate: () => void;
  readonly onReopen: (featureId: string) => void;
}

/**
 * The feature view's rows, inside the tree's own scroll box.
 *
 * Everything around them — notices, the empty state, the snoozed and settled
 * shelves — is the project view's, drawn by the same panel. What changes is the
 * level under each group: features instead of projects. The group header is
 * the very same row, so renaming, moving and collapsing a group work here too.
 */
export function FeatureTree({
  nodes,
  archived,
  actions,
  handlers,
  onCreate,
  onReopen,
}: FeatureTreeProps & { handlers: TreeRowHandlers }) {
  const [archivedOpen, setArchivedOpen] = useState(false);
  return (
    <>
      {nodes.map((node) => (
        <GroupShell
          key={node.groupId ?? "__ungrouped__"}
          node={node}
          handlers={handlers}
          groups={actions.groups}
          counts={[
            { label: "Features", value: String(node.features.length) },
            {
              label: "Threads",
              value: String(node.features.reduce((total, feature) => total + feature.threadCount, 0)),
            },
          ]}
        >
          {node.features.map((feature) => (
            <FeatureNode
              key={feature.feature.id}
              node={feature}
              handlers={handlers}
              actions={actions}
            />
          ))}
        </GroupShell>
      ))}
      <NewFeatureRow onCreate={onCreate} />
      {archived.length === 0 ? null : (
        <section aria-label="Finished features">
          <ShelfHeader
            label="Finished"
            count={archived.length}
            expanded={archivedOpen}
            onToggle={() => setArchivedOpen((open) => !open)}
          />
          {archivedOpen ? (
            <ul className="flex flex-col gap-px">
              {archived.map((feature) => (
                <li
                  key={feature.id}
                  className="group/project relative flex h-7 items-center gap-1.5 rounded-md px-1.5 hover:bg-sidebar-accent/60"
                >
                  <ProjectBadge
                    projectId={feature.id}
                    name={feature.name}
                    badge={projectBadgePresentation(feature.id, undefined)}
                    icon={undefined}
                  />
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {feature.name}
                  </span>
                  <RowActions>
                    <RowActionButton
                      label={`Reopen ${feature.name}`}
                      icon="ArchiveRestore"
                      onClick={() => onReopen(feature.id)}
                    />
                    <RowActionButton
                      label={`Delete ${feature.name}`}
                      icon="Trash2"
                      onClick={() => actions.onDelete(feature.id)}
                    />
                  </RowActions>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      )}
    </>
  );
}

/** The quiet row under the last feature: the one place a feature starts. */
export function NewFeatureRow({ onCreate }: { onCreate: () => void }) {
  return (
    <button
      type="button"
      onClick={onCreate}
      className="mt-1 flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-xs text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <span className="flex size-5 shrink-0 items-center justify-center rounded-md border border-dashed border-sidebar-border">
        <Icon name="Plus" className="size-3" aria-hidden />
      </span>
      New feature
    </button>
  );
}
