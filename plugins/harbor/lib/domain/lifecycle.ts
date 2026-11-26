/**
 * The settled / snoozed lifecycle, as pure functions over stored rows.
 *
 * This state lives in the PLUGIN's own database, never on bb's thread. That
 * keeps a plugin concept out of bb's schema and out of the host-daemon
 * protocol, and uninstalling the plugin takes that database with it — see
 * `lib/persistence/warm-start.ts` for the browser-side copy it does not take.
 */

import type { ThreadLifecycleRow } from "../schemas/sidebar.ts";

export type { ThreadLifecycleRow };

/**
 * The one parked state, independent of the columns that carry it.
 *
 * `settled` and `snoozed` are mutually exclusive. The row columns predate that
 * invariant, so decoding is where a row carrying both sides is reduced to the
 * snooze — the side `resolveShelf` has always honoured.
 */
export type Parked =
  | {
      readonly kind: "settled";
      readonly at: number;
      readonly archivedThreadIds: readonly string[];
    }
  | { readonly kind: "snoozed"; readonly until: number; readonly setAt: number }
  | null;

/**
 * Archive ids attached to a row, if its carrier has them.
 *
 * The client row deliberately omits them. The server row owns the array, and
 * the database owns its JSON form; both can be decoded here without making
 * every caller of the client row carry archive state.
 */
function archivedThreadIdsFromRow(row: ThreadLifecycleRow): readonly string[] {
  const value = (row as { readonly archivedThreadIds?: unknown })
    .archivedThreadIds;
  if (value === undefined || value === null) return [];
  if (typeof value === "string") return parseArchivedThreadIds(value);
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === "string");
}

/** Decode the columns into the state they are allowed to describe. */
export function parkedFromRow(row: ThreadLifecycleRow): Parked {
  if (row.snoozedUntil !== null) {
    // `snoozedAt` is null only in pre-invariant or cache data. Infinity keeps
    // the old "no activity wake" answer while satisfying the parked state.
    return {
      kind: "snoozed",
      until: row.snoozedUntil,
      setAt: row.snoozedAt ?? Number.POSITIVE_INFINITY,
    };
  }
  if (row.settledAt !== null) {
    return {
      kind: "settled",
      at: row.settledAt,
      archivedThreadIds: archivedThreadIdsFromRow(row),
    };
  }
  return null;
}

/**
 * Write a parked state back into the row's columns.
 *
 * Snooze wins while decoding, so this is also where the losing side is
 * cleared: the row that reaches the store can never claim both parks.
 */
export function rowFromParked(
  row: ThreadLifecycleRow,
  parked: Parked,
): ThreadLifecycleRow {
  if (parked === null) {
    return { ...row, settledAt: null, snoozedUntil: null, snoozedAt: null };
  }
  if (parked.kind === "settled") {
    return {
      ...row,
      settledAt: parked.at,
      snoozedUntil: null,
      snoozedAt: null,
    };
  }
  return {
    ...row,
    settledAt: null,
    snoozedUntil: parked.until,
    snoozedAt: parked.setAt,
  };
}

/**
 * The ids a settle's archive took, read back from the store.
 *
 * bb's archive cascades to child threads, so un-settling has to give back more
 * than the one id the user acted on. Rows written before that was recorded
 * hold nothing, and a JSON column is only as good as what wrote it — both
 * cases return an empty list, and the caller falls back to the thread's own
 * id, which is exactly what the old behaviour did.
 */
