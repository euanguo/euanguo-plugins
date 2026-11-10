import { StatusDot } from "@/components/inbox/family-status";
import { familyStatusPresentation } from "@/lib/family-status";
import { Icon } from "@/components/ui/icon";
import type { IconName } from "@/components/ui/icon";
import type { StatusSignal } from "@/lib/rollup";
import { cn } from "@/lib/utils";
import {
  ORGANIZATION_LABELS,
  type OrganizationMode,
} from "@/lib/organization";

const AXES: readonly { mode: OrganizationMode; icon: IconName; short: string }[] = [
  { mode: "project", icon: "Layers", short: "Projects" },
  { mode: "feature", icon: "Tag", short: "Features" },
  { mode: "machine", icon: "Server", short: "Machines" },
];

/**
 * Which axis the whole list is drawn on — the one place it is chosen.
 *
 * It sits below the scrolling list rather than in the header. The header holds
 * what narrows what is on screen right now; the axis is a standing choice, and
 * the bottom of the list is where a standing choice belongs.
 *
 * By machine is offered only when there is more than one machine: with one, it
 * draws a single section holding everything, which is the project view with a
 * worse first level.
 */
export function OrganizationSwitch({
  mode,
  machines,
  showFeatures,
  projectSignals,
  featureSignals,
  onChange,
}: {
  mode: OrganizationMode;
  /** How many machines the sidebar knows of. */
  machines: number;
  /** False hides the Feature axis; its data stays, ready if it comes back. */
  showFeatures: boolean;
  /** What the project list is doing, for the dots on its option. */
  projectSignals: readonly StatusSignal[];
  /** What the feature view is doing, for the dots on its option. */
  featureSignals: readonly StatusSignal[];
  onChange: (mode: OrganizationMode) => void;
}) {
  const axes = AXES.filter(
    (axis) =>
      (axis.mode !== "machine" || machines > 1 || mode === "machine") &&
      (axis.mode !== "feature" || showFeatures),
  );
  return (
    <div
      role="tablist"
      aria-label="Organize the sidebar by"
      className="flex h-8 shrink-0 items-center gap-0.5 border-t border-sidebar-border/70 px-1.5"
    >
      {axes.map((axis) => {
        const active = axis.mode === mode;
        return (
          <button
            key={axis.mode}
            type="button"
            role="tab"
            aria-selected={active}
            title={ORGANIZATION_LABELS[axis.mode]}
            onClick={() => onChange(axis.mode)}
            className={cn(
              "relative flex h-6 flex-1 items-center justify-center gap-1 rounded-md text-2xs",
              "transition-colors duration-150 ease-out motion-reduce:transition-none",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              active
                ? "bg-sidebar-accent font-medium text-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground",
            )}
          >
            <Icon name={axis.icon} className="size-3" aria-hidden />
            {axis.short}
            <StatusDotCluster
              surface={active ? "accent" : "bar"}
              signals={
                axis.mode === "project"
                  ? projectSignals
                  : axis.mode === "feature"
                    ? featureSignals
                    : []
              }
            />
          </button>
        );
      })}
    </div>
  );
}

/**
 * The switch's status dots: one per kind, stacked when there is more than one.
 *
 * They sit in the option's top-right corner rather than beside its label, so a
 * button never changes width because the queue got busy. Each dot carries a
 * ring in the surface colour, which is what keeps an overlapped pair readable
 * as two dots instead of one wide smear.
 */
function StatusDotCluster({
  signals,
  surface,
}: {
  signals: readonly StatusSignal[];
  surface: "accent" | "bar";
}) {
  if (signals.length === 0) return null;
  const ring =
    surface === "accent"
      ? "shadow-[0_0_0_2px_var(--sidebar-accent)]"
      : "shadow-[0_0_0_2px_var(--sidebar)]";
  return (
    <span className="absolute right-0.5 top-0.5 flex items-center">
      {signals.map((signal, index) => {
        const presentation = familyStatusPresentation(signal.kind);
        return (
          <StatusDot
            key={signal.kind}
            status={presentation}
            title={`${presentation.label} · ${signal.count}`}
            className={cn(index > 0 && "-ml-[3px]", ring)}
          />
        );
      })}
    </span>
  );
}
