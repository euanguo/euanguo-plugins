import { useLayoutEffect, type CSSProperties, type ReactNode } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@bb-ui/dialog";
import { useIsCompactViewport } from "@bb-ui/hooks/use-compact-viewport";
import { Icon, type IconName } from "@bb-ui/icon";

import { Z_DIALOG } from "@/components/ui/overlay-layers";
import { overlayCoordinator } from "@/lib/ui/overlay-coordinator";
import { cn } from "@/lib/ui/utils";

/**
 * Registers the mounted dialog with `overlayCoordinator` across all viewport
 * sizes so hover previews, tooltips, and open menus close cleanly.
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
 * Responsive modal dialog backed by BB's shared `@bb-ui/dialog` (`Dialog` +
 * compact `ResponsiveDrawerShell` sheet on narrow viewports).
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
  const isCompactViewport = useIsCompactViewport();
  const modalWidth = `min(${width}, calc(100vw - 2rem))`;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !busy) onClose();
      }}
    >
      <DialogContent
        data-radix-dialog-content=""
        hideCloseButton
        {...(subtitle === undefined ? { "aria-describedby": undefined } : {})}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
        compactContentClassName="p-0"
        style={isCompactViewport ? undefined : ({ "--modal-width": modalWidth } as CSSProperties)}
        className={cn(
          isCompactViewport
            ? "flex max-h-[85dvh] flex-col gap-0 p-0"
            : [
                Z_DIALOG,
                "flex w-[var(--modal-width)] max-w-[var(--modal-width)] sm:max-w-[var(--modal-width)] flex-col gap-0 max-h-[min(90vh,52rem)] rounded-xl sm:rounded-xl border border-border/60 bg-popover p-0 text-popover-foreground shadow-lg outline-none focus:outline-none",
                allowOverflow ? "overflow-visible" : "overflow-hidden",
              ],
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
            <DialogTitle className="truncate text-xs font-semibold leading-normal">
              {title}
            </DialogTitle>
            {subtitle === undefined ? null : (
              <DialogDescription className="truncate text-2xs text-muted-foreground">
                {subtitle}
              </DialogDescription>
            )}
          </div>
          <DialogClose
            type="button"
            aria-label="Close"
            disabled={busy}
            onClick={(event) => {
              if (busy) event.preventDefault();
            }}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Icon name="X" className="size-3.5" aria-hidden />
          </DialogClose>
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
      </DialogContent>
    </Dialog>
  );
}
