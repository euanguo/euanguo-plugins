import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { cn } from "../../../lib/utils.js";
import { usePortalScopeProps } from "../../../lib/portal-scope.js";
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
      ...props
    },
    ref,
  ) => {
    const scopeProps = usePortalScopeProps();

    return (
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          {...scopeProps}
          className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        />
        <DialogPrimitive.Content
          ref={ref}
          {...scopeProps}
          onCloseAutoFocus={(event) => {
            onCloseAutoFocus?.(event);
            queueMicrotask(() => onAfterCloseAutoFocus?.());
          }}
          className={cn(
            "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg grid-cols-[minmax(0,1fr)] translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-sm duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:rounded-lg",
            className,
          )}
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
