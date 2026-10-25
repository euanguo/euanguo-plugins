import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The plugin's single square icon-button.
 *
 * Every icon affordance in this plugin (the filter trigger, "select threads",
 * "manage groups", row actions, modal close, …) used to spell out its own
 * `flex size-N items-center justify-center rounded-*` run. Because each one was
 * hand-written, they drifted: some were `rounded` (4px), some `rounded-md`
 * (10px), and none carried a stable marker — so a theme had to guess which
 * buttons were "icon buttons" and kept missing the smaller `size-5`/`size-6`
 * ones.
 *
 * This component fixes the shape and, more importantly, stamps
 * `data-bb-icon-button` on the element. That attribute is the seam a palette
 * targets to give the whole family one radius/hover treatment without knowing
 * any aria-label.
 */
export type IconButtonSize = "sm" | "md";

const SIZE_CLASS: Record<IconButtonSize, string> = {
  /** 20px — the inline row affordances (pin, archive, row menu). */
  sm: "size-5",
  /** 24px — the toolbar / group-header affordances. */
  md: "size-6",
};

const TONE_CLASS = {
  default: "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
  destructive: "text-destructive hover:bg-destructive/10",
} as const;

export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: IconButtonSize;
  tone?: keyof typeof TONE_CLASS;
}

export const IconButton = React.forwardRef<
  HTMLButtonElement,
  IconButtonProps
>(({ size = "md", tone = "default", className, type, ...props }, ref) => (
  <button
    {...props}
    ref={ref}
    type={type ?? "button"}
    data-bb-icon-button=""
    className={cn(
      "flex shrink-0 items-center justify-center rounded-md",
      "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
      "disabled:cursor-not-allowed disabled:opacity-40",
      SIZE_CLASS[size],
      TONE_CLASS[tone],
      className,
    )}
  />
));
IconButton.displayName = "IconButton";
