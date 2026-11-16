import { Icon } from "@/components/ui/icon";
import { RowTooltip } from "@/components/ui/row-tooltip";
import type { DragEventHandler, KeyboardEventHandler } from "react";
import type {
  FamilyStatusColorRole,
  FamilyStatusPresentation,
} from "@/lib/family-status";
import { cn } from "@/lib/utils";

/**
 * The ground a state chip wears, wherever a row shows "threads under here": the
 * children chip on a thread, the rollup on a folded project, worktree or group.
 *
 * One constant rather than two class strings that happen to agree, because the
 * whole point of the shape is that a folded branch and an opened one are the
 * same kind of thing — they differ in what they carry and in what clicking them
 * does, never in what they look like. The tint comes from `familyStatusColor`
 * over this ground (`bg-current/10`), so a recoloured palette moves both.
 */
export const STATE_CHIP_CLASS =
  "flex h-5 shrink-0 items-center gap-1 rounded-full bg-current/10 px-1.5 text-2xs font-medium";

export function familyStatusColor(status: FamilyStatusPresentation): string {
  return `var(--nest-status-${status.colorRole}, ${familyStatusFallback(status.colorRole)})`;
}

/**
 * A colour for the status dot when the preference variables are out of reach.
 *
 * They are set inline on the sidebar, so a tab in bb's header and a menu
 * portaled to the body do not inherit them. Without a fallback the dot's
 * background is an unresolved `var()` and paints nothing, which reads as an
 * empty slot rather than a quiet thread.
 */
function familyStatusFallback(role: FamilyStatusColorRole): string {
  switch (role) {
    case "error":
      return "var(--destructive, #EF4444)";
    case "waiting":
      return "var(--warning-text, var(--warning, #F59E0B))";
    case "unread":
      return "var(--primary, #3B82F6)";
    case "working":
      return "var(--success-foreground, var(--primary, #22C55E))";
    case "workflow":
      return "var(--primary, #8B5CF6)";
    case "agent":
      return "var(--primary, #0891B2)";
    case "command":
      return "var(--warning, #EA6A20)";
    case "plan":
      return "var(--primary, #6366F1)";
    case "inactive":
    case "stale":
      return "var(--muted-foreground, #A1A8B3)";
  }
}

/**
 * The smallest form of a state: a coloured dot, nothing else.
 *
 * The colour carries the state and the tooltip spells it out, so the row can
 * say "working" without spending the width a word costs. `title` and the label
 * are the accessible name — the dot is decoration.
 */
export function StatusDot({
  status,
  className,
  title,
}: {
  status: FamilyStatusPresentation;
  className?: string;
  /** A more specific tooltip, e.g. one that carries a count. */
  title?: string;
}) {
  const help = title ?? `${status.label}: ${status.description}`;
  return (
    <span
      role="img"
      aria-label={help}
      title={help}
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        status.animated && "animate-pulse motion-reduce:animate-none",
        className,
      )}
      style={{
        backgroundColor: familyStatusColor(status),
        opacity: status.receded ? 0.6 : 1,
      }}
    />
  );
}

/** A state dot followed by a bare count, for a folded row's rollup. */
export function StatusCount({
  status,
  count,
  className,
}: {
  status: FamilyStatusPresentation;
  count: number;
  className?: string;
}) {
  return (
    <span
      title={`${count} ${status.label.toLowerCase()}`}
      className={cn("flex shrink-0 items-center gap-0.5", className)}
    >
      <StatusDot status={status} />
      <span className="tabular-nums text-2xs text-muted-foreground">
        {count}
      </span>
      <span className="sr-only">
        {count} {status.label.toLowerCase()}
      </span>
    </span>
  );
}

/**
 * Whether a state is loud enough to deserve its glyph rather than a dot.
 *
 * A tab and a menu row have room for one indicator. Working, failed and
 * waiting carry a shape the user can act on at a glance; the quiet states
 * only need a colour, so they keep the small dot.
 */
export function familyStatusNeedsIcon(
  status: FamilyStatusPresentation,
): boolean {
  return (
    status.kind === "working" ||
    status.kind === "failed" ||
    status.kind === "needs-you"
  );
}

export function FamilyStatusIcon({
  status,
  variant = "icon",
  className,
  draggable = false,
  reorderHelp,
  onDragStart,
  onKeyDown,
}: {
  status: FamilyStatusPresentation;
  /**
   * How much room the state gets. `"icon"` draws the shape that tells a
   * failure from a raised hand at a glance; `"dot"` trades that for a much
   * narrower coloured dot. Both keep the same tooltip, drag handle, and
   * keyboard reordering, so the compact form loses no behaviour.
   */
  variant?: "icon" | "dot";
  className?: string;
  draggable?: boolean;
  reorderHelp?: string;
  onDragStart?: DragEventHandler<HTMLSpanElement>;
  onKeyDown?: KeyboardEventHandler<HTMLSpanElement>;
}) {
  const help = reorderHelp
    ? `${status.label}: ${status.description} ${reorderHelp}`
    : `${status.label}: ${status.description}`;
  return (
    <span
      data-nest-family-status-icon={status.kind}
      data-nest-status-color-role={status.colorRole}
      tabIndex={0}
      draggable={draggable}
      aria-label={help}
      aria-keyshortcuts={reorderHelp ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
      title={help}
      onDragStart={onDragStart}
      onKeyDown={onKeyDown}
      className={cn(
        "group/family-status relative z-10 inline-flex size-5 shrink-0 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        draggable && "cursor-grab active:cursor-grabbing",
        className,
      )}
      style={{ color: familyStatusColor(status) }}
    >
      {variant === "dot" ? (
        <span
          aria-hidden
          className={cn(
            "size-1.5 rounded-full",
            status.animated && "animate-pulse motion-reduce:animate-none",
          )}
          style={{
            backgroundColor: familyStatusColor(status),
            opacity: status.receded ? 0.6 : 1,
          }}
        />
      ) : (
        <Icon
          name={status.icon}
          aria-hidden
          className={cn(
            "size-3.5",
            status.animated &&
              (status.icon === "Loading"
                ? "animate-spin motion-reduce:animate-none"
                : "animate-pulse motion-reduce:animate-none"),
          )}
        />
      )}
      <RowTooltip
        content={
          <>
            <span className="block font-semibold">{status.label}</span>
            <span className="mt-0.5 block whitespace-normal text-muted-foreground">
              {status.description}
            </span>
            {reorderHelp ? (
              <span className="mt-1 block border-t border-border/70 pt-1 whitespace-normal text-muted-foreground">
                {reorderHelp}
              </span>
            ) : null}
          </>
        }
        className="left-0 right-auto z-40 group-hover/family-status:translate-y-0 group-hover/family-status:opacity-100 group-focus/family-status:translate-y-0 group-focus/family-status:opacity-100"
      />
    </span>
  );
}

export function FamilyStatusBadge({
  status,
  preview = false,
}: {
  status: FamilyStatusPresentation;
  preview?: boolean;
}) {
  return (
    <span
      data-nest-family-status={status.kind}
      className={cn(
        "inline-flex h-4 w-14 shrink-0 items-center justify-center rounded px-0 text-[10px] font-semibold leading-none",
        status.receded ? "bg-muted/45" : "bg-current/10",
        preview && "h-5 px-2 text-2xs",
      )}
      style={{ color: familyStatusColor(status) }}
    >
      {status.label}
    </span>
  );
}
