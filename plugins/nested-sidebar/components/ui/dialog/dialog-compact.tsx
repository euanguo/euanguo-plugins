import * as React from "react";

import {
  ResponsiveDrawerShell,
  stripRadixContentProps,
} from "../responsive-overlay.js";
import { cn } from "../../../lib/utils.js";

interface DialogCompactContentProps
  extends React.ComponentPropsWithoutRef<"div"> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAfterCloseAutoFocus?: () => void;
  titleId: string;
  descriptionId: string;
  hideCloseButton?: boolean;
}

/**
 * Drop a caller's inline box sizing.
 *
 * In the compact branch the content *is* the sheet, and the sheet is already
 * the full width of the viewport. A floating dialog's inline
 * `width`/`max-width` — typically `min(56rem, calc(100vw - 2rem))` — therefore
 * narrows the content against its own sheet: measured on the running app, a
 * 390px viewport gave a 358px content box inside a 390px drawer, with the
 * drawer's background showing as a 32px strip down the right edge. Inline
 * styles also outrank the `max-w-none` class this branch applies, so they
 * cannot be overridden from the class list — they have to be removed.
 */
function stripInlineSize(
  style: React.CSSProperties | undefined,
): React.CSSProperties | undefined {
  if (style === undefined) {
    return undefined;
  }
  const { width: _width, maxWidth: _maxWidth, ...rest } = style;
  return rest;
}

export const DialogCompactContent = React.forwardRef<
  HTMLDivElement,
  DialogCompactContentProps
>(
  (
    {
      className,
      children,
      open,
      onOpenChange,
      onAfterCloseAutoFocus,
      titleId,
      descriptionId,
      ...props
    },
    ref,
  ) => {
    const domProps = stripRadixContentProps(
      props as Record<string, unknown>,
    ) as React.ComponentPropsWithoutRef<"div">;
    const { style, ...restDomProps } = domProps;
    return (
      <ResponsiveDrawerShell
        open={open}
        onOpenChange={onOpenChange}
        onAfterCloseAutoFocus={onAfterCloseAutoFocus}
        labelledBy={titleId}
        describedBy={descriptionId}
      >
        <div
          ref={ref}
          style={stripInlineSize(style)}
          className={cn(
            "grid grid-cols-[minmax(0,1fr)] gap-4 overflow-y-auto px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]",
            className,
            // The drawer draws the box — its own background, its own top
            // radius, its own max height. A caller's floating-card chrome
            // (radius, border, popover fill, shadow, height cap) would sit
            // inside it as a smaller card floating in the sheet, so the
            // class list after `className` wins every one of those
            // properties back. `tailwind-merge` drops the caller's class
            // wherever the two collide, which is why these have to come
            // last and why the inline size above has to be stripped.
            "w-full max-w-none max-h-none rounded-none border-0 bg-transparent shadow-none",
          )}
          {...restDomProps}
        >
          {children}
        </div>
      </ResponsiveDrawerShell>
    );
  },
);
DialogCompactContent.displayName = "DialogCompactContent";
