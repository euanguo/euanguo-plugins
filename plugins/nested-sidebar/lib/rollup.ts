import {
  familyStatus,
  type FamilyStatusKind,
  type FamilyStatusThread,
} from "./family-status.ts";

/**
 * Everything a rollup reads: the status fields plus the id it hands back as a
 * jump target. Narrower than the host's thread DTO on purpose — that is the
 * whole contract, so a rollup can be computed for any list of threads without
 * constructing a whole DTO.
 */
export type RollupThread = FamilyStatusThread & { readonly id: string };

/**
 * What a collapsed row must still tell you.
 *
 * The signal that matters most when several levels are folded away is "is
 * anything under here running, and is anything waiting on me" — so those two
 * are counted separately and always available, regardless of how deep the
 * matching thread sits. `kind` keeps the single dominant state for colour and
 * icon, and inherits family-status' priority (failed > needs-you > working >
 * unread), which puts "needs you" ahead of "working" on purpose: a folded row
 * is scanned, not read, and a blocked thread is the one that must not hide.
 */
export interface StatusRollup {
  readonly kind: FamilyStatusKind;
  readonly total: number;
  readonly failed: number;
  readonly working: number;
  readonly needsYou: number;
  readonly unread: number;
  /**
   * Up to `MAX_DISC_IDS` of the threads under here, in the order they are drawn.
   *
   * Colour identifies a thread and its colour comes from its id, so the ids are
   * what a folded row needs to draw the same cluster a chip draws. Bounded by
   * construction rather than capped at the call site, so the width of a folded
   * row cannot grow with the size of the branch under it.
   */
  readonly discIds: readonly string[];
  /** The thread the rollup's dominant state came from, for jump-to. */
  readonly leadThreadId: string | null;
}

const EMPTY: StatusRollup = {
  kind: "inactive",
  total: 0,
  failed: 0,
  working: 0,
  needsYou: 0,
  unread: 0,
  discIds: [],
  leadThreadId: null,
};

export function emptyRollup(): StatusRollup {
  return EMPTY;
}

function isWorking(thread: FamilyStatusThread): boolean {
  return (
    thread.indicator === "runtime" ||
    thread.indicator === "workflow" ||
    thread.indicator === "background-agent" ||
    thread.indicator === "background-command" ||
    thread.indicator === "plan-mode" ||
    thread.indicator === "goal" ||
    thread.indicator === "working-draft" ||
    thread.activity.workflows > 0 ||
    thread.activity.backgroundAgents > 0 ||
    thread.activity.backgroundCommands > 0 ||
    thread.activity.planMode > 0 ||
    thread.activity.goals > 0
  );
}

function needsYou(thread: FamilyStatusThread): boolean {
  return (
    thread.hasPendingInteraction ||
    thread.indicator === "waiting-for-input" ||
    thread.indicator === "unread-error"
  );
}

function isUnread(thread: FamilyStatusThread): boolean {
  return thread.isUnread || thread.indicator === "unread-success";
}

function isFailed(thread: FamilyStatusThread): boolean {
  return thread.indicator === "unread-error";
}

/**
 * Fold a set of threads into one rollup. Doubles as the calculation for a
 * single thread, so a leaf row and a group header agree by construction.
 */
export function rollupThreads(
  threads: readonly RollupThread[],
  now: number,
): StatusRollup {
  if (threads.length === 0) return EMPTY;

  let working = 0;
  let needs = 0;
  let unread = 0;
  let failed = 0;
  for (const thread of threads) {
    if (isWorking(thread)) working += 1;
    if (needsYou(thread)) needs += 1;
    if (isUnread(thread)) unread += 1;
    if (isFailed(thread)) failed += 1;
  }

  const presentation = familyStatus(threads, now);
  // Prefer the thread that produced the dominant state, so clicking the badge
  // lands on the thing that needs you rather than an arbitrary sibling.
  const lead = leadThreadFor(threads, presentation.kind);

  return {
    kind: presentation.kind,
    total: threads.length,
    failed,
    working,
    needsYou: needs,
    unread,
    // The threads that put the chip there, not the first three under the row.
    // Naming idle threads by colour was decoration: a project's first three
    // threads are usually the quiet ones, and the colour is supposed to point at
    // what is happening.
    discIds: threads
      .filter(
        (thread) =>
          isFailed(thread) ||
          needsYou(thread) ||
          isWorking(thread) ||
          isUnread(thread),
      )
      .slice(0, MAX_DISC_IDS)
      .map((thread) => thread.id),
    leadThreadId: lead?.id ?? threads[0]?.id ?? null,
  };
}

function leadThreadFor(
  threads: readonly RollupThread[],
  kind: FamilyStatusKind,
): RollupThread | undefined {
  switch (kind) {
    case "failed":
      return threads.find((thread) => thread.indicator === "unread-error");
    case "needs-you":
      return threads.find(needsYou);
    case "working":
      return threads.find(isWorking);
    case "unread":
      return threads.find(isUnread);
    default:
      return threads[0];
  }
}

/** One non-zero signal in a rollup. */
export interface RollupCount {
  readonly kind: FamilyStatusKind;
  readonly count: number;
}

