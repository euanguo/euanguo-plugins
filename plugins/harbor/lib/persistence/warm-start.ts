/**
 * Last known good lifecycle shelves and providers, warm-started from memory and
 * `localStorage` via `snapshot.ts` + Zod schemas.
 */
import { z } from "zod";
import {
  parkedFromRow,
  rowFromParked,
  type ThreadLifecycleRow,
} from "../domain/lifecycle.ts";
import {
  lifecycleRowSchema,
  providerSchema,
  type WarmStartProvider,
} from "../schemas/sidebar.ts";
import {
  MAX_PERSISTED_ENTRY_CHARS,
  defineSnapshot,
  readSnapshotWithStorage,
  resetSnapshotsForTests,
  writeSnapshotWithStorage,
  zodCodec,
  type SnapshotStorage,
} from "./snapshot.ts";

export const WARM_START_ROWS_KEY = "harbor:v1:lifecycle-rows";
export const WARM_START_PROVIDERS_KEY = "harbor:v1:providers";

export type WarmStartStorage = SnapshotStorage;
export type { WarmStartProvider };

export function resetWarmStartMemoryForTests(): void {
  resetSnapshotsForTests(WARM_START_ROWS_KEY);
  resetSnapshotsForTests(WARM_START_PROVIDERS_KEY);
}

export const MAX_WARM_START_ROWS = 200;
export const MAX_WARM_START_ENTRY_CHARS = MAX_PERSISTED_ENTRY_CHARS;

const warmStartTimestampSchema = z
  .number()
  .refine((value) => Number.isSafeInteger(value) && value > 0)
  .nullable()
  .optional()
  .transform((value) => value ?? null);

const warmStartRowSchema = lifecycleRowSchema
  .extend({
    threadId: z.string().refine((value) => value.trim().length > 0),
    settledAt: warmStartTimestampSchema,
    snoozedUntil: warmStartTimestampSchema,
    snoozedAt: warmStartTimestampSchema,
  })
  .transform((row): ThreadLifecycleRow => {
    const parked = parkedFromRow(row);
    // Repair pre-invariant both-parked rows so snooze wins and settled columns clear.
    return parked?.kind === "snoozed" && row.settledAt !== null
      ? rowFromParked(row, parked)
      : row;
  });

const warmStartRowsSchema = z
  .array(warmStartRowSchema)
  .max(MAX_WARM_START_ROWS);

function parkedAt(row: ThreadLifecycleRow): number {
  return Math.max(row.settledAt ?? 0, row.snoozedAt ?? 0);
}

function selectWarmStartRows(
  rows: readonly ThreadLifecycleRow[],
): ThreadLifecycleRow[] {
  return [...rows]
    .sort(
      (left, right) =>
        parkedAt(right) - parkedAt(left) ||
        left.threadId.localeCompare(right.threadId),
    )
    .slice(0, MAX_WARM_START_ROWS)
    .map(({ threadId, settledAt, snoozedUntil, snoozedAt }) => ({
      threadId,
      settledAt,
      snoozedUntil,
      snoozedAt,
    }));
}

const rowsCodec = zodCodec<ThreadLifecycleRow[], readonly ThreadLifecycleRow[]>(
  warmStartRowsSchema,
  {
    maxChars: MAX_WARM_START_ENTRY_CHARS,
    prepare: selectWarmStartRows,
  },
);

export function decodeWarmStartRows(
  stored: string | null,
): ThreadLifecycleRow[] | null {
  return stored === null ? null : rowsCodec.decode(stored);
}

export function encodeWarmStartRows(
  rows: readonly ThreadLifecycleRow[],
): string {
  return rowsCodec.encode(rows);
}

defineSnapshot<ThreadLifecycleRow[]>({
  key: WARM_START_ROWS_KEY,
  codec: rowsCodec,
  maxChars: MAX_WARM_START_ENTRY_CHARS,
  policy: "reject-all",
  crossWindow: true,
});

export function readWarmStartRows(
  storage?: WarmStartStorage | null,
): ThreadLifecycleRow[] | null {
  const rows = readSnapshotWithStorage<ThreadLifecycleRow[]>(
    WARM_START_ROWS_KEY,
    storage,
  );
  return rows === null ? null : rows.map((row) => ({ ...row }));
}

export function writeWarmStartRows(
  rows: readonly ThreadLifecycleRow[],
  storage?: WarmStartStorage | null,
): void {
  writeSnapshotWithStorage(WARM_START_ROWS_KEY, selectWarmStartRows(rows), storage);
}

const LOGO_URL_BASE = "https://nest.invalid";

function decodeLogoUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("/")) return null;
  if (/["'()\\\s]/.test(value)) return null;
  let resolved: URL;
  try {
    resolved = new URL(value, LOGO_URL_BASE);
  } catch {
    return null;
  }
  if (resolved.origin !== LOGO_URL_BASE) return null;
  return `${resolved.pathname}${resolved.search}`;
}

const warmStartProviderSchema = providerSchema.extend({
  id: z.string().min(1),
  displayName: z.string().refine((value) => value.trim().length > 0),
  logoUrl: z.unknown().transform(decodeLogoUrl),
});

const providersCodec = zodCodec<WarmStartProvider[], readonly WarmStartProvider[]>(
  z.array(warmStartProviderSchema),
  {
    maxChars: MAX_WARM_START_ENTRY_CHARS,
    prepare: (providers) =>
      providers.map(({ id, displayName, logoUrl }) => ({
        id,
        displayName,
        logoUrl,
      })),
  },
);

export function decodeWarmStartProviders(
  stored: string | null,
): WarmStartProvider[] | null {
  return stored === null ? null : providersCodec.decode(stored);
}

export function encodeWarmStartProviders(
  providers: readonly WarmStartProvider[],
): string {
  return providersCodec.encode(providers);
}

defineSnapshot<WarmStartProvider[]>({
  key: WARM_START_PROVIDERS_KEY,
  codec: providersCodec,
  maxChars: MAX_WARM_START_ENTRY_CHARS,
  policy: "reject-all",
  crossWindow: true,
});

export function readWarmStartProviders(
  storage?: WarmStartStorage | null,
): WarmStartProvider[] | null {
  return readSnapshotWithStorage<WarmStartProvider[]>(
    WARM_START_PROVIDERS_KEY,
    storage,
  );
}

export function writeWarmStartProviders(
  providers: readonly WarmStartProvider[],
  storage?: WarmStartStorage | null,
): void {
  writeSnapshotWithStorage(WARM_START_PROVIDERS_KEY, [...providers], storage);
}
