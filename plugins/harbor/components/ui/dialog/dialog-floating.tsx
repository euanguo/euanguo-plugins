import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { cn } from "../../../lib/ui/utils.js";
import { usePortalScopeProps } from "../../../lib/ui/portal-scope.js";
import { Icon } from "../icon.js";

interface DialogFloatingContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  onAfterCloseAutoFocus?: () => void;
  hideCloseButton?: boolean;
}

export const DialogFloatingContent = React.forwardRef<
  HTMLDivElement,
  DialogFloatingContentProps
>(
  (
    {
      className,
      children,
      hideCloseButton = false,
      onAfterCloseAutoFocus,
      onCloseAutoFocus,
      style,
      ...props
    },
    ref,
  ) => {
    const scopeProps = usePortalScopeProps();

    return (
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          {...scopeProps}
          className="fixed inset-0 z-50 bg-black/50"
        />
        <DialogPrimitive.Content
          ref={ref}
          {...scopeProps}
          onCloseAutoFocus={(event) => {
            onCloseAutoFocus?.(event);
            queueMicrotask(() => onAfterCloseAutoFocus?.());
          }}
          className={cn(
            "harbor-opaque-surface fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg grid-cols-[minmax(0,1fr)] translate-x-[-50%] translate-y-[-50%] gap-4 border bg-popover p-6 text-popover-foreground shadow-lg outline-none focus:outline-none sm:rounded-lg",
            className,
          )}
          style={{ backgroundColor: "var(--popover)", ...style }}
          {...props}
        >
          {children}
          {hideCloseButton ? null : (
            <DialogPrimitive.Close className="absolute right-4 top-4 cursor-pointer rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-state-active data-[state=open]:text-foreground">
              <Icon name="X" className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    );
  },
);
DialogFloatingContent.displayName = "DialogFloatingContent";
