import { Icon } from "@bb-ui/icon";
import { cn } from "@/lib/ui/utils";
import { canonicalGroupIcon, type GroupIconName } from "@/lib/domain/group-icons";

/**
 * Monochrome BB vector icon for a sidebar group or section header.
 */
export function GroupIcon({
  name,
  className,
  ariaHidden,
  ariaLabel,
}: {
  name: GroupIconName | string;
  className?: string;
  ariaHidden?: boolean | "true" | "false";
  ariaLabel?: string;
  /** Kept for caller compatibility; vector icons need no deferred fetch. */
  defer?: boolean;
}) {
  const iconName = canonicalGroupIcon(name);
  const sharedClass = cn(
    "inline-flex size-3.5 shrink-0 items-center justify-center text-muted-foreground",
    className,
  );
  if (ariaLabel !== undefined) {
    return (
      <span
        className={sharedClass}
        role="img"
        aria-hidden={ariaHidden}
        aria-label={ariaLabel}
        data-group-icon={iconName}
      >
        <Icon name={iconName} className="size-full" aria-hidden />
      </span>
    );
  }
  return (
    <span
      className={sharedClass}
      aria-hidden={ariaHidden}
      data-group-icon={iconName}
    >
      <Icon name={iconName} className="size-full" aria-hidden />
    </span>
  );
}
