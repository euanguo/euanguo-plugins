import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { Z_DIALOG_POPOVER, Z_MENU } from "@/components/ui/overlay-layers";
import {
  overlayCoordinator,
  useIsDialogOpen,
  useIsMenuActive,
} from "@/lib/ui/overlay-coordinator";
import { usePortalScopeProps } from "@/lib/ui/portal-scope";
import { cn } from "@/lib/ui/utils";

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

  React.useEffect(
    () => () => {
      overlayCoordinator.closeMenu(popoverId);
    },
    [popoverId],
  );

  return (
    <PopoverPrimitive.Root
      open={isControlled ? controlledOpen : activeMenuOpen}
      onOpenChange={handleOpenChange}
      {...props}
    >
      {children}
    </PopoverPrimitive.Root>
  );
}

const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> & {
    dismissOnOutsideInteraction?: boolean;
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
      ...props
    },
    ref,
  ) => {
    const isDialogOpen = useIsDialogOpen();
    const scopeProps = usePortalScopeProps();

    return (
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          ref={ref}
          data-radix-popover-content=""
          {...scopeProps}
          align={align}
          sideOffset={sideOffset}
          className={cn(
            isDialogOpen ? Z_DIALOG_POPOVER : Z_MENU,
            "w-96 max-w-[calc(100vw-1rem)] rounded-xl border border-border/60 bg-popover p-4 text-popover-foreground shadow-lg outline-none",
            className,
          )}
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

export { Popover, PopoverTrigger, PopoverContent };
