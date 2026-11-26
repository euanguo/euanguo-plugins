import * as React from "react";

import { COARSE_POINTER_TEXT_BASE_CLASS } from "./coarse-pointer-sizing.js";
import { cn } from "../../lib/ui/utils";

/**
 * The multi-line companion to `Input`.
 *
 * The registry ships no textarea, and a native one styled by hand would be the
 * one control in a dialog that did not match the others. It shares Input's
 * border, radius, focus ring and disabled state; only the height and the
 * resize affordance are its own.
 */
const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-20 w-full resize-y rounded-md border! border-foreground/20! bg-background/80! px-3 py-2 transition-colors duration-150 hover:duration-0 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-ring! focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        COARSE_POINTER_TEXT_BASE_CLASS,
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
