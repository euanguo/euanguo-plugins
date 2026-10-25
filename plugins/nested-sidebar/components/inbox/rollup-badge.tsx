import { cn } from "@/lib/utils";
import { DiscCluster } from "@/components/inbox/disc";
import {
  STATE_CHIP_CLASS,
  familyStatusColor,
} from "@/components/inbox/family-status";
import { familyStatusPresentation } from "@/lib/family-status";
import {
  rollupLeadPhrase,
  rollupSignalCount,
  rollupSummary,
  type StatusRollup,
} from "@/lib/rollup";

/**
 * A folded row's status: the chip a thread with children wears — the threads
 * worth looking at named by colour, and how many of them, on a ground tinted by
 * the state the branch is in.
 *
 * The number is the size of the reason to open the row, not the size of the
 * branch. A project with twenty-eight threads of which two are moving says `2`;
 * `28` is a count of the things that are *not* happening, and the discs name the
 * two rather than the first three in the list. A thread's chip counts its
 * children instead, because there the number is the disclosure itself — "3 child
 * threads" is what clicking shows — while a folded row already has an arrow and a
 * name that open it, so its chip is free to be triage.
 *
 * This was one dot and one count per signal — `● 2  ● 1` — on the argument that a
 * folded row is *skimmed*, and what is skimmed for is "how much, and of what".
 * The argument was right and the shape was wrong: the sidebar had two answers to
 * one question, so a project's five threads and a thread's three children read as
 * different kinds of thing when they are the same thing. The breakdown did not
 * disappear — it moved to the title and the accessible label, where
 * `rollupSummary` already said it — and the discs now say *which* threads rather
 * than only how many. What is lost at a glance is a mixed branch: `●2 ●1` named
 * two states at once, and a tint names one.
 *
 * Width stays bounded by construction rather than by the size of the branch: at
 * most `MAX_DISC_IDS` discs, because the rollup caps them where it counts.
 *
 * Still nothing at all for a quiet subtree. A chip is a control — without it a
 * family cannot be opened — while this is a readout, and a readout present on
 * every project and every worktree at all times is chrome. It is the same line
 * the chip draws from the other side: a thread with no children draws no chip.
 */
export function RollupBadge({
  rollup,
  className,
}: {
  rollup: StatusRollup;
  className?: string;
}) {
  // A quiet subtree has no status signal to communicate. In particular, do not
  // render the inactive/stale pill on every project: it means something below
  // needs attention or is active, not merely that the row has threads under it.
  if (
    rollup.total === 0 ||
    rollup.kind === "inactive" ||
    rollup.kind === "stale"
  ) {
    return null;
  }
  const presentation = familyStatusPresentation(rollup.kind);
  const summary = rollupSummary(rollup);
  const signals = rollupSignalCount(rollup);
  /**
   * Both numbers, because the chip shows one of them and the other is the
   * context that makes it mean anything: "2 of 9 threads". The states follow in
   * priority order, and their first entry is the dominant one, so the dominant
   * state's own label is never prefixed to it — that was what made a folded row
   * read out as "Working · 1 working" in the running app.
   */
  const label =
    summary === ""
      ? presentation.label
      : `${signals} of ${rollup.total} threads: ${summary}`;

  return (
    <span
      data-nest-rollup={rollup.kind}
      className={cn(STATE_CHIP_CLASS, className)}
      style={{ color: familyStatusColor(presentation) }}
      title={label}
    >
      <DiscCluster
        threads={rollup.discIds.map((id) => ({ id }))}
        max={rollup.discIds.length}
        compact
      />
      <span className="tabular-nums">{signals}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * The click target that turns a rollup into navigation: clicking the chip jumps
 * to the thread the dominant state came from, rather than expanding the branch
 * and making the user find it. Falls back to toggling the row when the rollup
 * names no thread.
 *
 * It keeps a jump where a chip expands, because the two rows are asked different
 * questions. A thread's chip is the only route to its children, so it opens them.
 * A folded branch is opened by the arrow beside it and by its own name, which
 * leaves the chip free to be the shortcut — and taking you to the one thread that
 * needs you is the only thing a summary of a hundred folded threads can do that
 * the list cannot.
 */
export function RollupJump({
  rollup,
  onJump,
  onFallback,
}: {
  rollup: StatusRollup;
  onJump: (threadId: string) => void;
  onFallback: () => void;
}) {
  const target = rollup.leadThreadId;
  if (
    rollup.total === 0 ||
    rollup.kind === "inactive" ||
    rollup.kind === "stale"
  ) {
    return null;
  }
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        if (target !== null) onJump(target);
        else onFallback();
      }}
      // A phrase about the thread, not the branch's count summary: that summary
      // reads "1 needs you · 2 working", which is what made the old title —
      // "Jump to the thread that 1 needs you · 2 working" — an unfinished
      // sentence whenever more than one state was present.
      title={
        target !== null
          ? `Jump to the thread that ${rollupLeadPhrase(rollup.kind)}`
          : "Nothing to jump to"
      }
      className={cn(
        "flex shrink-0 items-center rounded-full",
        "outline-none transition-[filter] duration-150 ease-out hover:brightness-110 motion-reduce:transition-none",
        "focus-visible:ring-1 focus-visible:ring-ring",
      )}
    >
      <RollupBadge rollup={rollup} />
    </button>
  );
}
