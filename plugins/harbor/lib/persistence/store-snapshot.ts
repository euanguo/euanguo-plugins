import {
  defineSnapshot,
  resetSnapshotsForTests,
  type SnapshotStorage,
} from "./snapshot.ts";

/** Every persisted slot, namespaced so a version bump can be retired by scan. */
export const PERSISTED_SNAPSHOT_PREFIX = "harbor:v1:snapshot:";

/** The read-side cap, measured in UTF-16 units like `localStorage` quota. */
export const MAX_PERSISTED_ENTRY_CHARS = 64 * 1024;

export interface StoreSnapshotCodec<T> {
  encode(value: T): string;
  decode(stored: string): T | null;
}

export interface StoreSnapshotOptions<T> {
  /**
   * The `localStorage` tier. Requires the codec with it, which is the type
   * stating the contract: anything that leaves the page is validated on the way
   * back in.
   */
  readonly persist: StoreSnapshotCodec<T>;
}

export interface StoreSnapshot<T> {
  /** The last value written, or undefined when nothing trustworthy is held. */
  read(): T | undefined;
  write(value: T): void;
}

/** The `Storage` methods this needs, so a test can hand it a stub. */
export type StoreSnapshotStorage = SnapshotStorage;

/**
 * One named slot. The module-scope tier covers a remount; `persist` opts into
 * the durable tier. Call once so the handle lives for the life of the page.
 */
export function defineStoreSnapshot<T>(
  key: string,
  options?: StoreSnapshotOptions<T>,
): StoreSnapshot<T> {
  const storageKey = `${PERSISTED_SNAPSHOT_PREFIX}${key}`;
  const codec = options?.persist;
  const snapshot = defineSnapshot<T>({
    key: storageKey,
    maxChars: MAX_PERSISTED_ENTRY_CHARS,
    policy: "reject-all",
    persist: codec !== undefined,
    codec: codec ?? {
      decode: (raw) => (raw === null ? null : (raw as T)),
      encode: (value) => value,
    },
  });

  return {
    read: () => {
      const value = snapshot.read();
      return value === null ? undefined : value;
    },
    write: (value) => snapshot.write(value),
  };
}

/** Clears the tiers owned by this prefix. Only tests need this. */
export function resetStoreSnapshotsForTests(): void {
  resetSnapshotsForTests(PERSISTED_SNAPSHOT_PREFIX);
}
