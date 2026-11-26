import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "../../lib/ui/utils";
import { usePortalScopeProps } from "../../lib/ui/portal-scope";
import {
  overlayCoordinator,
  useIsDialogOpen,
  useIsMenuActive,
} from "../../lib/ui/overlay-coordinator";
import { Z_DIALOG_POPOVER, Z_MENU } from "./overlay-layers.js";
import {
  type ResponsiveOverlayContextValue,
  COMPACT_SHEET_CONTENT_STYLE,
  useResponsiveRoot,
  MobileTrigger,
  stripRadixContentProps,
} from "./responsive-overlay.js";
import { ResponsiveDrawerShell } from "./drawer/responsive-drawer-shell.js";
import {
  blurActiveKeyboardInputBeforeOverlayOpen,
  getOverlayTriggerClassName,
  preventOverlayTriggerSelection,
} from "./overlay-trigger.js";
import { usePointerCoarse } from "./hooks/use-pointer-coarse.js";

const ResponsivePopoverContext =
  React.createContext<ResponsiveOverlayContextValue>({
    isCompactViewport: false,
    open: false,
    onOpenChange: () => {},
  });

function useResponsivePopover() {
  return React.useContext(ResponsivePopoverContext);
}

function Popover({
  children,
  open: controlledOpen,
  onOpenChange: controlledOnChange,
  defaultOpen,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  const popoverId = React.useId();
  const activeMenuOpen = useIsMenuActive(popoverId);
  const isControlled = controlledOpen !== undefined;
  const wasControlledActiveRef = React.useRef(false);

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        overlayCoordinator.openMenu(popoverId);
      } else {
        overlayCoordinator.closeMenu(popoverId);
      }
      controlledOnChange?.(nextOpen);
    },
    [controlledOnChange, popoverId],
  );

  const ctx = useResponsiveRoot(
    isControlled ? controlledOpen : activeMenuOpen,
    handleOpenChange,
    defaultOpen,
  );

  React.useLayoutEffect(() => {
    if (!isControlled && defaultOpen === true) {
      overlayCoordinator.openMenu(popoverId);
    }
  }, [defaultOpen, isControlled, popoverId]);

  React.useLayoutEffect(() => {
    if (!isControlled) return;
    if (controlledOpen) {
      overlayCoordinator.openMenu(popoverId);
    } else {
      wasControlledActiveRef.current = false;
      overlayCoordinator.closeMenu(popoverId);
    }
  }, [controlledOpen, isControlled, popoverId]);

  React.useEffect(() => {
    if (!isControlled || !controlledOpen) {
      wasControlledActiveRef.current = false;
      return;
    }
    if (activeMenuOpen) {
      wasControlledActiveRef.current = true;
      return;
    }
    if (wasControlledActiveRef.current) {
      wasControlledActiveRef.current = false;
      controlledOnChange?.(false);
    }
  }, [activeMenuOpen, controlledOnChange, controlledOpen, isControlled]);

  React.useEffect(() => {
    return () => {
      overlayCoordinator.closeMenu(popoverId);
    };
  }, [popoverId]);

  if (ctx.isCompactViewport) {
    return (
      <ResponsivePopoverContext.Provider value={ctx}>
        {children}
      </ResponsivePopoverContext.Provider>
    );
  }

  return (
    <PopoverPrimitive.Root
      open={ctx.open}
      onOpenChange={ctx.onOpenChange}
      {...props}
    >
      <ResponsivePopoverContext.Provider value={ctx}>
        {children}
      </ResponsivePopoverContext.Provider>
    </PopoverPrimitive.Root>
  );
}

const PopoverTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Trigger>
>(({ asChild, children, className, ...props }, ref) => {
  const { isCompactViewport, open, onOpenChange } = useResponsivePopover();

  if (isCompactViewport) {
    return (
      <MobileTrigger
        ref={ref}
        asChild={asChild}
        open={open}
        onOpenChange={onOpenChange}
        haspopup="dialog"
        className={className}
        {...props}
      >
        {children}
      </MobileTrigger>
    );
  }

  return (
    <PopoverPrimitive.Trigger
      ref={ref}
      asChild={asChild}
      className={getOverlayTriggerClassName(className)}
      onMouseDown={(event) => {
        if (!open) {
          blurActiveKeyboardInputBeforeOverlayOpen();
        }
        preventOverlayTriggerSelection(event);
      }}
      {...props}
    >
      {children}
    </PopoverPrimitive.Trigger>
  );
});
PopoverTrigger.displayName = "PopoverTrigger";

const PopoverContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> & {
    dismissOnOutsideInteraction?: boolean;
    mobileTitle?: string;
    mobileClassName?: string;
    onMobileContentAnimationEnd?: (open: boolean) => void;
    autoFocusRef?: React.RefObject<HTMLElement | null>;
  }
>(
  (
    {
      className,
      align = "center",
      sideOffset = 4,
      children,
      dismissOnOutsideInteraction = true,
      onInteractOutside,
      mobileTitle,
      mobileClassName,
      onMobileContentAnimationEnd,
      onOpenAutoFocus,
      autoFocusRef,
      style,
      ...props
    },
    ref,
  ) => {
    const { isCompactViewport, open, onOpenChange } = useResponsivePopover();
    const isPointerCoarse = usePointerCoarse();
    const isDialogOpen = useIsDialogOpen();
    const scopeProps = usePortalScopeProps();

    React.useEffect(() => {
      if (!open || isCompactViewport || isPointerCoarse || !autoFocusRef)
        return;
      const frame = window.requestAnimationFrame(() => {
        const target = autoFocusRef.current;
        target?.focus();
        if (target instanceof HTMLInputElement) target.select();
      });
      return () => window.cancelAnimationFrame(frame);
    }, [autoFocusRef, isCompactViewport, isPointerCoarse, open]);

    if (isCompactViewport) {
      const domProps = stripRadixContentProps(props);

      return (
        <ResponsiveDrawerShell
          open={open}
          onOpenChange={onOpenChange}
          srLabel={mobileTitle ?? "Options"}
          closeOnBackdropClick={dismissOnOutsideInteraction}
          contentClassName={mobileClassName}
          onContentAnimationEnd={onMobileContentAnimationEnd}
        >
          <div
            ref={ref}
            className={cn(
              "overflow-y-auto px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]",
              className,
            )}
            {...domProps}
            style={{ ...style, ...COMPACT_SHEET_CONTENT_STYLE }}
          >
            {children}
          </div>
        </ResponsiveDrawerShell>
      );
    }

    return (
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          ref={ref}
          data-radix-popover-content=""
          {...scopeProps}
          align={align}
          sideOffset={sideOffset}
          onOpenAutoFocus={(event) => {
            if (isPointerCoarse || autoFocusRef) event.preventDefault();
            if (!isPointerCoarse) onOpenAutoFocus?.(event);
          }}
          className={cn(
            isDialogOpen ? Z_DIALOG_POPOVER : Z_MENU,
            "w-96 rounded-xl border border-border/60 bg-popover p-4 text-popover-foreground shadow-lg outline-none",
            className,
          )}
          style={style}
          {...props}
          onInteractOutside={(event) => {
            if (!dismissOnOutsideInteraction) event.preventDefault();
            onInteractOutside?.(event);
          }}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    );
  },
);
PopoverContent.displayName = "PopoverContent";

const PopoverAnchor = React.forwardRef<
  React.ComponentRef<typeof PopoverPrimitive.Anchor>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Anchor>
>(({ children, ...props }, ref) => {
  const { isCompactViewport } = useResponsivePopover();

  if (isCompactViewport) {
    return <>{children}</>;
  }

  return (
    <PopoverPrimitive.Anchor ref={ref} {...props}>
      {children}
    </PopoverPrimitive.Anchor>
  );
});
PopoverAnchor.displayName = "PopoverAnchor";

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor };
