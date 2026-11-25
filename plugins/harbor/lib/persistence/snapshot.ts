export type SnapshotPolicy = "reject-all" | "drop-entries" | "per-field";

export interface SnapshotCodec<T> {
  decode(raw: unknown): T | null;
  encode(value: T): unknown;
}

export interface Snapshot<T> {
  read(): T | null;
  write(value: T): void;
  clear(): void;
}

export type SnapshotStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

export interface SnapshotOptions<T> {
  readonly key: string;
  readonly codec: SnapshotCodec<T>;
  readonly maxChars: number;
  readonly policy: SnapshotPolicy;
  readonly crossWindow?: boolean;
  /** Memory-only slots still carry a codec, but never touch `localStorage`. */
  readonly persist?: boolean;
}

interface SnapshotState {
  decode(raw: unknown): unknown | null;
  encode(value: unknown): unknown;
  readonly maxChars: number;
  readonly policy: SnapshotPolicy;
  readonly crossWindow: boolean;
  readonly persist: boolean;
}

const memoryTier = new Map<string, unknown>();

/**
 * What storage is known to hold, by serialized value. Keeping this apart from
 * the memory tier is what lets a failed `setItem` be offered again later.
 */
const persistedTier = new Map<string, string>();
const primed = new Set<string>();
const states = new Map<string, SnapshotState>();

function defaultStorage(): SnapshotStorage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function toState<T>(options: SnapshotOptions<T>): SnapshotState {
  const { codec } = options;
  return {
    decode: (raw) => codec.decode(raw),
    encode: (value) => codec.encode(value as T),
    maxChars: options.maxChars,
    policy: options.policy,
    crossWindow: options.crossWindow === true,
    persist: options.persist !== false,
  };
}

let watchingForeignWrites = false;
function watchForeignWrites(): void {
  if (watchingForeignWrites) return;
  watchingForeignWrites = true;
  try {
    window.addEventListener("storage", (event) => {
      if (event.key === null) {
        memoryTier.clear();
        persistedTier.clear();
        primed.clear();
        return;
      }
      memoryTier.delete(event.key);
      persistedTier.delete(event.key);
      primed.delete(event.key);
    });
  } catch {
    // Without the listener, memory stays authoritative for this window.
  }
}

function stateFor(key: string): SnapshotState | null {
  return states.get(key) ?? null;
}

function serializedValue(encoded: unknown): string | null {
  if (typeof encoded === "string") return encoded;
  try {
    const serialized = JSON.stringify(encoded);
    return typeof serialized === "string" ? serialized : null;
  } catch {
    return null;
  }
}

function forgetEntry(key: string, storage: SnapshotStorage | null): void {
  memoryTier.delete(key);
  persistedTier.delete(key);
  if (storage === null) return;
  try {
    storage.removeItem(key);
  } catch {
    // The next read simply fails to decode again.
  }
}

function readEntry<T>(
  key: string,
  state: SnapshotState | null,
  storage: SnapshotStorage | null,
): T | null {
  const remembered = memoryTier.get(key);
  if (remembered !== undefined) return remembered as T;
  if (state === null || !state.persist || primed.has(key)) return null;
  primed.add(key);
  if (storage === null) return null;

  let stored: string | null;
  try {
    stored = storage.getItem(key);
  } catch {
    return null;
  }
  if (stored === null) return null;
  if (stored.length > state.maxChars) {
    forgetEntry(key, storage);
    return null;
  }

  let decoded: unknown | null;
  try {
    decoded = state.decode(stored);
  } catch {
    decoded = null;
  }
  if (decoded === null) {
    forgetEntry(key, storage);
    return null;
  }
  memoryTier.set(key, decoded);
  persistedTier.set(key, stored);
  return decoded as T;
}

function writeEntry<T>(
  key: string,
  value: T,
  state: SnapshotState | null,
  storage: SnapshotStorage | null,
): void {
  if (state === null) return;
  memoryTier.set(key, value);
  if (!state.persist) return;

  let serialized: string | null;
  try {
    serialized = serializedValue(state.encode(value));
  } catch {
    return;
  }
  if (serialized === null) return;
  if (persistedTier.get(key) === serialized) return;
  if (storage === null) return;
  try {
    storage.setItem(key, serialized);
    persistedTier.set(key, serialized);
  } catch {
    persistedTier.delete(key);
  }
}

function clearEntry(
  key: string,
  state: SnapshotState | null,
  storage: SnapshotStorage | null,
): void {
  if (state === null) return;
  forgetEntry(key, storage);
}

export function defineSnapshot<T>(
  options: SnapshotOptions<T>,
): Snapshot<T> {
  const key = options.key;
  // One key has one codec. A second definition replaces it so a test can
  // register the codec it is about to exercise; production defines each key
  // once at module load.
  states.set(key, toState(options));
  const state = stateFor(key);
  if (options.crossWindow === true) {
    try {
      if (typeof window !== "undefined") watchForeignWrites();
    } catch {
      // A missing or restricted window still supports the memory tier.
    }
  }

  return {
    read: () => readEntry<T>(key, state, defaultStorage()),
    write: (value) => writeEntry(key, value, state, defaultStorage()),
    clear: () => clearEntry(key, state, defaultStorage()),
  };
}

/**
 * Decode an array with the policy applied at entry granularity. `per-field`
 * expects the field decoder itself to preserve the record when only a field is
 * invalid; the primitive's job is not to reject the surrounding payload.
 */
export function decodeSnapshotEntries<E>(
  raw: unknown,
  decodeEntry: (entry: unknown) => E | null,
  policy: SnapshotPolicy,
  maxEntries?: number,
): readonly E[] | null {
  if (!Array.isArray(raw)) return null;
  if (maxEntries !== undefined && raw.length > maxEntries) return null;
  const entries: E[] = [];
  for (const entry of raw) {
    let decoded: E | null;
    try {
      decoded = decodeEntry(entry);
    } catch {
      decoded = null;
    }
    if (decoded === null) {
      if (policy === "reject-all") return null;
      if (policy === "drop-entries" || policy === "per-field") continue;
    }
    if (decoded !== null) entries.push(decoded);
  }
  return entries;
}

/**
 * Storage-injected variants for callers whose public API still takes a
 * `Storage` argument. They share the same tiers as `defineSnapshot`.
 */
export function readSnapshotWithStorage<T>(
  key: string,
  storage: SnapshotStorage | null,
): T | null {
  return readEntry<T>(key, stateFor(key), storage);
}

export function writeSnapshotWithStorage<T>(
  key: string,
  value: T,
  storage: SnapshotStorage | null,
): void {
  writeEntry(key, value, stateFor(key), storage);
}

export function clearSnapshotWithStorage(
  key: string,
  storage: SnapshotStorage | null,
): void {
  clearEntry(key, stateFor(key), storage);
}

export function resetSnapshotsForTests(prefix = ""): void {
  for (const key of memoryTier.keys()) {
    if (key.startsWith(prefix)) memoryTier.delete(key);
  }
  for (const key of persistedTier.keys()) {
    if (key.startsWith(prefix)) persistedTier.delete(key);
  }
  for (const key of primed.keys()) {
    if (key.startsWith(prefix)) primed.delete(key);
  }
}
