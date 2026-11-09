import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Feature } from "@/lib/features";
import { cn } from "@/lib/utils";

/**
 * Which features the feature view draws.
 *
 * A list of features grows past the point where every one belongs on screen at
 * once, so the view starts on all of them and this narrows it. Unchecked
 * features are remembered as hidden, which is what makes a feature created
 * later visible without being ticked first.
 *
 * The surface is the sidebar's own popover and checkbox, laid out like its
 * menus: a header row that selects or clears everything, then one checkbox row
 * per feature. No second look for a control that already exists.
 */
export function FeatureSelector({
  features,
  hidden,
  onSetHidden,
  onSetAllHidden,
}: {
  features: readonly Feature[];
  /** Ids the user unchecked. */
  hidden: readonly string[];
  onSetHidden: (featureId: string, hidden: boolean) => void;
  onSetAllHidden: (featureIds: readonly string[], hidden: boolean) => void;
}) {
  const hiddenIds = new Set(hidden);
  const shownCount = features.filter((feature) => !hiddenIds.has(feature.id)).length;
  const allShown = features.length > 0 && shownCount === features.length;
  const label =
    features.length === 0
      ? "No features"
      : allShown
        ? "All features"
        : `${shownCount}/${features.length} features`;
  const ids = features.map((feature) => feature.id);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Features shown: ${label}`}
          title="Choose which features to show"
          className={cn(
            "flex h-6 min-w-0 items-center gap-1 rounded-md px-1.5 text-2xs",
            "text-muted-foreground transition-colors duration-150 ease-out motion-reduce:transition-none",
            "hover:bg-sidebar-accent hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            !allShown && "bg-primary/10 text-primary",
          )}
        >
          <Icon name="ListFilter" className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <div className="border-b border-border px-2 py-1.5">
          <label className="flex cursor-pointer items-center gap-2">
            <Checkbox
              checked={allShown}
              disabled={features.length === 0}
              onCheckedChange={(value) => onSetAllHidden(ids, value !== true)}
            />
            <span className="min-w-0 flex-1 truncate text-2xs font-medium text-foreground">
              All features
            </span>
            <span className="shrink-0 text-2xs text-muted-foreground">
              {shownCount}/{features.length}
            </span>
          </label>
        </div>
        <ul className="max-h-64 overflow-y-auto p-1">
          {features.length === 0 ? (
            <li className="px-2 py-2 text-2xs text-muted-foreground">
              No features yet
            </li>
          ) : (
            features.map((feature) => {
              const shown = !hiddenIds.has(feature.id);
              return (
                <li key={feature.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-accent/60">
                    <Checkbox
                      checked={shown}
                      onCheckedChange={(value) =>
                        onSetHidden(feature.id, value !== true)
                      }
                    />
                    <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                      {feature.name}
                    </span>
                  </label>
                </li>
              );
            })
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