export function parseArchivedThreadIds(value: string | null): string[] {
  if (value === null) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

/** The activity signals that outrank a user's parking decision. */
export interface ThreadActivitySignals {
  hasPendingInteraction: boolean;
  /** Any live work: runtime, workflows, background agents, plan, goals. */
  isWorking: boolean;
  isUnread: boolean;
  /** Newest attention timestamp bb reports for the thread. */
  latestAttentionAt: number;
}

export type ThreadShelf = "active" | "snoozed" | "settled";

/**
 * Whether a thread may be parked at all.
 *
 * bb has more kinds of live work than a single session status — workflows,
 * background agents, background commands, plan mode, goals — and every one of
 * them must block parking. Hiding a thread that is still working is the one
 * failure this feature cannot afford.
 */
export function canPark(signals: ThreadActivitySignals): boolean {
  return !signals.hasPendingInteraction && !signals.isWorking;
}

/**
 * Which shelf a thread belongs on right now.
 *
 * Order matters. Live work and a raised hand always win, so a parked thread
 * that starts working or asks a question comes straight back. Then snooze,
 * because a wake time is a stronger statement than a settle. Then settled.
 */
export function resolveShelf(
  row: ThreadLifecycleRow | undefined,
  signals: ThreadActivitySignals,
  now: number,
): ThreadShelf {
  if (row === undefined) return "active";
  if (!canPark(signals)) return "active";

  const parked = parkedFromRow(row);

  if (parked?.kind === "snoozed") {
    // A timer that has elapsed wakes the thread; so does anything that
    // happened after the snooze was set.
    const wokeOnTimer = parked.until <= now;
    const wokeOnActivity = signals.latestAttentionAt > parked.setAt;
    if (!wokeOnTimer && !wokeOnActivity) return "snoozed";
    return "active";
  }

  if (parked?.kind === "settled") {
    // New attention since the settle un-settles it: the thread has more to
    // say than it did when the user filed it away.
    if (signals.latestAttentionAt > parked.at) return "active";
    return "settled";
  }

  return "active";
}

/**
 * The settled rows that have come back on their own, so the store can let
 * them go — and, with them, bb's archive.
 *
 * `resolveShelf` un-settles a thread the moment it has something new to say,
 * but that is a reading of the row, not a change to it. Without this the row
 * would sit there settled forever while the thread is back in the inbox, and
 * bb would still call it archived.
 *
 * `signalsFor` returns undefined for a thread bb no longer reports; those
 * rows belong to the `thread.deleted` cleanup instead.
 */
export function wokenSettledThreadIds(
  rows: Iterable<ThreadLifecycleRow>,
  signalsFor: (threadId: string) => ThreadActivitySignals | undefined,
  now: number,
): string[] {
  const woken: string[] = [];
  for (const row of rows) {
    if (row.settledAt === null) continue;
    const signals = signalsFor(row.threadId);
    if (signals === undefined) continue;
    if (resolveShelf(row, signals, now) !== "settled") woken.push(row.threadId);
  }
  return woken;
}

/**
 * Whether a fresh list says exactly what the rows already on screen say.
 *
 * Once the shelves are seeded from a cache, most responses agree with what is
 * already rendered — the mount read, and every realtime publish any window
 * makes. Swapping the map in anyway would hand out a new `parkedThreadIds`
 * set, re-partition and re-sort every thread, and re-run the reconcile effect,
 * all to arrive back where the screen already was.
 */
export function rowsMatch(
  current: ReadonlyMap<string, ThreadLifecycleRow>,
  next: readonly ThreadLifecycleRow[],
): boolean {
  if (current.size !== next.length) return false;
  return next.every((row) => {
    const existing = current.get(row.threadId);
    return (
      existing !== undefined &&
      existing.settledAt === row.settledAt &&
      existing.snoozedUntil === row.snoozedUntil &&
      existing.snoozedAt === row.snoozedAt
    );
  });
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Compact "wakes in" label: "5m", "2h", "3d". Minutes round up so a snooze
 * never reads "0m" while the thread is still hidden.
 */
export function snoozeWakeLabel(snoozedUntil: number, now: number): string {
  const remaining = snoozedUntil - now;
  if (remaining <= 0) return "now";
  if (remaining < HOUR_MS) {
    return `${Math.max(1, Math.ceil(remaining / MINUTE_MS))}m`;
  }
  if (remaining < DAY_MS) return `${Math.ceil(remaining / HOUR_MS)}h`;
  return `${Math.ceil(remaining / DAY_MS)}d`;
}

export type SnoozePresetId = "hour" | "evening" | "tomorrow" | "next-week";

export interface SnoozePreset {
  id: SnoozePresetId;
  label: string;
  snoozedUntil: number;
}

const EVENING_HOUR = 18;
const MORNING_HOUR = 9;

/**
 * Calendar-day arithmetic, not fixed millisecond offsets: adding 24 hours
 * lands on the wrong local day across a daylight-saving change, because a
 * spring-forward day is 23 hours long.
 */
function atHour(base: Date, hour: number, addDays = 0): Date {
  const next = new Date(base);
  next.setDate(next.getDate() + addDays);
  next.setHours(hour, 0, 0, 0);
  return next;
}

/** "This evening" only appears while it is meaningfully before evening. */
export function resolveSnoozePresets(now: Date): SnoozePreset[] {
  const presets: SnoozePreset[] = [
    { id: "hour", label: "In 1 hour", snoozedUntil: now.getTime() + HOUR_MS },
  ];

  const evening = atHour(now, EVENING_HOUR);
  if (evening.getTime() - now.getTime() > HOUR_MS) {
    presets.push({
      id: "evening",
      label: "This evening",
      snoozedUntil: evening.getTime(),
    });
  }

  presets.push({
    id: "tomorrow",
    label: "Tomorrow",
    snoozedUntil: atHour(now, MORNING_HOUR, 1).getTime(),
  });

  const daysUntilMonday = (1 - now.getDay() + 7) % 7 || 7;
  presets.push({
    id: "next-week",
    label: "Next week",
    snoozedUntil: atHour(now, MORNING_HOUR, daysUntilMonday).getTime(),
  });

  return presets;
}

/**
 * `setTimeout` delays are signed 32-bit: a far-future wake overflows and fires
 * immediately, which turns one snooze into a tight re-arm loop. Clamped, the
 * timer simply re-arms every ~24.8 days until the wake is in range.
 */
export const MAX_TIMEOUT_MS = 2_147_483_647;

export function nextWakeDelayMs(
  snoozedUntilValues: readonly number[],
  now: number,
): number | null {
  const upcoming = snoozedUntilValues.filter((value) => value > now);
  if (upcoming.length === 0) return null;
  const soonest = Math.min(...upcoming);
  return Math.min(Math.max(0, soonest - now) + 50, MAX_TIMEOUT_MS);
}

/** Whether any snoozed wake deadline elapsed between `prevNow` and `armedAt`. */
export function hasExpiredSnoozeSince(
  snoozedUntilValues: readonly number[],
  prevNow: number,
  armedAt: number,
): boolean {
  return snoozedUntilValues.some(
    (until) => until > prevNow && until <= armedAt,
  );
}

/**
 * How long to wait before re-reading a list whose read rejected, by attempt
 * number, and null once the attempts are spent.
 *
 * Neither list read has another way back from a rejection. A publish only
 * follows a mutation somebody makes, and the re-connect read needs the socket
 * to have actually dropped — a plugin backend that answers one request badly
 * over a channel that stays up produces neither, so without this a single blip
 * strands the mount for as long as the user leaves it open.
 *
 * Three retries inside seven seconds cover the blip. A backend that is properly
 * down is the reconnect path's problem, and a retry loop held open for it would
 * only spend requests hiding it.
 */
export const REFRESH_RETRY_DELAYS_MS: readonly number[] = [1_000, 2_000, 4_000];

export function refreshRetryDelayMs(attempt: number): number | null {
  if (attempt < 0 || attempt >= REFRESH_RETRY_DELAYS_MS.length) return null;
  return REFRESH_RETRY_DELAYS_MS[attempt] ?? null;
}
