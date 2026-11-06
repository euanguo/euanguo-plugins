import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import {
  ORGANIZATION_LABELS,
  type OrganizationMode,
} from "@/lib/organization";

/**
 * Which axis the whole list is drawn on.
 *
 * It sits below the scrolling list rather than in the header. The header holds
 * what narrows what is on screen right now; a tab strip there would compete
 * with the group tabs. The axis is a standing choice, and the bottom of the
 * list is where a standing choice belongs.
 *
 * Only the two the user switches between while working are here. The third mode
 * stays in the view menu, where every view decision already lives.
 */
export function OrganizationSwitch({
  mode,
  onChange,
}: {
  mode: OrganizationMode;
  onChange: (mode: OrganizationMode) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Organize the sidebar by"
      className="flex h-7 shrink-0 items-center gap-0.5 border-t border-sidebar-border/70 px-1.5"
    >
      <SwitchButton
        active={mode === "project"}
        mode="project"
        icon="Layers"
        onClick={() => onChange("project")}
      />
      <SwitchButton
        active={mode === "feature"}
        mode="feature"
        icon="Tag"
        onClick={() => onChange("feature")}
      />
    </div>
  );
}

function SwitchButton({
  active,
  mode,
  icon,
  onClick,
}: {
  active: boolean;
  mode: Extract<OrganizationMode, "project" | "feature">;
  icon: "Layers" | "Tag";
  onClick: () => void;
}) {
  const label = ORGANIZATION_LABELS[mode];
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      title={label}
      onClick={onClick}
      className={cn(
        "flex h-5 flex-1 items-center justify-center gap-1 rounded-md text-2xs",
        "transition-colors duration-150 ease-out motion-reduce:transition-none",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        active
          ? "bg-sidebar-accent font-medium text-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground",
      )}
    >
      <Icon name={icon} className="size-3" aria-hidden />
      {label}
    </button>
  );
}
