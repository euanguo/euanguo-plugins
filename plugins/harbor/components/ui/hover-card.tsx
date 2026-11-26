import * as React from "react";
import * as HoverCard from "@radix-ui/react-hover-card";
import { cn } from "@/lib/ui/utils";
import { usePortalScopeProps } from "@/lib/ui/portal-scope";
import { Z_HOVER } from "@/components/ui/overlay-layers";
import {
  overlayCoordinator,
  useIsHoverActive,
  useIsHoverSuppressed,
} from "@/lib/ui/overlay-coordinator";

const INTERACTIVE_ROW_CONTROL_SELECTOR =
  "[data-bb-icon-button], [data-harbor-row-menu-trigger]";

/**
 * Lightweight preview row for a sidebar HoverCard.
 *
 * `copy` and `copyValue` remain optional on the type temporarily for caller
 * compatibility until sidebar callers finish migrating to `InspectDetailsModal`,
 * and HoverCard never renders interactive Copy buttons.
 */
export interface InfoCardRow {
  readonly label: string;
  readonly value: string;
  readonly copyValue?: string;
  /** Render in the monospace face, for ids, branches, and paths. */
  readonly mono?: boolean;
  readonly copy?: boolean;
}

/**
 * Lightweight pointer-only hover preview card.
 *
 * Controlled through `overlayCoordinator` so only one hover card can mount at
 * a time, opening any menu or dialog closes it immediately, and keyboard focus
 * alone never pops a card over adjacent UI.
 */
export function InfoCard({
  trigger,
  label,
  rows = [],
  subtitle,
  summary,
  footer,
  disabled = false,
  className,
}: {
  trigger: React.ReactNode;
  /** Announced as the card's label, and shown as its heading. */
  label: string;
  rows?: readonly InfoCardRow[];
  subtitle?: string;
  summary?: string;
  /** Optional free-form content under the rows. */
  footer?: React.ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const hoverId = React.useId();
  const isOpen = useIsHoverActive(hoverId);
  const hoverSuppressed = useIsHoverSuppressed();
  const pointerInsideRef = React.useRef(false);
  const scope = usePortalScopeProps();

  React.useEffect(() => {
    if (hoverSuppressed) {
      pointerInsideRef.current = false;
    }
  }, [hoverSuppressed]);

  React.useEffect(() => {
    return () => {
      overlayCoordinator.closeHover(hoverId);
    };
  }, [hoverId]);

  const hasBody =
    rows.length > 0 ||
    subtitle !== undefined ||
    summary !== undefined ||
    footer !== undefined;
  if (disabled || !hasBody) return <>{trigger}</>;

  const isInsideRowControl = (target: EventTarget | null): boolean =>
    target instanceof Element &&
    target.closest(INTERACTIVE_ROW_CONTROL_SELECTOR) !== null;

  return (
    <HoverCard.Root
      open={isOpen}
      openDelay={600}
      closeDelay={50}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          overlayCoordinator.closeHover(hoverId);
          return;
        }
        if (!pointerInsideRef.current) return;
        overlayCoordinator.openHover(hoverId);
      }}
    >
      <HoverCard.Trigger
        asChild
        onPointerEnter={(event) => {
          pointerInsideRef.current =
            !hoverSuppressed && !isInsideRowControl(event.target);
        }}
        onPointerMove={(event) => {
          if (isInsideRowControl(event.target)) {
            pointerInsideRef.current = false;
            overlayCoordinator.closeHover(hoverId);
          } else if (!hoverSuppressed) {
            pointerInsideRef.current = true;
          }
        }}
        onPointerLeave={() => {
          pointerInsideRef.current = false;
        }}
        onPointerDownCapture={() => {
          pointerInsideRef.current = false;
          overlayCoordinator.dismissHover();
        }}
        onContextMenuCapture={() => {
          pointerInsideRef.current = false;
          overlayCoordinator.dismissHover();
        }}
        onDragStartCapture={() => {
          pointerInsideRef.current = false;
          overlayCoordinator.dismissHover();
        }}
        onFocus={(event) => {
          if (!pointerInsideRef.current) {
            event.preventDefault();
          }
        }}
      >
        <div className="block w-full min-w-0">{trigger}</div>
      </HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          data-radix-hover-card-content=""
          {...scope}
          side="right"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          aria-label={label}
          onPointerEnter={() => {
            if (!hoverSuppressed) {
              pointerInsideRef.current = true;
            }
          }}
          onPointerLeave={() => {
            pointerInsideRef.current = false;
          }}
          className={cn(
            Z_HOVER,
            "w-64 rounded-xl border border-border/60 bg-popover p-2.5",
            "text-popover-foreground shadow-lg outline-none",
            className,
          )}
        >
          <p className="truncate text-xs font-semibold text-foreground">
            {label}
          </p>
          {subtitle === undefined ? null : (
            <p className="mt-0.5 truncate text-2xs text-muted-foreground">
              {subtitle}
            </p>
          )}
          {summary === undefined ? null : (
            <p className="mt-1 truncate text-2xs text-foreground/85">
              {summary}
            </p>
          )}
          {rows.length === 0 ? null : (
            <dl className="mt-1.5 flex flex-col gap-1">
              {rows.map((row) => (
                <InfoRow key={`${row.label}:${row.value}`} row={row} />
              ))}
            </dl>
          )}
          {footer === undefined ? null : (
            <div className="mt-2 border-t border-border/70 pt-1.5">
              {footer}
            </div>
          )}
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}

export const HoverPreview = InfoCard;

/** One single-line truncated label/value preview row. */
export function InfoRow({ row }: { row: InfoCardRow }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <dt className="w-16 shrink-0 truncate text-2xs text-muted-foreground">
        {row.label}
      </dt>
      <dd className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-2xs text-foreground/90",
            row.mono && "font-mono",
          )}
        >
          {row.value}
        </span>
      </dd>
    </div>
  );
}
