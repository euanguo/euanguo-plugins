import { useEffect } from "react";

import { FeatureHubContent } from "@/components/feature-hub/feature-hub-panel";
import type { FeatureHubSection } from "@/components/feature-hub/hub-tab-ref";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { Icon } from "@/components/ui/icon";
import { useFeatures } from "@/hooks/use-features";
import { overlayCoordinator } from "@/lib/ui/overlay-coordinator";
import { cn } from "@/lib/ui/utils";

/**
 * Thin responsive modal shell over {@link FeatureHubContent} for 0-thread,
 * parked, and sidebar-launched Features.
 */
export function FeatureHubModal({
  open,
  featureId,
  initialSection,
  initialDirectory,
  onClose,
}: {
  readonly open: boolean;
  readonly featureId: string | null;
  readonly initialSection?: FeatureHubSection;
  readonly initialDirectory?: string | null;
  readonly onClose: () => void;
}) {
  const api = useFeatures();
  const isCompactViewport = useIsCompactViewport();
  const isFloating = !isCompactViewport;
  const feature = featureId === null ? null : (api.byId.get(featureId) ?? null);

  useEffect(() => {
    if (!open || !isCompactViewport) return;
    overlayCoordinator.openDialog();
    return () => {
      overlayCoordinator.closeDialog();
    };
  }, [isCompactViewport, open]);

  if (!open || featureId === null) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent
        hideCloseButton
        style={
          isFloating
            ? {
                width: "min(56rem, calc(100vw - 2rem))",
                maxWidth: "min(56rem, calc(100vw - 2rem))",
              }
            : undefined
        }
        className={cn(
          "flex flex-col gap-0 p-0",
          isFloating &&
            "h-[80vh] max-h-[85vh] overflow-hidden rounded-xl border-border bg-popover text-popover-foreground shadow-xl",
        )}
      >
        <DialogHeader className="flex shrink-0 flex-row items-center gap-2 border-b border-border px-3 py-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Icon name="Layers" className="size-3.5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <DialogTitle className="truncate text-xs font-semibold">
                {feature?.name ?? "Feature Hub"}
              </DialogTitle>
              {feature?.state === "parked" ? (
                <span className="harbor-badge-warning shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase">
                  Parked
                </span>
              ) : null}
            </div>
            <DialogDescription className="truncate font-mono text-2xs">
              {feature?.slug ?? featureId}
            </DialogDescription>
          </div>
          <DialogClose
            type="button"
            aria-label="Close"
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Icon name="X" className="size-3.5" aria-hidden />
          </DialogClose>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <FeatureHubContent
            featureId={featureId}
            initialSection={initialSection}
            initialDirectory={initialDirectory}
            hideHeader
            onClose={onClose}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
