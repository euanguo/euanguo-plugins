import { StatusDot } from "@/components/inbox/family-status";
import { familyStatusPresentation } from "@/lib/domain/family-status";
import { Icon } from "@/components/ui/icon";
import type { IconName } from "@/components/ui/icon";
import type { StatusSignal } from "@/lib/domain/rollup";
import { cn } from "@/lib/ui/utils";
import {
  SIDEBAR_MODE_LABELS,
  type SidebarMode,
} from "@/lib/domain/organization";

const AXES: readonly { mode: SidebarMode; icon: IconName; short: string }[] = [
  { mode: "threads", icon: "Layers", short: "Threads" },
  { mode: "workspaces", icon: "FolderGit", short: "Workspaces" },
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
  projectSignals,
  workspaceSignals,
  onChange,
}: {
  mode: SidebarMode;
  /** What the thread tree is doing, for the dots on its option. */
  projectSignals: readonly StatusSignal[];
  /** What the physical workspace tree is doing, for the dots on its option. */
  workspaceSignals: readonly StatusSignal[];
  onChange: (mode: SidebarMode) => void;
}) {
  const axes = AXES;
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
            title={SIDEBAR_MODE_LABELS[axis.mode]}
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
                axis.mode === "threads" ? projectSignals : workspaceSignals
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
