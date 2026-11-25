import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { lastActiveFor, recordLastActive } from "../lib/ui/last-active.ts";

const STORAGE_KEY = "bb.harbor.last-active.v1";
const MAX_ENTRIES = 500;

/** A stand-in for `window.localStorage`, so the round trip needs no DOM. */
function install(seed?: string): Map<string, string> {
  const entries = new Map<string, string>();
  if (seed !== undefined) entries.set(STORAGE_KEY, seed);
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => {
        entries.set(key, value);
      },
      removeItem: (key: string) => {
        entries.delete(key);
      },
    },
  };
  return entries;
}

const originalWindow = (globalThis as { window?: unknown }).window;

afterEach(() => {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window?: unknown }).window = originalWindow;
  }
});

describe("the last active conversation per workspace", () => {
  it("remembers one conversation per workspace and replaces it", () => {
    const entries = install();

    assert.equal(lastActiveFor("ws:host_1:/a"), null);

    recordLastActive("ws:host_1:/a", "thr_1");
    recordLastActive("ws:host_1:/b", "thr_2");
    recordLastActive("ws:host_1:/a", "thr_3");

    assert.equal(lastActiveFor("ws:host_1:/a"), "thr_3");
    assert.equal(lastActiveFor("ws:host_1:/b"), "thr_2");
    assert.deepEqual(JSON.parse(entries.get(STORAGE_KEY) ?? "{}"), {
      "ws:host_1:/a": "thr_3",
      "ws:host_1:/b": "thr_2",
    });
  });

  it("falls back to an empty record when the stored value is not usable", () => {
    install("{ not json");
    assert.equal(lastActiveFor("ws:host_1:/a"), null);

    install("[]");
    assert.equal(lastActiveFor("ws:host_1:/a"), null);

    install(JSON.stringify({ "ws:host_1:/a": 3 }));
    assert.equal(lastActiveFor("ws:host_1:/a"), null);

    recordLastActive("ws:host_1:/a", "thr_1");
    assert.equal(lastActiveFor("ws:host_1:/a"), "thr_1");
  });

  it("keeps the 500 most recent workspaces", () => {
    const entries = install();
    for (let index = 0; index <= MAX_ENTRIES; index += 1) {
      recordLastActive(`ws:host_1:/${index}`, `thr_${index}`);
    }

    const stored = JSON.parse(entries.get(STORAGE_KEY) ?? "{}") as Record<
      string,
      string
    >;
    assert.equal(Object.keys(stored).length, MAX_ENTRIES);
    assert.equal(stored["ws:host_1:/0"], undefined, "the oldest is dropped");
    assert.equal(
      stored[`ws:host_1:/${MAX_ENTRIES}`],
      `thr_${MAX_ENTRIES}`,
    );

    recordLastActive("ws:host_1:/1", "thr_again");
    recordLastActive("ws:host_1:/extra", "thr_extra");

    const after = JSON.parse(entries.get(STORAGE_KEY) ?? "{}") as Record<
      string,
      string
    >;
    assert.equal(Object.keys(after).length, MAX_ENTRIES);
    assert.equal(
      after["ws:host_1:/1"],
      "thr_again",
      "a re-recorded workspace is the newest, not the oldest",
    );
    assert.equal(after["ws:host_1:/2"], undefined);
  });

  it("still answers when there is no storage", () => {
    (globalThis as { window?: unknown }).window = {};
    recordLastActive("ws:host_1:/memory", "thr_memory");
    assert.equal(lastActiveFor("ws:host_1:/memory"), "thr_memory");
  });
});
