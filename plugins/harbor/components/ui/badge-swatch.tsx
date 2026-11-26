import type { CSSProperties, ReactNode } from "react";
import { isCjkGlyph } from "@/lib/domain/project-colors";
import { cn } from "@/lib/ui/utils";

export function BadgeSwatch({
  backgroundColor,
  foregroundColor: _foregroundColor,
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
  const cjk = typeof children === "string" && isCjkGlyph(children.trim());
  return (
    <span
      aria-hidden
      data-harbor-project-badge={projectId}
      className={cn(
        "harbor-project-badge flex shrink-0 select-none items-center justify-center rounded-[6px] border leading-none",
        cjk ? "font-medium" : "font-semibold uppercase tracking-tight",
        className,
      )}
      style={{ "--harbor-badge-accent": backgroundColor } as CSSProperties}
    >
      {children}
    </span>
  );
}
