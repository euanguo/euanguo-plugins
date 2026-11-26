import { useState } from "react";

import { FeatureNode, type FeatureRowActions } from "@/components/inbox/feature-node";
import { ShelfHeader } from "@/components/inbox/parked-shelf";
import { ProjectBadge } from "@/components/inbox/project-node";
import { RowActionButton, RowActions } from "@/components/inbox/row-actions";
import { Icon } from "@/components/ui/icon";
import type { FeatureNode as FeatureNodeModel } from "@/lib/domain/feature-view";
import type { Feature } from "@/lib/domain/features";
import { projectBadgePresentation } from "@/lib/domain/project-colors";

export interface FeaturesSectionProps {
  readonly nodes: readonly FeatureNodeModel[];
  readonly actions: FeatureRowActions;
  readonly onCreate: () => void;
  /**
   * Draw the empty-state prompt row when unnarrowed, since it is where a
   * new feature starts.
   */
  readonly showWhenEmpty: boolean;
}

/**
 * The Features list rendered on the dedicated Features surface.
 *
 * The surface toolbar already provides the filter tabs and top-level
 * "+ New feature" trigger, so rows begin immediately without duplicating the
 * heading or button.
 */
export function FeaturesSection({
  nodes,
  actions,
  onCreate,
  showWhenEmpty,
}: FeaturesSectionProps) {
  if (nodes.length === 0 && !showWhenEmpty) return null;
  return (
    <section aria-label="Features" data-harbor-features-section="" className="mb-1">
      {nodes.map((node) => (
        <FeatureNode key={node.feature.id} node={node} actions={actions} />
      ))}
      {nodes.length > 0 ? null : <NewFeatureRow onCreate={onCreate} />}
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
      <Icon
        name="ChevronRight"
        className="size-3 shrink-0 text-muted-foreground/70"
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate">{count} in features</span>
    </button>
  );
}
