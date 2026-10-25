import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  defineStoreSnapshot,
  resetStoreSnapshotsForTests,
  MAX_PERSISTED_ENTRY_CHARS,
  PERSISTED_SNAPSHOT_PREFIX,
  type StoreSnapshotCodec,
  type StoreSnapshotStorage,
} from "../lib/store-snapshot.ts";

interface FakeStorage extends StoreSnapshotStorage {
  entries: Map<string, string>;
  reads: string[];
  writes: string[];
}

function storage(seed: Record<string, string> = {}): FakeStorage {
  const entries = new Map(Object.entries(seed));
  const reads: string[] = [];
  const writes: string[] = [];
  return {
    entries,
    reads,
    writes,
    getItem: (key) => {
      reads.push(key);
      return entries.get(key) ?? null;
    },
    setItem: (key, value) => {
      writes.push(key);
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
  };
}

/** Puts a fake store behind the real `window.localStorage` lookup. */
function install(storage: FakeStorage | null): void {
  if (storage === null) {
    (globalThis as { window?: unknown }).window = {};
    return;
  }
  (globalThis as { window?: unknown }).window = { localStorage: storage };
}

const originalWindow = (globalThis as { window?: unknown }).window;

afterEach(() => {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window?: unknown }).window = originalWindow;
  }
  resetStoreSnapshotsForTests();
});

interface Box {
  readonly items: readonly string[];
}

const boxCodec: StoreSnapshotCodec<Box> = {
  encode: (value) => JSON.stringify({ items: [...value.items] }),
  decode: (stored) => {
    const parsed: unknown = JSON.parse(stored);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !Array.isArray((parsed as { items?: unknown }).items) ||
      !(parsed as { items: unknown[] }).items.every(
        (item) => typeof item === "string",
      )
    ) {
      return null;
    }
    return { items: [...(parsed as { items: string[] }).items] };
  },
};

describe("store snapshot, memory tier", () => {
  it("hands the next mount what the last one wrote", () => {
    const snapshot = defineStoreSnapshot<Box>("memory-only");
    assert.equal(snapshot.read(), undefined);
    snapshot.write({ items: ["a"] });
    assert.deepEqual(snapshot.read(), { items: ["a"] });
  });

  it("keeps working with no storage at all", () => {
    delete (globalThis as { window?: unknown }).window;
    const snapshot = defineStoreSnapshot<Box>("no-window", {
      persist: boxCodec,
    });
    assert.equal(snapshot.read(), undefined);
    snapshot.write({ items: ["a"] });
    assert.deepEqual(snapshot.read(), { items: ["a"] });
  });
});

describe("store snapshot, persisted tier", () => {
  it("writes under a namespaced key and reads it back on a cold start", () => {
    const store = storage();
    install(store);
    const first = defineStoreSnapshot<Box>("box", { persist: boxCodec });
    first.write({ items: ["a", "b"] });
    assert.equal(
      store.entries.get(PERSISTED_SNAPSHOT_PREFIX + "box"),
      '{"items":["a","b"]}',
    );

    // A page load is a fresh module scope, which is exactly what this clears.
    resetStoreSnapshotsForTests();
    const second = defineStoreSnapshot<Box>("box", { persist: boxCodec });
    assert.deepEqual(second.read(), { items: ["a", "b"] });
  });

  it("treats an empty value as a value, not a miss", () => {
    const store = storage({ [PERSISTED_SNAPSHOT_PREFIX + "box"]: '{"items":[]}' });
    install(store);
    const snapshot = defineStoreSnapshot<Box>("box", { persist: boxCodec });
    assert.deepEqual(snapshot.read(), { items: [] });
  });

  it("drops an entry that will not decode, and does not ask twice", () => {
    const key = PERSISTED_SNAPSHOT_PREFIX + "box";
    const store = storage({ [key]: "{not json" });
    install(store);
    const snapshot = defineStoreSnapshot<Box>("box", { persist: boxCodec });
    assert.equal(snapshot.read(), undefined);
    assert.equal(store.entries.has(key), false);
    snapshot.read();
    assert.equal(store.reads.length, 1);
  });

  it("rejects a payload over the length cap without parsing it", () => {
    const key = PERSISTED_SNAPSHOT_PREFIX + "box";
    const store = storage({
      [key]: "x".repeat(MAX_PERSISTED_ENTRY_CHARS + 1),
    });
    install(store);
    const snapshot = defineStoreSnapshot<Box>("box", { persist: boxCodec });
    assert.equal(snapshot.read(), undefined);
    assert.equal(store.entries.has(key), false);
  });

  it("survives a decoder that throws, which it is not allowed to do", () => {
    const store = storage({ [PERSISTED_SNAPSHOT_PREFIX + "box"]: "anything" });
    install(store);
    const snapshot = defineStoreSnapshot<Box>("box", {
      persist: {
        encode: boxCodec.encode,
        decode: () => {
          throw new Error("bad codec");
        },
      },
    });
    assert.equal(snapshot.read(), undefined);
  });

  it("survives a store that throws on every call", () => {
    const broken: StoreSnapshotStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    install(broken as FakeStorage);
    const snapshot = defineStoreSnapshot<Box>("box", { persist: boxCodec });
    assert.equal(snapshot.read(), undefined);
    snapshot.write({ items: ["a"] });
    assert.deepEqual(snapshot.read(), { items: ["a"] });
  });

  it("does not offer the store a value it already holds", () => {
    const store = storage();
    install(store);
    const snapshot = defineStoreSnapshot<Box>("box", { persist: boxCodec });
    snapshot.write({ items: ["a"] });
    snapshot.write({ items: ["a"] });
    assert.equal(store.writes.length, 1);
    snapshot.write({ items: ["b"] });
    assert.equal(store.writes.length, 2);
  });

  it("keeps the memory tier serving after a failed write", () => {
    const store = storage();
    const failing: FakeStorage = {
      ...store,
      setItem: () => {
        throw new Error("quota");
      },
    };
    install(failing);
    const snapshot = defineStoreSnapshot<Box>("box", { persist: boxCodec });
    snapshot.write({ items: ["a"] });
    assert.deepEqual(snapshot.read(), { items: ["a"] });
    // The failure is forgotten rather than remembered as written, so a later
    // write still offers the value to the store.
    snapshot.write({ items: ["b"] });
    assert.deepEqual(snapshot.read(), { items: ["b"] });
  });
});

