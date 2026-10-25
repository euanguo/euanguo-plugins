import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  toRecoveryThread,
  toRecoveryThreads,
  type RecoveryThreadRow,
} from "../lib/recovery-threads.ts";

function row(overrides: Partial<RecoveryThreadRow> = {}): RecoveryThreadRow {
  return {
    id: "thr_1",
    projectId: "p1",
    title: "A thread",
    titleFallback: null,
    parentThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "codex",
    status: "idle",
    hasPendingInteraction: false,
    isPinned: false,
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
    },
    environment: null,
    host: null,
    createdAt: 1_000,
    updatedAt: 2_000,
    lastReadAt: 2_000,
    latestAttentionAt: 2_000,
    ...overrides,
  };
}

describe("toRecoveryThread", () => {
  /**
   * The one field that separates this read from the settled shelf's. A recovery
   * row is live: nothing here was archived to be found, and marking it archived
   * would file every recovered thread onto the settled shelf.
   */
  it("reports a recovered row as live, not archived", () => {
    assert.equal(toRecoveryThread(row()).isArchived, false);
  });

  /**
   * The reason a recovery row carries an environment at all. The settled shelf
   * draws one line and needs neither, so its mapper drops both; a recovery has
   * to redraw the whole tree, workspace level included.
   */
  it("carries the workspace facts a workspace row draws", () => {
    const recovered = toRecoveryThread(
      row({
        environment: {
          id: "env_1",
          name: "release",
          branchName: "bb/release",
          providerId: "managed-worktree",
          workspaceDisplayKind: "managed-worktree",
        },
        host: { id: "host_1", name: "studio" },
      }),
    );
    assert.deepEqual(recovered.environment, {
      id: "env_1",
      name: "release",
      branchName: "bb/release",
      path: null,
      isWorktree: true,
      providerId: "managed-worktree",
      workspaceDisplayKind: "managed-worktree",
    });
    assert.deepEqual(recovered.host, { id: "host_1", name: "studio" });
  });

  it("leaves a thread with no environment without one", () => {
    const recovered = toRecoveryThread(row());
    assert.equal(recovered.environment, null);
    assert.equal(recovered.host, null);
  });

  /**
   * The wire carries the workspace kind as a plain string so a bb release that
   * adds one cannot fail the read. An unknown value has to degrade to an
   * unlabelled workspace rather than reach the tree as a kind it cannot draw.
   */
  it("drops a workspace kind it does not know", () => {
    const recovered = toRecoveryThread(
      row({
        environment: {
          id: "env_1",
          name: null,
          branchName: null,
          providerId: null,
          workspaceDisplayKind: "somewhere-else",
        },
      }),
    );
    assert.equal(recovered.environment?.workspaceDisplayKind, null);
  });

  it("keeps the origin kinds this sidebar draws and drops the rest", () => {
    assert.equal(toRecoveryThread(row({ originKind: "fork" })).originKind, "fork");
    assert.equal(
      toRecoveryThread(row({ originKind: "teleport" })).originKind,
      null,
    );
  });

  it("derives the status bb would paint, from the fields it has", () => {
    assert.equal(
      toRecoveryThread(row({ hasPendingInteraction: true })).indicator,
      "waiting-for-input",
    );
    assert.equal(
      toRecoveryThread(row({ status: "active" })).indicator,
      "runtime",
    );
    assert.equal(
      toRecoveryThread(
        row({ lastReadAt: 1_000, latestAttentionAt: 2_000, status: "error" }),
      ).indicator,
      "unread-error",
    );
    assert.equal(toRecoveryThread(row()).indicator, "none");
  });

  it("carries pin, attention, and the timestamps through", () => {
    const recovered = toRecoveryThread(
      row({ isPinned: true, latestAttentionAt: 9_000, lastReadAt: null }),
    );
    assert.equal(recovered.isPinned, true);
    assert.equal(recovered.isUnread, true);
    assert.equal(recovered.updatedAt, 2_000);
  });
});

describe("toRecoveryThreads", () => {
  it("keeps the backend's order", () => {
    const recovered = toRecoveryThreads([
      row({ id: "a" }),
      row({ id: "b" }),
      row({ id: "c" }),
    ]);
    assert.deepEqual(
      recovered.map((entry) => entry.id),
      ["a", "b", "c"],
    );
  });

  // A duplicate would mean a bug in the backend's paging. Collapsing it here
  // would hide that instead of showing it.
  it("does not silently collapse duplicates", () => {
    const recovered = toRecoveryThreads([row({ id: "a" }), row({ id: "a" })]);
    assert.equal(recovered.length, 2);
  });

  it("maps an empty page to an empty list", () => {
    assert.deepEqual(toRecoveryThreads([]), []);
  });
});
