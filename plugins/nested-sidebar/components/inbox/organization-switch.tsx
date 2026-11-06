import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { OrganizationMode } from "@/lib/organization";

/**
 * The project and feature views of the same tree.
 *
 * It sits below the scrolling list rather than in the header. The header holds
 * what narrows what is on screen right now, and a tab strip there would compete
 * with the group tabs. Which axis the whole list is drawn on is a standing
 * choice, and the bottom of the list is where a standing choice belongs.
 *
 * Modes that are not on this switch are reachable from the view menu. The switch
 * only carries the two that a person changes while working; drawing all three
 * here would make the most-used pair smaller for no gain.
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
      className="flex shrink-0 items-center gap-1 border-t border-sidebar-border/70 px-1.5 py-1"
    >
      <SwitchButton
        active={mode === "project"}
        label="项目"
        title="按项目组织"
        icon="Folder"
        onClick={() => onChange("project")}
      />
      <SwitchButton
        active={mode === "feature"}
        label="功能"
        title="按功能组织"
        icon="Tag"
        onClick={() => onChange("feature")}
      />
    </div>
  );
}

function SwitchButton({
  active,
  label,
  title,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  title: string;
  icon: "Folder" | "Tag";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      title={title}
      onClick={onClick}
      className={cn(
        "flex h-6 flex-1 items-center justify-center gap-1 rounded-md text-2xs font-medium",
        "transition-colors duration-150 ease-out motion-reduce:transition-none",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        active
          ? "bg-sidebar-accent text-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
      )}
    >
      <Icon name={icon} className="size-3" aria-hidden />
      {label}
    </button>
  );
}
