import { Icon } from "@/components/ui/icon";
import type { IconName } from "@/components/ui/icon";
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
  onChange,
}: {
  mode: SidebarMode;
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
          </button>
        );
      })}
    </div>
  );
}
