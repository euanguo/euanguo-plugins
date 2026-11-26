import type { ReactNode } from "react";

import { Icon, type IconName } from "@bb-ui/icon";
import { cn } from "@/lib/ui/utils";

export interface SegmentedBarItem<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly icon: IconName;
  readonly title?: string;
  readonly ariaControls?: string;
  readonly badge?: ReactNode;
}

/**
 * Shared equal-width two-option segmented tab bar for sidebar switches.
 */
export function SegmentedBar<T extends string>({
  value,
  items,
  ariaLabel,
  className,
  steadyLabel = false,
  onChange,
}: {
  readonly value: T;
  readonly items: readonly SegmentedBarItem<T>[];
  readonly ariaLabel: string;
  readonly className?: string;
  readonly steadyLabel?: boolean;
  readonly onChange: (value: T) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn("flex h-8 shrink-0 items-center gap-0.5 px-1.5", className)}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={item.ariaControls}
            title={item.title}
            onClick={() => onChange(item.value)}
            className={cn(
              "relative flex h-6 flex-1 items-center justify-center gap-1 rounded-md text-2xs",
              "transition-colors duration-150 ease-out motion-reduce:transition-none",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              active
                ? "bg-sidebar-accent font-medium text-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground",
            )}
          >
            <Icon name={item.icon} className="size-3" aria-hidden />
            {steadyLabel ? (
              <span className="grid justify-items-center">
                <span aria-hidden className="invisible col-start-1 row-start-1 font-medium">
                  {item.label}
                </span>
                <span className={cn("col-start-1 row-start-1", active && "font-medium")}>
                  {item.label}
                </span>
              </span>
            ) : (
              item.label
            )}
            {item.badge}
          </button>
        );
      })}
    </div>
  );
}
