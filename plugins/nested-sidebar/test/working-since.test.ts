import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk";
import {
  EMPTY_WORKING_SINCE,
  WORKING_SINCE_STORAGE_KEY,
  readWorkingSince,
  reconcileWorkingSince,
  statusWithDuration,
  writeWorkingSince,
  type WorkingSinceStorage,
} from "../lib/working-since.ts";

const NOW = 1_000_000_000;
const MINUTE = 60_000;

function thread(
  overrides: Partial<PluginSidebarThread> = {},
): PluginSidebarThread {
  return {
    id: "thr_1",
    projectId: "proj_1",
    title: "A thread",
    titleFallback: null,
    displayTitle: "A thread",
    parentThreadId: null,
    lifecycleOwnerThreadId: null,
    sourceThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "codex",
    status: "idle",
    runtimeStatus: "idle",
    queuedWork: "none",
    hasPendingInteraction: false,
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
    },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    pinnedAt: null,
    pinSortKey: null,
    isArchived: false,
    archivedAt: null,
    href: "/projects/proj_1/threads/thr_1",
    isHidden: false,
    environment: null,
    host: null,
    createdAt: NOW - 10 * MINUTE,
    updatedAt: NOW - MINUTE,
    lastReadAt: null,
    latestAttentionAt: NOW - MINUTE,
    ...overrides,
  };
}

/** A stand-in for `window.localStorage`, so the round trip needs no DOM. */
function fakeStorage(seed: Record<string, string> = {}): WorkingSinceStorage & {
  entries: Map<string, string>;
} {
  const entries = new Map(Object.entries(seed));
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
}

describe("reconcileWorkingSince", () => {
  it("stamps a thread the first time it is seen working", () => {
    const next = reconcileWorkingSince(
      new Map(),
      [thread({ id: "a", indicator: "runtime" })],
      NOW,
    );
    assert.equal(next.get("a"), NOW);
  });

  it("keeps the original stamp while the thread stays busy", () => {
    const first = new Map([["a", NOW - 5 * MINUTE]]);
    const next = reconcileWorkingSince(
      first,
      [thread({ id: "a", indicator: "runtime" })],
      NOW,
    );
    assert.equal(next.get("a"), NOW - 5 * MINUTE);
  });

  it("returns the same map when nothing changed, so no render is spent", () => {
    const first = new Map([["a", NOW - 5 * MINUTE]]);
    const next = reconcileWorkingSince(
      first,
      [thread({ id: "a", indicator: "runtime" }), thread({ id: "b" })],
      NOW,
    );
    assert.equal(next, first);
  });

  // A pause for a question ends the stretch: the next answer starts a fresh
  // count, which is the wait the user actually feels.
  it("clears a thread that stopped working or left the list", () => {
    const first = new Map([
      ["a", NOW - 5 * MINUTE],
      ["gone", NOW - 5 * MINUTE],
    ]);
    const next = reconcileWorkingSince(
      first,
      [thread({ id: "a", indicator: "waiting-for-input" })],
      NOW,
    );
    assert.equal(next.size, 0);
  });

  it("counts background activity as work, not only the runtime indicator", () => {
    const next = reconcileWorkingSince(
      new Map(),
      [
        thread({
          id: "a",
          activity: {
            workflows: 0,
            backgroundAgents: 1,
            backgroundCommands: 0,
            planMode: 0,
            goals: 0,
          },
        }),
      ],
      NOW,
    );
    assert.equal(next.get("a"), NOW);
  });
});

describe("statusWithDuration", () => {
  it("appends the elapsed bucket after a minute", () => {
    assert.equal(
      statusWithDuration("Working", NOW - 5 * MINUTE, NOW),
      "Working · 5m",
    );
    assert.equal(
      statusWithDuration("Planning", NOW - 3 * 60 * MINUTE, NOW),
      "Planning · 3h",
    );
  });

  it("stays bare under a minute, and without a stamp", () => {
    assert.equal(statusWithDuration("Working", NOW - 30_000, NOW), "Working");
    assert.equal(statusWithDuration("Working", undefined, NOW), "Working");
  });

  // The stamp is exact while the card's clock is floored to the minute, so a
  // fresh stamp can sit ahead of `now`. That must not print a negative age.
  it("treats a stamp ahead of the quantized clock as fresh", () => {
    assert.equal(statusWithDuration("Working", NOW + 30_000, NOW), "Working");
  });
});

describe("the working-since clock on disk", () => {
  it("round-trips through storage under Nest's own key", () => {
    const storage = fakeStorage();
    assert.equal(
      writeWorkingSince(new Map([["a", NOW]]), storage),
      true,
    );
    assert.notEqual(storage.entries.get(WORKING_SINCE_STORAGE_KEY), undefined);
    assert.deepEqual(readWorkingSince(storage), new Map([["a", NOW]]));
  });

  it("reads an empty clock back from an empty store", () => {
    assert.equal(readWorkingSince(fakeStorage()), EMPTY_WORKING_SINCE);
  });

  it("survives malformed or non-numeric entries", () => {
    assert.equal(
      readWorkingSince(fakeStorage({ [WORKING_SINCE_STORAGE_KEY]: "{" })),
      EMPTY_WORKING_SINCE,
    );
    assert.equal(
      readWorkingSince(fakeStorage({ [WORKING_SINCE_STORAGE_KEY]: "[]" })),
      EMPTY_WORKING_SINCE,
    );
    assert.deepEqual(
      readWorkingSince(
        fakeStorage({
          [WORKING_SINCE_STORAGE_KEY]: JSON.stringify({
            a: NOW,
            b: "soon",
            c: null,
          }),
        }),
      ),
      new Map([["a", NOW]]),
    );
  });

  it("gives up quietly when storage refuses the write", () => {
    const refusing: WorkingSinceStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    assert.equal(writeWorkingSince(new Map([["a", NOW]]), refusing), false);
  });
});
