import type { ReactNode } from "react";
import { cn } from "@/lib/ui/utils";
import { bestBadgeForeground } from "@/lib/domain/project-colors";

export function BadgeSwatch({
  backgroundColor,
  foregroundColor,
  projectId,
  className,
  children,
}: {
  backgroundColor: string;
  foregroundColor?: "#000000" | "#FFFFFF";
  projectId?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <span
      aria-hidden
      data-harbor-project-badge={projectId}
      className={cn(
        "flex shrink-0 items-center justify-center border font-semibold uppercase",
        className,
      )}
      style={{
        backgroundColor,
        color: foregroundColor ?? bestBadgeForeground(backgroundColor),
      }}
    >
      {children}
    </span>
  );
}
