import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  decodeSnapshotEntries,
  defineSnapshot,
  resetSnapshotsForTests,
  type SnapshotCodec,
  type SnapshotStorage,
} from "../lib/persistence/snapshot.ts";

interface FakeStorage extends SnapshotStorage {
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

function install(value: FakeStorage | null): void {
  const target = new EventTarget();
  (globalThis as { window?: unknown }).window = value === null
    ? target
    : Object.assign(target, { localStorage: value });
}

const originalWindow = (globalThis as { window?: unknown }).window;

afterEach(() => {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window?: unknown }).window = originalWindow;
  }
  resetSnapshotsForTests();
});

interface Box {
  readonly items: readonly string[];
}

const boxCodec: SnapshotCodec<Box> = {
  encode: (value) => JSON.stringify({ items: [...value.items] }),
  decode: (raw) => {
    if (typeof raw !== "string") return null;
    const parsed: unknown = JSON.parse(raw);
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

const options = {
  key: "test:box",
  codec: boxCodec,
  maxChars: 1_024,
  policy: "reject-all",
} as const;

describe("snapshot", () => {
  it("round-trips a valid value through storage", () => {
    const store = storage();
    install(store);
    const first = defineSnapshot<Box>(options);
    first.write({ items: ["a", "b"] });
    assert.equal(store.entries.get("test:box"), '{"items":["a","b"]}');

    resetSnapshotsForTests();
    const second = defineSnapshot<Box>(options);
    assert.deepEqual(second.read(), { items: ["a", "b"] });
  });

  it("leaves memory readable when a quota throw refuses the write", () => {
    const store = storage();
    const failing: FakeStorage = {
      ...store,
      setItem: () => {
        throw new Error("quota");
      },
    };
    install(failing);
    const snapshot = defineSnapshot<Box>(options);
    snapshot.write({ items: ["a"] });
    assert.deepEqual(snapshot.read(), { items: ["a"] });
    assert.equal(store.entries.has("test:box"), false);

    snapshot.write({ items: ["b"] });
    assert.deepEqual(snapshot.read(), { items: ["b"] });
  });

  it("refuses an oversized stored value without parsing it", () => {
    const key = "test:box";
    const store = storage({ [key]: "x".repeat(1_025) });
    install(store);
    const snapshot = defineSnapshot<Box>(options);
    assert.equal(snapshot.read(), null);
    assert.equal(store.entries.has(key), false);
  });

  it("clears a corrupt entry under reject-all", () => {
    const key = "test:box";
    const store = storage({ [key]: "{not json" });
    install(store);
    const snapshot = defineSnapshot<Box>(options);
    assert.equal(snapshot.read(), null);
    assert.equal(store.entries.has(key), false);
  });

  it("drops a memory entry on a foreign storage write", () => {
    const store = storage();
    install(store);
    const snapshot = defineSnapshot<Box>({
      ...options,
      crossWindow: true,
    });
    snapshot.write({ items: ["stale"] });
    store.entries.set("test:box", '{"items":["fresh"]}');

    const target = (globalThis as { window: EventTarget }).window;
    target.dispatchEvent(Object.assign(new Event("storage"), { key: "test:box" }));
    assert.deepEqual(snapshot.read(), { items: ["fresh"] });
  });

  it("does not offer storage a value it already holds", () => {
    const store = storage();
    install(store);
    const snapshot = defineSnapshot<Box>(options);
    snapshot.write({ items: ["a"] });
    snapshot.write({ items: ["a"] });
    assert.equal(store.writes.length, 1);
    snapshot.write({ items: ["b"] });
    assert.equal(store.writes.length, 2);
  });

  it("survives a codec that throws and a store that throws", () => {
    const broken: SnapshotStorage = {
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
    const snapshot = defineSnapshot<Box>({
      ...options,
      codec: {
        encode: boxCodec.encode,
        decode: () => {
          throw new Error("bad codec");
        },
      },
    });
    assert.equal(snapshot.read(), null);
    snapshot.write({ items: ["a"] });
    assert.deepEqual(snapshot.read(), { items: ["a"] });
  });

  it("clears both tiers", () => {
    const store = storage();
    install(store);
    const snapshot = defineSnapshot<Box>(options);
    snapshot.write({ items: ["a"] });
    snapshot.clear();
    assert.equal(snapshot.read(), null);
    assert.equal(store.entries.has("test:box"), false);
  });
});

describe("snapshot entry policy", () => {
  const entries = [
    { id: "good" },
    { id: "bad", invalid: true },
    { id: "also-good" },
  ];
  const decode = (entry: unknown): { id: string } | null =>
    typeof entry === "object" &&
    entry !== null &&
    !("invalid" in entry)
      ? { id: (entry as { id: string }).id }
      : null;

  it("rejects the whole payload for reject-all", () => {
    assert.equal(
      decodeSnapshotEntries(entries, decode, "reject-all"),
      null,
    );
  });

  it("keeps valid entries for drop-entries", () => {
    assert.deepEqual(decodeSnapshotEntries(entries, decode, "drop-entries"), [
      { id: "good" },
      { id: "also-good" },
    ]);
  });
});
