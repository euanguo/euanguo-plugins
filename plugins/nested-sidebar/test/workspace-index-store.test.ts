import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, afterEach, describe, it } from "node:test";

import { buildWorkspaceIndex } from "../lib/workspace-index.ts";

const require = createRequire(import.meta.url);
const react = require("react") as { useSyncExternalStore: unknown };
const original = react.useSyncExternalStore;

interface Subscription {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => unknown;
}

let subscription: Subscription | null = null;

/**
 * React's subscriber plumbing, stood in so the store can be exercised without a
 * renderer: it records the pair the hook hands React and answers the snapshot,
 * which is the store's whole contract.
 */
react.useSyncExternalStore = (
  subscribe: (listener: () => void) => () => void,
  getSnapshot: () => unknown,
) => {
  subscription = { subscribe, getSnapshot };
  return getSnapshot();
};

const {
  publishSidebarMode,
  publishWorkspaceIndex,
  useSharedSidebarMode,
  useSharedWorkspaceIndex,
} = await import("../lib/workspace-index-store.ts");

after(() => {
  react.useSyncExternalStore = original;
});

afterEach(() => {
  publishWorkspaceIndex(null);
  publishSidebarMode(null);
});

const EMPTY = buildWorkspaceIndex({ environments: {}, projects: {} });

function workspaceSubscription(): Subscription {
  useSharedWorkspaceIndex();
  const captured = subscription;
  assert.ok(captured !== null);
  return captured;
}

describe("the shared workspace index", () => {
  it("answers the published index, and nothing before one", () => {
    assert.equal(useSharedWorkspaceIndex(), null);
    publishWorkspaceIndex(EMPTY);
    assert.equal(useSharedWorkspaceIndex(), EMPTY);
  });

  it("clears when the sidebar publishes nothing", () => {
    publishWorkspaceIndex(EMPTY);
    publishWorkspaceIndex(null);
    assert.equal(useSharedWorkspaceIndex(), null);
  });

  it("notifies once per real change", () => {
    const { subscribe, getSnapshot } = workspaceSubscription();
    let calls = 0;
    const unsubscribe = subscribe(() => {
      calls += 1;
    });

    publishWorkspaceIndex(EMPTY);
    assert.equal(calls, 1);
    publishWorkspaceIndex(EMPTY);
    assert.equal(calls, 1, "the same value is not a change");

    const next = buildWorkspaceIndex({
      environments: {},
      projects: {
        p1: { projectId: "p1", sourcePath: "/work", sourceHostId: "host_1" },
      },
    });
    publishWorkspaceIndex(next);
    assert.equal(calls, 2);
    assert.equal(getSnapshot(), next);

    publishWorkspaceIndex(null);
    assert.equal(calls, 3);

    unsubscribe();
    publishWorkspaceIndex(EMPTY);
    assert.equal(calls, 3, "an unsubscribed listener is not called");
  });

  it("carries the sidebar mode the same way", () => {
    assert.equal(useSharedSidebarMode(), null);
    publishSidebarMode("workspaces");
    assert.equal(useSharedSidebarMode(), "workspaces");
    publishSidebarMode("workspaces");
    assert.equal(useSharedSidebarMode(), "workspaces");
    publishSidebarMode("threads");
    assert.equal(useSharedSidebarMode(), "threads");
    publishSidebarMode(null);
    assert.equal(useSharedSidebarMode(), null);
  });
});
