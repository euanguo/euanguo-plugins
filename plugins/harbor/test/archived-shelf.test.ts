import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultViewState, decodeViewState } from "../lib/ui/view-state.ts";
import { toArchivedThread, type RecoveryThreadRow } from "../lib/domain/recovery-threads.ts";

function row(overrides: Partial<RecoveryThreadRow> = {}): RecoveryThreadRow {
  return {
    id: "thr_1",
    projectId: "p1",
    title: "Archived work",
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

describe("the archived shelf's view state", () => {
  it("defaults to off, because an archive is a deliberate look", () => {
    assert.deepEqual(defaultViewState().archivedProjects, []);
  });

  it("round-trips through the stored record", () => {
    const decoded = decodeViewState(
      JSON.stringify({ version: 2, archivedProjects: ["p1", "p2"] }),
    );
    assert.deepEqual(decoded.archivedProjects, ["p1", "p2"]);
  });

  // Per field, like every other list here: a record from before this existed
  // simply has no entry for it, and that means the default.
  it("reads a record that predates the field", () => {
    const decoded = decodeViewState(
      JSON.stringify({ version: 2, collapsedProjects: ["p9"] }),
    );
    assert.deepEqual(decoded.archivedProjects, []);
    assert.deepEqual(decoded.collapsedProjects, ["p9"]);
  });

  it("drops a list this build cannot use", () => {
    const decoded = decodeViewState(
      JSON.stringify({ version: 2, archivedProjects: ["ok", 7] }),
    );
    assert.deepEqual(decoded.archivedProjects, []);
  });
});

describe("toArchivedThread", () => {
  /**
   * The one field that differs from the recovery read, and the reason the shelf
   * exists. Everything else is the same mapper, so a field added to one read is
   * added to both.
   */
  it("marks the row archived, and is otherwise the recovery mapping", () => {
    const archived = toArchivedThread(row());
    assert.equal(archived.isArchived, true);
    assert.equal(archived.id, "thr_1");
    assert.equal(archived.projectId, "p1");
    assert.equal(archived.isUnread, false);
  });
});
