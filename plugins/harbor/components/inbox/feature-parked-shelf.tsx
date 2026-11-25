import { useState } from "react";

import { ShelfHeader } from "@/components/inbox/parked-shelf";
import { ProjectBadge } from "@/components/inbox/project-node";
import {
  RowActionButton,
  RowActions,
  useRowReveal,
} from "@/components/inbox/row-actions";
import { Icon } from "@/components/ui/icon";
import type { Feature } from "@/lib/domain/features";
import { formatWakeLabel, parkReasonLabel } from "@/lib/domain/feature-view";
import { projectBadgePresentation } from "@/lib/domain/project-colors";

export { formatWakeLabel, parkReasonLabel };

function ParkedFeatureRow({
  feature,
  now,
  onUnpark,
  onFinish,
  onDelete,
}: {
  readonly feature: Feature;
  readonly now: number;
  readonly onUnpark: (featureId: string) => void;
  readonly onFinish: (featureId: string) => void;
  readonly onDelete: (featureId: string) => void;
}) {
  const reveal = useRowReveal<HTMLLIElement>();
  const reason = parkReasonLabel(feature.parkedReason);
  const wake = formatWakeLabel(feature.wakeAt, now);

  return (
    <li
      ref={reveal.ref}
      data-harbor-parked-feature={feature.id}
      className="group/project relative flex flex-col gap-0.5 rounded-md px-1.5 py-1 hover:bg-sidebar-accent/60"
      {...reveal.handlers}
    >
      <div className="flex items-center gap-1.5">
        <ProjectBadge
          projectId={feature.id}
          name={feature.name}
          badge={projectBadgePresentation(feature.id, undefined)}
          icon={undefined}
        />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground/90">
          {feature.name}
        </span>
        {reason === null ? null : (
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground">
            {reason}
          </span>
        )}
        <RowActions>
          <RowActionButton
            label={`Wake ${feature.name}`}
            icon="Play"
            onClick={() => onUnpark(feature.id)}
          />
          {reveal.revealed ? (
            <>
              <RowActionButton
                label={`Finish ${feature.name}`}
                icon="Archive"
                onClick={() => onFinish(feature.id)}
              />
              <RowActionButton
                label={`Delete ${feature.name}`}
                icon="Trash2"
                onClick={() => onDelete(feature.id)}
              />
            </>
          ) : null}
        </RowActions>
      </div>
      {feature.parkedNote ? (
        <p className="truncate pl-6 text-2xs text-muted-foreground">
          {feature.parkedNote}
        </p>
      ) : null}
      {wake || feature.wakeOnActivity ? (
        <div className="flex items-center gap-2 pl-6 text-[10px] text-muted-foreground/80">
          {wake ? (
            <span className="inline-flex shrink-0 items-center gap-0.5 tabular-nums">
              <Icon name="Clock" className="size-2.5" aria-hidden />
              {wake}
            </span>
          ) : null}
          {feature.wakeOnActivity ? (
            <span title="Wakes automatically on new thread activity">
              Auto-wake
            </span>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function ParkedFeaturesShelf({
  parked,
  now,
  onUnpark,
  onFinish,
  onDelete,
}: {
  readonly parked: readonly Feature[];
  readonly now: number;
  readonly onUnpark: (featureId: string) => void;
  readonly onFinish: (featureId: string) => void;
  readonly onDelete: (featureId: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  if (parked.length === 0) return null;

  return (
    <section aria-label="Parked features" data-harbor-parked-features="" className="mt-1 mb-1">
      <ShelfHeader
        label="Parked"
        count={parked.length}
        expanded={expanded}
        onToggle={() => setExpanded((value) => !value)}
      />
      {expanded ? (
        <ul className="flex flex-col gap-0.5 pl-1">
          {parked.map((feature) => (
            <ParkedFeatureRow
              key={feature.id}
              feature={feature}
              now={now}
              onUnpark={onUnpark}
              onFinish={onFinish}
              onDelete={onDelete}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
