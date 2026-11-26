import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { cn } from "../../../lib/ui/utils.js";
import { usePortalScopeProps } from "../../../lib/ui/portal-scope.js";
import { overlayCoordinator } from "../../../lib/ui/overlay-coordinator.js";
import { Icon } from "../icon.js";
import { Z_DIALOG } from "../overlay-layers.js";

interface DialogFloatingContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  onAfterCloseAutoFocus?: () => void;
  hideCloseButton?: boolean;
}

/**
 * Tracks when the portal actually mounts dialog content (i.e. `open === true`)
 * so `overlayCoordinator` blocks hover cards and closes open menus.
 */
function DialogOverlayLifecycle() {
  React.useLayoutEffect(() => {
    overlayCoordinator.openDialog();
    return () => {
      overlayCoordinator.closeDialog();
    };
  }, []);
  return null;
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
          className={cn("fixed inset-0 bg-black/50", Z_DIALOG)}
        />
        <DialogPrimitive.Content
          ref={ref}
          data-radix-dialog-content=""
          {...scopeProps}
          onCloseAutoFocus={(event) => {
            onCloseAutoFocus?.(event);
            queueMicrotask(() => onAfterCloseAutoFocus?.());
          }}
          className={cn(
            "fixed left-[50%] top-[50%] grid w-full max-w-lg grid-cols-[minmax(0,1fr)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-xl border border-border/60 bg-popover p-6 text-popover-foreground shadow-lg outline-none focus:outline-none",
            Z_DIALOG,
            className,
          )}
          style={style}
          {...props}
        >
          <DialogOverlayLifecycle />
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
