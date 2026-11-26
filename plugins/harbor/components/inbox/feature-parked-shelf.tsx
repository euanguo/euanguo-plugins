import type { FeatureRowActions } from "@/components/inbox/feature-node";
import { ShelfHeader } from "@/components/inbox/parked-shelf";
import { ProjectBadge } from "@/components/inbox/project-node";
import {
  RowActionButton,
  RowActions,
} from "@/components/inbox/row-actions";
import {
  RowMenu,
  RowMenuButton,
  type RowMenuItem,
} from "@/components/inbox/row-context-menu";
import { InfoCard } from "@/components/ui/hover-card";
import { Icon } from "@/components/ui/icon";
import type { Feature } from "@/lib/domain/features";
import { formatWakeLabel, parkReasonLabel } from "@/lib/domain/feature-view";
import { projectBadgePresentation } from "@/lib/domain/project-colors";
import { formatHomePathForDisplay } from "@/lib/ui/utils";

export { formatWakeLabel, parkReasonLabel };

function ParkedFeatureRow({
  feature,
  now,
  actions,
  onUnpark,
  onFinish,
  onDelete,
}: {
  readonly feature: Feature;
  readonly now: number;
  readonly actions?: FeatureRowActions;
  readonly onUnpark: (featureId: string) => void;
  readonly onFinish: (featureId: string) => void;
  readonly onDelete: (featureId: string) => void;
}) {
  const reason = parkReasonLabel(feature.parkedReason);
  const wake = formatWakeLabel(feature.wakeAt, now);
  const items: RowMenuItem[] = [
    ...(actions
      ? [
          {
            key: "open-hub",
            icon: "Layers" as const,
            label: "Open Feature Hub",
            onSelect: () => actions.onOpenHub(feature.id, "overview"),
          },
        ]
      : []),
    {
      key: "wake",
      icon: "Play",
      label: "Wake feature",
      ...(actions ? { separatorBefore: true } : {}),
      onSelect: () => onUnpark(feature.id),
    },
    {
      key: "finish",
      icon: "Archive",
      label: "Finish feature…",
      separatorBefore: true,
      onSelect: () => onFinish(feature.id),
    },
    {
      key: "delete",
      icon: "Trash2",
      label: "Delete feature…",
      destructive: true,
      onSelect: () => onDelete(feature.id),
    },
  ];

  const triggerRow = (
    <RowMenu label={`Actions for ${feature.name}`} items={items}>
      <li
        data-harbor-parked-feature={feature.id}
        className="group/project relative flex flex-col gap-0.5 rounded-md px-1.5 py-1 hover:bg-sidebar-accent/60"
      >
        {actions ? (
          <button
            type="button"
            aria-label={`Open Feature Hub for ${feature.name}`}
            title={`Open Feature Hub for ${feature.name}`}
            onClick={() => actions.onOpenHub(feature.id, "overview")}
            className="absolute inset-0 rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        ) : null}
        <div className="flex items-center gap-1.5">
          <ProjectBadge
            projectId={feature.id}
            name={feature.name}
            badge={projectBadgePresentation(feature.id, undefined)}
            icon={undefined}
          />
          <span className="pointer-events-none relative min-w-0 flex-1 truncate text-xs font-medium text-foreground/90">
            {feature.name}
          </span>
          {reason === null ? null : (
            <span className="pointer-events-none relative shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground">
              {reason}
            </span>
          )}
          <RowActions>
            <RowActionButton
              label={`Wake ${feature.name}`}
              icon="Play"
              onClick={() => onUnpark(feature.id)}
            />
            <RowMenuButton label={`Actions for ${feature.name}`} items={items} />
          </RowActions>
        </div>
        {feature.parkedNote ? (
          <p className="pointer-events-none relative truncate pl-6 text-2xs text-muted-foreground">
            {feature.parkedNote}
          </p>
        ) : null}
        {wake || feature.wakeOnActivity ? (
          <div className="pointer-events-none relative flex items-center gap-2 pl-6 text-[10px] text-muted-foreground/80">
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
    </RowMenu>
  );

  return (
    <InfoCard
      trigger={triggerRow}
      label={feature.name}
      rows={[
        { label: "Status", value: "Parked" },
        ...(reason === null ? [] : [{ label: "Reason", value: reason }]),
        ...(feature.parkedNote ? [{ label: "Note", value: feature.parkedNote }] : []),
        ...(wake ? [{ label: "Reminder", value: wake }] : []),
        { label: "Auto-wake", value: feature.wakeOnActivity ? "On" : "Off" },
        ...(feature.rootPath === null
          ? []
          : [
              {
                label: "Folder",
                value: formatHomePathForDisplay(feature.rootPath),
                copyValue: feature.rootPath,
                mono: true,
                copy: true,
              },
            ]),
      ]}
    />
  );
}

export function ParkedFeaturesShelf({
  parked,
  now,
  expanded,
  onToggle,
  actions,
  onUnpark,
  onFinish,
  onDelete,
}: {
  readonly parked: readonly Feature[];
  readonly now: number;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly actions?: FeatureRowActions;
  readonly onUnpark: (featureId: string) => void;
  readonly onFinish: (featureId: string) => void;
  readonly onDelete: (featureId: string) => void;
}) {
  if (parked.length === 0) return null;
  const dueCount = parked.filter(
    (feature) =>
      typeof feature.wakeAt === "number" &&
      Number.isFinite(feature.wakeAt) &&
      feature.wakeAt <= now,
  ).length;
  const label = dueCount > 0 ? `Parked · ${dueCount} due` : "Parked";

  return (
    <section aria-label="Parked features" data-harbor-parked-features="" className="mt-1 mb-1">
      <ShelfHeader
        label={label}
        count={parked.length}
        expanded={expanded}
        onToggle={onToggle}
      />
      {expanded ? (
        <ul className="flex flex-col gap-0.5 pl-1">
          {parked.map((feature) => (
            <ParkedFeatureRow
              key={feature.id}
              feature={feature}
              now={now}
              actions={actions}
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