/**
 * The non-zero signals, most urgent first.
 *
 * The one place the order lives. A folded row draws a dot per entry and reads
 * the same list out as a sentence, so the dots and the screen-reader text cannot
 * disagree about which signal came first — and `failed > needs you > working >
 * unread` is the order that puts a blocked thread ahead of a running one, which
 * is the whole point of a rollup.
 */
/**
 * How many threads under this row are worth looking at.
 *
 * Not `total`: a folded project with twenty-eight threads of which two are
 * moving answers "28" to a question nobody asked, and the number a folded row
 * needs is the size of the reason to open it. The states counted here are
 * exactly the ones that draw the chip at all, so `0` and "no chip" are the same
 * case and cannot disagree.
 */
export function rollupSignalCount(rollup: StatusRollup): number {
  return rollup.failed + rollup.needsYou + rollup.working + rollup.unread;
}

export function rollupCounts(rollup: StatusRollup): RollupCount[] {
  const counts: RollupCount[] = [];
  if (rollup.failed > 0) counts.push({ kind: "failed", count: rollup.failed });
  if (rollup.needsYou > 0) {
    counts.push({ kind: "needs-you", count: rollup.needsYou });
  }
  if (rollup.working > 0) counts.push({ kind: "working", count: rollup.working });
  if (rollup.unread > 0) counts.push({ kind: "unread", count: rollup.unread });
  return counts;
}

/** The word each counted signal is read out as. */
const COUNT_LABELS: Readonly<Partial<Record<FamilyStatusKind, string>>> = {
  failed: "failed",
  "needs-you": "needs you",
  working: "working",
  unread: "unread",
};

/**
 * How a jump target is named: `Jump to the thread that needs you`.
 *
 * A phrase about the thread rather than the branch's count summary, because the
 * summary lists the whole branch — which is what made the old title, "Jump to
 * the thread that 1 needs you · 2 working", an unfinished sentence as soon as
 * more than one state was present. The summary still answers what is inside; this
 * answers where the click goes.
 */
export function rollupLeadPhrase(kind: FamilyStatusKind): string {
  switch (kind) {
    case "failed":
      return "failed";
    case "needs-you":
      return "needs you";
    case "working":
      return "is working";
    case "unread":
      return "you have not read";
    default:
      return "is in here";
  }
}

/**
 * The short string a folded header shows next to its status dot: only the
 * counts that are non-zero, most urgent first. Kept terse because this sits on
 * a row the user scans, and with many worktrees the row has little room.
 */
export function rollupSummary(rollup: StatusRollup): string {
  return rollupCounts(rollup)
    .map((entry) => `${entry.count} ${COUNT_LABELS[entry.kind] ?? entry.kind}`)
    .join(" · ");
}

/**
 * How many threads a folded row names by colour before it stops.
 *
 * Three, the same number a chip shows, because a folded row draws the same
 * cluster: past three the discs stop identifying anything and start being
 * decoration. `total` carries the number.
 */
export const MAX_DISC_IDS = 3;

/** Merge child rollups into a parent one. Counts add; the worst kind wins. */
export function mergeRollups(rollups: readonly StatusRollup[]): StatusRollup {
  const present = rollups.filter((rollup) => rollup.total > 0);
  if (present.length === 0) return EMPTY;

  let working = 0;
  let needs = 0;
  let unread = 0;
  let failed = 0;
  let total = 0;
  const discIds: string[] = [];
  for (const rollup of present) {
    working += rollup.working;
    needs += rollup.needsYou;
    unread += rollup.unread;
    failed += rollup.failed;
    total += rollup.total;
    // In the order the rows are drawn, so the discs on a folded project name the
    // threads at its top, which is where opening it lands.
    for (const id of rollup.discIds) {
      if (discIds.length < MAX_DISC_IDS) discIds.push(id);
    }
  }

  const kind = worstKind(present.map((rollup) => rollup.kind));
  const lead = present.find((rollup) => rollup.kind === kind) ?? present[0];

  return {
    kind,
    total,
    failed,
    working,
    needsYou: needs,
    unread,
    discIds,
    leadThreadId: lead?.leadThreadId ?? null,
  };
}

/**
 * Priority order, highest first. `inactive` and `stale` are the only states
 * that lose to everything, which is what lets a folded branch stay grey while
 * something three levels down is still running.
 */
const KIND_PRIORITY: readonly FamilyStatusKind[] = [
  "failed",
  "needs-you",
  "working",
  "unread",
  "inactive",
  "stale",
];

export function worstKind(
  kinds: readonly FamilyStatusKind[],
): FamilyStatusKind {
  let best = KIND_PRIORITY.length - 1;
  for (const kind of kinds) {
    const rank = KIND_PRIORITY.indexOf(kind);
    if (rank >= 0 && rank < best) best = rank;
  }
  return KIND_PRIORITY[best] ?? "inactive";
}

/**
 * A kind's place in the priority ladder, lowest number most urgent. Exported
 * so the ordering comparators rank by the same ladder the rollups fold with —
 * a "sort by status" that disagreed with the dots would be worse than none.
 */
export function statusKindRank(kind: FamilyStatusKind): number {
  const rank = KIND_PRIORITY.indexOf(kind);
  return rank < 0 ? KIND_PRIORITY.length : rank;
}

/** True when a rollup should draw an animated dot rather than a static one. */
export function rollupIsAnimated(rollup: StatusRollup): boolean {
  return rollup.kind === "working";
}
