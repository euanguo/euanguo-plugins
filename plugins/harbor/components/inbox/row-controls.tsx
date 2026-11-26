import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { experimental_ThreadStatusGlyph as ThreadStatusGlyph } from "@get-bb/plugin-sdk/app";

import { Icon } from "@bb-ui/icon";
import { HarborTooltip } from "@/components/ui/tooltip";
import { threadStatus } from "@/components/inbox/status-slot";
import { cn } from "@/lib/ui/utils";

export function ThreadStateGlyph({ thread, className }: { thread: PluginSidebarThread; className?: string }) {
  const status = threadStatus(thread);
  const label =
    status === null
      ? "Inactive: no active work in this child thread"
      : `${thread.indicatorLabel ?? status.label}: child thread status`;
  return (
    <HarborTooltip content={label} side="right">
      <button
        type="button"
        aria-label={label}
        className={cn(
          "relative flex size-3.5 shrink-0 items-center justify-center rounded border-0 bg-transparent p-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          className,
        )}
      >
        {status === null ? (
          <span aria-hidden className="size-2 rounded-full opacity-50" style={{ backgroundColor: "var(--harbor-status-inactive, var(--muted-foreground))" }} />
        ) : (
          <span aria-hidden className="flex items-center justify-center">
            <ThreadStatusGlyph indicator={status.indicator} size="compact" />
          </span>
        )}
      </button>
    </HarborTooltip>
  );
}

export function ThreadLocation({ thread }: { thread: PluginSidebarThread }) {
  const branch = thread.environment?.branchName;
  if (branch) {
    const k = thread.environment?.workspaceDisplayKind;
    const isWorktree = k === "managed-worktree" || k === "unmanaged-worktree";
    return (
      <span title={`Branch: ${branch}`} className="flex min-w-0 flex-1 items-center gap-1 truncate text-2xs text-muted-foreground">
        <Icon name={isWorktree ? "FolderGit" : "GitBranch"} aria-label={isWorktree ? "Worktree branch" : "Branch"} className="size-3 shrink-0 text-muted-foreground/60" />
        <span className="truncate font-mono">{branch}</span>
      </span>
    );
  }
  if (thread.host) {
    return (
      <span title={`Host: ${thread.host.name}`} className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
        {thread.host.name}
      </span>
    );
  }
  return <span className="flex-1" />;
}

const PARK_TONES = {
  settle: {
    button: "group/settle hover:text-emerald-600 dark:hover:text-emerald-400 focus-visible:ring-2 focus-visible:ring-emerald-500/50",
    ground: "group-hover/settle:bg-emerald-500/15 group-hover/settle:shadow-[0_0_0_3px_rgb(16_185_129_/_0.08)] group-focus-visible/settle:bg-emerald-500/15 group-active/settle:bg-emerald-500/25 motion-safe:group-hover/settle:-translate-y-0.5 motion-safe:group-focus-visible/settle:-translate-y-0.5 motion-safe:group-active/settle:translate-y-0 motion-safe:group-active/settle:scale-90",
    icon: "motion-safe:group-hover/settle:rotate-[-8deg] motion-safe:group-hover/settle:scale-110 motion-safe:group-focus-visible/settle:rotate-[-8deg] motion-safe:group-focus-visible/settle:scale-110",
    tooltip: "group-hover/settle:translate-y-0 group-hover/settle:opacity-100 group-focus/settle:translate-y-0 group-focus/settle:opacity-100",
  },
  snooze: {
    button: "group/snooze hover:text-violet-600 dark:hover:text-violet-400 focus-visible:ring-2 focus-visible:ring-violet-500/50",
    ground: "group-hover/snooze:bg-violet-500/15 group-hover/snooze:shadow-[0_0_0_3px_rgb(139_92_246_/_0.08)] group-focus-visible/snooze:bg-violet-500/15 group-active/snooze:bg-violet-500/25 motion-safe:group-hover/snooze:-translate-y-0.5 motion-safe:group-focus-visible/snooze:-translate-y-0.5 motion-safe:group-active/snooze:translate-y-0 motion-safe:group-active/snooze:scale-90",
    icon: "motion-safe:group-hover/snooze:scale-110 motion-safe:group-focus-visible/snooze:scale-110",
    tooltip: "group-hover/snooze:translate-y-0 group-hover/snooze:opacity-100 group-focus/snooze:translate-y-0 group-focus/snooze:opacity-100",
  },
} as const;

export function ParkButton({
  tone, label, icon, onActivate,
}: { tone: keyof typeof PARK_TONES; label: string; icon: "Archive" | "Clock"; onActivate: () => void }) {
  const s = PARK_TONES[tone];
  return (
    <HarborTooltip content={label}>
      <button
        type="button"
        aria-label={label}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onActivate(); }}
        className={cn("relative flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors duration-150 ease-out focus-visible:outline-none motion-reduce:transition-none", s.button)}
      >
        <span aria-hidden="true" className={cn("pointer-events-none flex size-full items-center justify-center rounded-[inherit] transition-[background-color,box-shadow,transform] duration-150 ease-out motion-reduce:transition-none", s.ground)}>
          <Icon name={icon} className={cn("size-3.5 transition-transform duration-150 ease-out motion-reduce:transition-none", s.icon)} />
        </span>
      </button>
    </HarborTooltip>
  );
}

export function PinButton({ pinned, onToggle, className }: { pinned: boolean; onToggle: () => void; className?: string }) {
  const label = pinned ? "Unpin thread" : "Pin thread";
  return (
    <HarborTooltip content={label}>
      <button
        type="button"
        data-harbor-pin={pinned ? "pinned" : "unpinned"}
        aria-label={label}
        aria-pressed={pinned}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(); }}
        className={cn(
          "relative z-10 -mr-[3px] flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors duration-150 ease-out hover:text-foreground focus-visible:outline-none motion-reduce:transition-none",
          pinned ? "focus-visible:ring-1 focus-visible:ring-ring" : "group/pin focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none flex size-full items-center justify-center rounded-[inherit]",
            !pinned && "transition-[background-color,box-shadow,transform] duration-150 ease-out group-hover/pin:bg-foreground/10 group-focus-visible/pin:bg-foreground/10 group-active/pin:bg-foreground/15 motion-safe:group-hover/pin:-translate-y-0.5 motion-safe:group-focus-visible/pin:-translate-y-0.5 motion-safe:group-active/pin:translate-y-0 motion-safe:group-active/pin:scale-90 motion-reduce:transition-none",
          )}
        >
          <Icon name="Pin" fallback="Pin" className={cn("size-3.5", !pinned && "transition-transform duration-150 ease-out motion-safe:group-hover/pin:-rotate-12 motion-reduce:transition-none")} aria-hidden />
        </span>
      </button>
    </HarborTooltip>
  );
}
