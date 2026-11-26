import { useState, type ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb-ui/tooltip";

import { Z_HOVER } from "@/components/ui/overlay-layers";
import { useIsHoverSuppressed } from "@/lib/ui/overlay-coordinator";
import { cn } from "@/lib/ui/utils";

/**
 * Shared tooltip timing scope mounted at top-level plugin roots (`ThreadInbox`,
 * `WorkspaceTabs`) so every portaled row tooltip shares delay state cleanly.
 */
export function HarborTooltipProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={350} skipDelayDuration={100}>
      {children}
    </TooltipProvider>
  );
}

/**
 * Portaled tooltip backed by BB's shared `@bb-ui/tooltip` primitive and
 * gated through `overlayCoordinator` so active menus/dialogs dismiss it.
 */
export function HarborTooltip({
  content,
  children,
  disabled = false,
  side = "top",
  align = "center",
  className,
}: {
  content: ReactNode;
  children: ReactNode;
  disabled?: boolean;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const hoverSuppressed = useIsHoverSuppressed();

  if (disabled) return <>{children}</>;

  return (
    <Tooltip
      open={hoverSuppressed ? false : open}
      onOpenChange={(nextOpen) => setOpen(hoverSuppressed ? false : nextOpen)}
    >
      <TooltipTrigger asChild data-harbor-tooltip-trigger="">
        {children}
      </TooltipTrigger>
      <TooltipContent
        data-radix-tooltip-content=""
        side={side}
        align={align}
        className={cn(Z_HOVER, "px-2 py-1 text-left text-2xs leading-tight", className)}
      >
        {content}
      </TooltipContent>
    </Tooltip>
  );
}
