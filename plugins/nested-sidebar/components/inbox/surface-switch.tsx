import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { StatusDot } from "@/components/inbox/family-status";
import { cn } from "@/lib/ui/utils";
import { familyStatusPresentation } from "@/lib/domain/family-status";
import type { FamilyStatusKind } from "@/lib/domain/family-status";
import { SIDEBAR_SURFACES, type SidebarSurface } from "@/lib/ui/view-state";

const SURFACE_LABELS: Readonly<Record<SidebarSurface, string>> = {
  features: "Features",
  projects: "Projects",
};

const SURFACE_ICONS: Readonly<Record<SidebarSurface, string>> = {
  features: "Puzzle",
  projects: "Layers",
};

/**
 * Features or projects: which list the sidebar is showing.
 *
 * It sits directly under the panel's own header, above everything the tree
 * draws, because it is a destination rather than a filter: picking Features
 * takes the group strip and the projects away entirely.
 *
 * Drawn like the axis switch at the bottom of the sidebar — a rule, one row
 * high, two halves that fill it, a fill on the chosen one — because the two are
 * the same kind of gesture even though they answer different questions.
 *
 * The count and the dot are what the old Features tab carried in the strip. A
 * feature at work is the reason to look, and with the tab gone this is the only
 * place that can say so while the project list is on screen.
 */
export function SurfaceSwitch({
  surface,
  featureCount,
  featureStatus,
  panelId,
  onChange,
}: {
  surface: SidebarSurface;
  featureCount: number;
  featureStatus: FamilyStatusKind | null;
  /** The element both choices draw into. */
  panelId: string;
  onChange: (surface: SidebarSurface) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="What the sidebar lists"
      className="flex h-8 shrink-0 items-center gap-0.5 border-b border-sidebar-border/70 px-1.5"
    >
      {SIDEBAR_SURFACES.map((value) => {
        const active = value === surface;
        return (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={panelId}
            onClick={() => onChange(value)}
            className={cn(
              "relative flex h-6 flex-1 items-center justify-center gap-1 rounded-md text-2xs",
              "transition-colors duration-150 ease-out motion-reduce:transition-none",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              active
                ? "bg-sidebar-accent font-medium text-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground",
            )}
          >
            <Icon name={SURFACE_ICONS[value]} className="size-3" aria-hidden />
            <SteadyLabel bold={active}>{SURFACE_LABELS[value]}</SteadyLabel>
            {value !== "features" ? null : (
              <>
                {featureCount > 0 ? (
                  <span className="tabular-nums opacity-70">{featureCount}</span>
                ) : null}
                {featureStatus === null ? null : (
                  <StatusDot
                    status={familyStatusPresentation(featureStatus)}
                    className="absolute right-0.5 top-0.5"
                  />
                )}
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A label that is bold when chosen without changing width.
 *
 * Bolder text is wider text, and a button whose label widens on selection reads
 * as the control growing under the pointer. Both weights are laid out in the
 * same grid cell, so the box is always the bold one's width and only the ink
 * changes when the choice moves.
 */
function SteadyLabel({
  bold,
  children,
}: {
  bold: boolean;
  children: ReactNode;
}) {
  return (
    <span className="grid justify-items-center">
      <span aria-hidden className="invisible col-start-1 row-start-1 font-medium">
        {children}
      </span>
      <span className={cn("col-start-1 row-start-1", bold && "font-medium")}>
        {children}
      </span>
    </span>
  );
}
