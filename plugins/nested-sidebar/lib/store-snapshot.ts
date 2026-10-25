/**
 * The last good answer from each of this plugin's own reads, held outside React.
 *
 * bb renders a different component for the settings routes, so the whole thread
 * list unmounts on the way in and comes back with every piece of local state
 * reset. Each store below reads from an effect and starts from an empty value,
 * so that remount paints the empty state for one round trip and then snaps to
 * the real one. For groups that is the flash the user sees: with no groups and
 * no assignment every project falls into the implicit Ungrouped view for a
 * frame, then jumps into its group.
 *
 * Nothing below the hook remembers either — `rpc.call` is a plain `fetch` with
 * no cache — so the gap is the round trip itself and no amount of retrying
 * closes it. A snapshot does, by giving the remount its previous value as the
 * initial state. The read still runs on every mount and still owns the truth;
 * this only decides what the frame before it paints.
 *
 * Two tiers, and the smaller one is the default. Module scope alone covers the
 * remount, which is the defect this file was written for, and it is free of any
 * boundary: nothing leaves the page, so nothing has to be validated coming
 * back. A store may ask for the second tier on top, and the stores that do are
 * the ones whose wrong first frame is a wrong FACT rather than a wrong order —
 * a cold start has no memory to read, so the arrangement a user left behind
 * would be gone until the read lands. Persisting is a cost that has to be
 * justified per store, not a feature every store gets.
 *
 * The second tier is `localStorage`, which is user-writable and shared with
 * every other script on the origin. So a persisted store must bring a codec
 * with it, and the type says so: `persist` carries the decode, and there is no
 * way to name a key for storage without also handing over the function that
 * decides whether what came back may be trusted. A decode runs inside a
 * `useState` initializer — during render — and a throw there makes bb retire
 * the plugin for the whole session and fall back to its built-in list; a
 * poisoned entry would do that on every mount, surviving reload and reinstall,
 * with no way for the dead plugin to clear the value that killed it. Every
 * decode is therefore wrapped here as well as tested, because a decoder bug
 * must not be able to take the sidebar down with it.
 *
 * A snapshot is never authoritative. The read that replaces it always follows,
 * and a failed read leaves the last good value standing rather than blanking a
 * list the user was looking at. A value that will not decode is dropped from
 * storage outright: it will not decode later either, and it would otherwise sit
 * there being re-read on every mount for the life of the origin.
 */

const snapshots = new Map<string, unknown>();

/**
 * What this page has already handed to `localStorage`, by serialized value.
 *
 * Tracked apart from the memory tier because the two diverge at exactly the
 * moment it matters: a `setItem` that throws leaves the value in memory and not
 * in storage, and a dedupe against memory would then read the write as already
 * done and never offer it to the store again — so a quota that filled once and
 * freed a minute later would keep serving the stale entry to every later page
 * load, which is the half of the bug this tier exists for.
 */
const persisted = new Map<string, string>();

/**
 * Keys whose store has already been consulted. A miss is asked once per page:
 * `localStorage` is synchronous, and re-parsing a payload that did not decode
 * would otherwise happen on every mount.
 */
const primed = new Set<string>();

/** Every persisted slot, namespaced so a version bump can be retired by scan. */
export const PERSISTED_SNAPSHOT_PREFIX = "nest:v1:snapshot:";

/**
 * How long a stored entry may be before it is discarded unread.
 *
 * The parse runs during render, holding up the first paint this file exists to
 * make correct, and the length of the string is the only thing known about its
 * cost before `JSON.parse` has already paid it. Measured in UTF-16 units, which
 * is what `localStorage` charges against its quota too. Nothing this plugin
 * writes comes near it — the largest of these payloads is the workspace-path
 * map, and that is a few hundred bytes per environment.
 */
export const MAX_PERSISTED_ENTRY_CHARS = 64 * 1024;

/**
 * The encode/decode pair a persisted store must supply.
 *
 * `decode` takes the raw string rather than a parsed value so the codec owns
 * `JSON.parse` and its failure mode, and it answers `null` — never throws —
 * for anything this build cannot use. `null` and an empty value are different
 * answers: a store whose legitimate value is empty (no groups, no overrides)
 * must be able to say so, or every cold start would discard a real record.
 */
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
export type StoreSnapshotStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

/**
 * The real store, or null where there is none.
 *
 * A bare `window` reference throws a ReferenceError that optional chaining
 * would not catch, and reading `.localStorage` throws on its own where storage
 * is disabled or partitioned. No storage at all is a supported state: the
 * memory tier still serves, and this tier simply does not.
 */
function defaultStorage(): StoreSnapshotStorage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function forgetEntry(key: string, storage: StoreSnapshotStorage): void {
  persisted.delete(key);
  try {
    storage.removeItem(key);
  } catch {
    // Nothing to do; the entry simply stays there failing to decode.
  }
}

/**
 * One named slot. Call once at module scope, so the handle is created once for
 * the life of the page rather than on every render.
 */
export function defineStoreSnapshot<T>(
  key: string,
  options?: StoreSnapshotOptions<T>,
): StoreSnapshot<T> {
  const codec = options?.persist;
  const storageKey = `${PERSISTED_SNAPSHOT_PREFIX}${key}`;

  return {
    read: () => {
      if (snapshots.has(key)) return snapshots.get(key) as T;
      if (codec === undefined || primed.has(key)) return undefined;
      primed.add(key);
      const storage = defaultStorage();
      if (storage === null) return undefined;
      let stored: string | null;
      try {
        stored = storage.getItem(storageKey);
      } catch {
        // A store that refuses to be read is the same as an empty one here.
        return undefined;
      }
      if (stored === null) return undefined;
      if (stored.length > MAX_PERSISTED_ENTRY_CHARS) {
        // The encoder never writes one this long, so anything over the cap came
        // from something that is not this plugin.
        forgetEntry(storageKey, storage);
        return undefined;
      }
      let decoded: T | null;
      try {
        decoded = codec.decode(stored);
      } catch {
        // A decoder is not allowed to throw, and is tested for it — but it runs
        // during render, where a throw would retire the plugin for the session,
        // so it does not get to take the sidebar down on the strength of a test.
        decoded = null;
      }
      if (decoded === null) {
        forgetEntry(storageKey, storage);
        return undefined;
      }
      snapshots.set(key, decoded);
      persisted.set(key, stored);
      return decoded;
    },
    write: (value) => {
      snapshots.set(key, value);
      if (codec === undefined) return;
      let serialized: string;
      try {
        serialized = codec.encode(value);
      } catch {
        // Memory already holds the value; only the durable copy is skipped.
        return;
      }
      // Recognising a value the store already holds keeps a synchronous
      // `setItem` off every mount that read the same thing back.
      if (persisted.get(key) === serialized) return;
      const storage = defaultStorage();
      if (storage === null) return;
      try {
        storage.setItem(storageKey, serialized);
        persisted.set(key, serialized);
      } catch {
        // Quota is shared with bb's own keys, so a full store is ordinary
        // rather than exceptional. Memory carries this session on its own;
        // forgetting what the store holds is what makes the next write offer
        // the value again instead of recognising it as already written.
        persisted.delete(key);
      }
    },
  };
}

/**
 * Drops every tier. Only a test needs this — surviving is the entire point —
 * but tests in one file share this module.
 */
export function resetStoreSnapshotsForTests(): void {
  snapshots.clear();
  persisted.clear();
  primed.clear();
}

