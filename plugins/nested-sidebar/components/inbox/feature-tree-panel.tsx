import { useState } from "react";

import { FeatureNode, type FeatureRowActions } from "@/components/inbox/feature-node";
import { ShelfHeader } from "@/components/inbox/parked-shelf";
import { ProjectBadge } from "@/components/inbox/project-node";
import { RowActionButton, RowActions } from "@/components/inbox/row-actions";
import type { TreeRowHandlers } from "@/components/inbox/tree-row-types";
import { Icon } from "@/components/ui/icon";
import { useFeatureSelector } from "@/hooks/use-feature-selector";
import type { FeatureNode as FeatureNodeModel } from "@/lib/feature-view";
import type { Feature } from "@/lib/features";
import { projectBadgePresentation } from "@/lib/project-colors";

export interface FeaturesSectionProps {
  readonly nodes: readonly FeatureNodeModel[];
  /** Every feature, for the selector; the nodes are the ones it left in. */
  readonly features: readonly Feature[];
  readonly actions: FeatureRowActions;
  readonly onCreate: () => void;
  /**
   * Draw the header with nothing under it.
   *
   * True where the section is the place a feature starts — All and Features
   * with nothing narrowing the list. A group tab, a filter or a search with no
   * feature to show draws no header at all.
   */
  readonly showWhenEmpty: boolean;
}

/**
 * The Features section, above the groups in both modes.
 *
 * A feature is the work itself, so it sits before the projects it touches and
 * is filed under none of them. The header holds the two things that act on the
 * list rather than on one feature: make one, and choose which are shown.
 */
export function FeaturesSection({
  nodes,
  features,
  actions,
  onCreate,
  showWhenEmpty,
  handlers,
}: FeaturesSectionProps & { handlers: TreeRowHandlers }) {
  const { selector, allHidden } = useFeatureSelector(features);
  if (nodes.length === 0 && !showWhenEmpty) return null;
  return (
    <section aria-label="Features" data-nest-features-section="" className="mb-1">
      <h2 className="flex h-6.5 items-center gap-2 px-1.5">
        <span className="text-2xs font-medium text-muted-foreground/70">Features</span>
        <span className="h-px flex-1 bg-sidebar-border" />
        <RowActions>
          {selector}
          <RowActionButton label="New feature" icon="Plus" onClick={onCreate} />
        </RowActions>
      </h2>
      {nodes.map((node) => (
        <FeatureNode key={node.feature.id} node={node} handlers={handlers} actions={actions} />
      ))}
      {nodes.length > 0 ? null : allHidden ? (
        <p className="px-1.5 py-1 text-2xs text-muted-foreground">No features selected</p>
      ) : (
        <NewFeatureRow onCreate={onCreate} />
      )}
    </section>
  );
}

/**
 * Finished features, on a shelf beside Snoozed and Settled.
 *
 * Finishing is a lifecycle step like settling a thread, so it is put away in
 * the same place and read the same way: a rule, a count, a chevron.
 */
export function FinishedShelf({
  archived,
  onReopen,
  onDelete,
}: {
  archived: readonly Feature[];
  onReopen: (featureId: string) => void;
  onDelete: (featureId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (archived.length === 0) return null;
  return (
    <section aria-label="Finished features">
      <ShelfHeader
        label="Finished"
        count={archived.length}
        expanded={open}
        onToggle={() => setOpen((value) => !value)}
      />
      {open ? (
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
                  onClick={() => onDelete(feature.id)}
                />
              </RowActions>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** The quiet row an empty section draws: the one place a feature starts. */
export function NewFeatureRow({ onCreate }: { onCreate: () => void }) {
  return (
    <button
      type="button"
      onClick={onCreate}
      className="flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-xs text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <span className="flex size-5 shrink-0 items-center justify-center rounded-md border border-dashed border-sidebar-border">
        <Icon name="Plus" className="size-3" aria-hidden />
      </span>
      New feature
    </button>
  );
}

/**
 * The line a project draws for its worktrees that live under a feature.
 *
 * A member worktree is drawn under its feature and nowhere else, so a person
 * looking for it under its project finds this instead: how many, and the way
 * to the first feature holding one.
 */
export function InFeaturesLine({
  count,
  onReveal,
}: {
  count: number;
  onReveal: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onReveal}
      title="Show in the Features section"
      className="flex h-6 w-full min-w-0 items-center gap-1.5 rounded-md pl-4 pr-1.5 text-left text-2xs text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <span aria-hidden className="flex size-3 shrink-0 items-center justify-center">
        ↗
      </span>
      <span className="min-w-0 flex-1 truncate">{count} in features</span>
    </button>
  );
}
