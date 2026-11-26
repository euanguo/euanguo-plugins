import { useLayoutEffect, type CSSProperties, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { Icon, type IconName } from "@/components/ui/icon";
import { Z_DIALOG } from "@/components/ui/overlay-layers";
import { overlayCoordinator } from "@/lib/ui/overlay-coordinator";
import { usePortalScopeProps } from "@/lib/ui/portal-scope";
import { cn } from "@/lib/ui/utils";

/**
 * Registers the mounted dialog with `overlayCoordinator` across all viewport
 * sizes so hover previews and open menus close cleanly.
 */
function DialogOverlayLifecycle() {
  useLayoutEffect(() => {
    overlayCoordinator.openDialog();
    return () => {
      overlayCoordinator.closeDialog();
    };
  }, []);
  return null;
}

/**
 * Responsive modal dialog directly backed by `@radix-ui/react-dialog`.
 *
 * Centers on desktop with `width` constrained by the viewport, and anchors as a
 * compact bottom sheet below `sm` via Tailwind classes without a separate
 * drawer portal stack.
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  icon,
  tone = "default",
  busy = false,
  width = "46rem",
  allowOverflow = false,
  className,
  bodyClassName,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: IconName;
  /** Colours the header glyph: a destructive dialog says so before its button. */
  tone?: "default" | "destructive";
  busy?: boolean;
  /** Any CSS length; min() keeps it inside the viewport. */
  width?: string;
  /**
   * Let content past the box instead of scrolling inside it. Only for a dialog
   * holding a host surface whose own floating panels must escape.
   */
  allowOverflow?: boolean;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const scopeProps = usePortalScopeProps();
  const modalWidth = `min(${width}, calc(100vw - 2rem))`;

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !busy) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          {...scopeProps}
          className={cn("fixed inset-0 bg-black/50", Z_DIALOG)}
        />
        <DialogPrimitive.Content
          data-radix-dialog-content=""
          {...scopeProps}
          {...(subtitle === undefined ? { "aria-describedby": undefined } : {})}
          style={{ "--modal-width": modalWidth } as CSSProperties}
          className={cn(
            Z_DIALOG,
            "fixed left-1/2 top-1/2 flex w-[var(--modal-width)] max-w-[var(--modal-width)] -translate-x-1/2 -translate-y-1/2 flex-col gap-0 max-h-[min(90vh,52rem)] rounded-xl border border-border/60 bg-popover p-0 text-popover-foreground shadow-lg outline-none focus:outline-none",
            "max-sm:inset-x-2 max-sm:bottom-2 max-sm:top-auto max-sm:left-auto max-sm:w-auto max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:max-h-[85dvh] max-sm:rounded-t-xl",
            allowOverflow ? "overflow-visible" : "overflow-hidden",
            className,
          )}
        >
          <DialogOverlayLifecycle />
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
            {icon === undefined ? null : (
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-md",
                  tone === "destructive"
                    ? "bg-destructive/10 text-destructive"
                    : "bg-primary/10 text-primary",
                )}
              >
                <Icon name={icon} className="size-3.5" aria-hidden />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="truncate text-xs font-semibold">
                {title}
              </DialogPrimitive.Title>
              {subtitle === undefined ? null : (
                <DialogPrimitive.Description className="truncate text-2xs text-muted-foreground">
                  {subtitle}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close
              type="button"
              aria-label="Close"
              disabled={busy}
              onClick={(event) => {
                if (busy) event.preventDefault();
              }}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Icon name="X" className="size-3.5" aria-hidden />
            </DialogPrimitive.Close>
          </div>

          <div
            className={cn(
              "min-h-0 flex-1 p-3",
              allowOverflow ? "overflow-visible" : "overflow-x-clip overflow-y-auto",
              bodyClassName,
            )}
          >
            {children}
          </div>

          {footer === undefined ? null : (
            <div className="shrink-0 border-t border-border px-3 py-2">
              {footer}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
