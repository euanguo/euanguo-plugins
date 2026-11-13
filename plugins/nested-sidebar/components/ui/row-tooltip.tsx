import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The one drawn hover/focus label for row controls. The calling control owns
 * the group name and `aria-describedby`; `className` only moves or resizes the
 * bubble for that control's trailing position.
 */
export function RowTooltip({
  id,
  content,
  className,
}: {
  id: string;
  content: ReactNode;
  className?: string;
}) {
  return (
    <span
      id={id}
      role="tooltip"
      className={cn(
        "pointer-events-none absolute bottom-full right-0 z-30 mb-1 w-max max-w-[min(14rem,calc(100cqw-1rem))] translate-y-0.5 rounded-md border border-border bg-popover px-2 py-1.5 text-left text-2xs leading-tight text-popover-foreground opacity-0 shadow-md transition-all duration-150 ease-out motion-reduce:transition-none",
        className,
      )}
    >
      {content}
    </span>
  );
}
