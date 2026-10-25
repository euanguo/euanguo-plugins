import * as React from "react";
import * as HoverCard from "@radix-ui/react-hover-card";
import { cn } from "@/lib/utils";
import {
  useOverlayPortalContainer,
  usePortalScopeProps,
} from "@/lib/portal-scope";
import { Z_MENU } from "@/components/ui/menu";

/**
 * What a row keeps out of its own line.
 *
 * Rows in this sidebar are dense on purpose: anything that is not a title or a
 * state is either a dot or lives here. One row model rather than free-form
 * children, because every level (group, project, worktree, thread) shows the
 * same shape of information — a short label and a value — and `copy` exists for
 * the two kinds of value nobody wants to retype: ids and filesystem paths.
 */
export interface InfoCardRow {
  readonly label: string;
  readonly value: string;
  /** Render in the monospace face, for ids, branches, and paths. */
  readonly mono?: boolean;
  /** Offer a copy button. */
  readonly copy?: boolean;
}

/**
 * A hover card for the details a row suppresses.
 *
 * Two properties make this family of surface usable in a sidebar:
 *
 * - It is portaled, so it escapes the sidebar's own stacking context and the
 *   scroll container's clipping.
 * - Radix runs collision detection, so a card opened near the right edge flips
 *   inward instead of spilling off screen.
 *
 * The open delay is short but non-zero: passing the pointer over a row on the
 * way somewhere else should not flash a panel.
 *
 * Children are wrapped in one trivial element rather than cloned. Radix needs a
 * single node to attach to, and the trigger here is always a plain element: a
 * row that is *also* a menu trigger is a component that does not forward a ref,
 * so `asChild` cannot reach it. The wrapper costs one node and keeps the row's
 * own structure untouched.
 */
export function InfoCard({
  trigger,
  label,
  rows,
  footer,
  className,
}: {
  trigger: React.ReactNode;
  /** Announced as the card's label, and shown as its heading. */
  label: string;
  rows: readonly InfoCardRow[];
  /** Optional free-form content under the rows. */
  footer?: React.ReactNode;
  className?: string;
}) {
  const scope = usePortalScopeProps();
  const container = useOverlayPortalContainer();
  if (rows.length === 0 && footer === undefined) return <>{trigger}</>;
  return (
    <HoverCard.Root openDelay={350} closeDelay={80}>
      <HoverCard.Trigger asChild>
        <div className="block w-full min-w-0">{trigger}</div>
      </HoverCard.Trigger>
      <HoverCard.Portal container={container}>
        <HoverCard.Content
          {...scope}
          side="right"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          aria-label={label}
          className={cn(
            Z_MENU,
            "w-72 rounded-lg border border-border bg-popover p-2.5",
            "text-popover-foreground shadow-lg",
            className,
          )}
        >
          <p className="mb-1.5 truncate text-xs font-semibold text-foreground">
            {label}
          </p>
          <dl className="flex flex-col gap-1">
            {rows.map((row) => (
              <InfoRow key={`${row.label}:${row.value}`} row={row} />
            ))}
          </dl>
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

/** One label/value line. Long values wrap rather than truncate. */
export function InfoRow({ row }: { row: InfoCardRow }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <dt className="w-16 shrink-0 text-2xs text-muted-foreground">
        {row.label}
      </dt>
      <dd className="flex min-w-0 flex-1 items-baseline gap-1">
        <span
          className={cn(
            "min-w-0 flex-1 select-text break-all text-2xs text-foreground/90",
            row.mono && "font-mono",
          )}
        >
          {row.value}
        </span>
        {row.copy === true && row.value.length > 0 ? (
          <CopyValue label={row.label} value={row.value} />
        ) : null}
      </dd>
    </div>
  );
}

/** A selectable value with a copy button, for ids and filesystem paths. */
function CopyValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      title={copied ? "Copied" : "Copy"}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(
          () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          },
          () => undefined,
        );
      }}
      className="shrink-0 rounded p-0.5 text-2xs text-muted-foreground opacity-60 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
