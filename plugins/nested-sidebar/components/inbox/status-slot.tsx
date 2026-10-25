import type {
  PluginSidebarThread,
  PluginSidebarThreadIndicator,
} from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { semanticStateToneClass } from "@/lib/attention-state";
import { relativeTimeLabel } from "@/lib/relative-time";
import { threadIsWorking } from "@/lib/inbox";
import { statusWithDuration } from "@/lib/working-since";
import { useWorkingSinceContext } from "@/hooks/use-working-since";

/**
 * The row's trailing slot for content that is actually rendered.
 *
 * Hover-only actions use an overlay instead. Keeping this slot intrinsic means
 * a row with one status glyph or one age label does not reserve the width of a
 * hypothetical action cluster.
 */
export const STATUS_SLOT_CLASS = "flex shrink-0 items-center justify-end";

/**
 * The box every trailing glyph sits in, whatever its artwork measures.
 *
 * The status glyph, the provider glyph and a shelf's chevron all end a line at
 * the same inset, but they are drawn at different sizes. A shared box centres
 * each one on the same vertical axis, so right-aligning the boxes lines the
 * icons up instead of leaving them one or two pixels apart.
 */
export const TRAILING_GLYPH_BOX_CLASS =
  "flex size-3.5 shrink-0 items-center justify-center";

/**
 * Status OR age, never both: the glyph already implies the row is current, and
 * the age only earns its place once the thread has nothing to say.
 *
 * A live status carries how long the work has run ("Working · 5m"), so the
 * slot answers "is it stuck?" as well as "what is it doing?". The clock the
 * sidebar hands down is quantized to the minute, so the label does not churn
 * between renders.
 */
export function StatusOrTime({
  thread,
  now,
}: {
  thread: PluginSidebarThread;
  /** Quantized clock, shared by every row in one render. */
  now: number;
}) {
  const workingSince = useWorkingSinceContext();
  const status = threadStatus(thread);
  if (status !== null) {
    const label = status.showsDuration
      ? statusWithDuration(status.label, workingSince.get(thread.id), now)
      : status.label;
    return (
      <span
        aria-label={thread.indicatorLabel ?? label}
        className={cn(
          "max-w-full truncate rounded px-1 text-2xs font-semibold",
          status.showsDuration && "tabular-nums",
          status.tone,
        )}
      >
        {label}
      </span>
    );
  }
  return (
    <span className="tabular-nums text-2xs text-muted-foreground">
      {relativeTimeLabel(thread.updatedAt, now)}
    </span>
  );
}

export interface ThreadStatus {
  label: string;
  indicator: PluginSidebarThreadIndicator;
  tone: string;
  /** Live work gets a running duration; a verdict or a request does not. */
  showsDuration: boolean;
}

/**
 * A readable status for the row. Live work wins over a stale unread-success
 * indicator, while a failure and a raised hand remain higher priority.
 */
export function threadStatus(
  thread: PluginSidebarThread,
): ThreadStatus | null {
  if (thread.hasPendingInteraction || thread.indicator === "waiting-for-input") {
    return {
      label: "Needs you",
      indicator: "waiting-for-input",
      tone: semanticStateToneClass("destructive"),
      showsDuration: false,
    };
  }
  if (thread.indicator === "unread-error") {
    return {
      label: "Failed",
      indicator: "unread-error",
      tone: semanticStateToneClass("destructive"),
      showsDuration: false,
    };
  }
  if (threadIsWorking(thread)) {
    return {
      label: "Working",
      indicator: "runtime",
      tone: semanticStateToneClass("primary"),
      showsDuration: true,
    };
  }
  if (thread.isUnread || thread.indicator === "unread-success") {
    return {
      label: "Unread",
      indicator: "unread-success",
      tone: semanticStateToneClass("primary"),
      showsDuration: false,
    };
  }

  switch (thread.indicator) {
    case "draft":
      return {
        label: "Draft",
        indicator: "draft",
        tone: semanticStateToneClass("muted"),
        showsDuration: false,
      };
    case "working-draft":
      return {
        label: "Drafting",
        indicator: "working-draft",
        tone: semanticStateToneClass("primary"),
        showsDuration: true,
      };
    case "workflow":
      return {
        label: "Workflow",
        indicator: "workflow",
        tone: semanticStateToneClass("primary"),
        showsDuration: true,
      };
    case "background-agent":
      return {
        label: "Agent",
        indicator: "background-agent",
        tone: semanticStateToneClass("primary"),
        showsDuration: true,
      };
    case "background-command":
      return {
        label: "Command",
        indicator: "background-command",
        tone: semanticStateToneClass("primary"),
        showsDuration: true,
      };
    case "plan-mode":
      return {
        label: "Planning",
        indicator: "plan-mode",
        tone: semanticStateToneClass("primary"),
        showsDuration: true,
      };
    case "goal":
      return {
        label: "Goal",
        indicator: "goal",
        tone: semanticStateToneClass("primary"),
        showsDuration: true,
      };
    case "runtime":
      return {
        label: "Working",
        indicator: "runtime",
        tone: semanticStateToneClass("primary"),
        showsDuration: true,
      };
    case "none":
    default:
      return null;
  }
}
