import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { defaultViewState, decodeViewState } from "../lib/view-state.ts";
import { toArchivedThread, type RecoveryThreadRow } from "../lib/recovery-threads.ts";

const server = await readFile(new URL("../server.ts", import.meta.url), "utf8");
const hook = await readFile(
  new URL("../hooks/use-project-archived-threads.ts", import.meta.url),
  "utf8",
);
const shelf = await readFile(
  new URL("../components/inbox/archived-shelf.tsx", import.meta.url),
  "utf8",
);
const projectNode = await readFile(
  new URL("../components/inbox/project-node.tsx", import.meta.url),
  "utf8",
);
const rowContextMenu = await readFile(
  new URL("../components/inbox/row-context-menu.tsx", import.meta.url),
  "utf8",
);
const inbox = await readFile(
  new URL("../components/inbox/thread-inbox.tsx", import.meta.url),
  "utf8",
);

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

describe("the archived shelf's view state", () => {
  it("defaults to off, because an archive is a deliberate look", () => {
    assert.deepEqual(defaultViewState().archivedProjects, []);
  });

  it("round-trips through the stored record", () => {
    const decoded = decodeViewState(
      JSON.stringify({ version: 1, archivedProjects: ["p1", "p2"] }),
    );
    assert.deepEqual(decoded.archivedProjects, ["p1", "p2"]);
  });

  // Per field, like every other list here: a record from before this existed
  // simply has no entry for it, and that means the default.
  it("reads a record that predates the field", () => {
    const decoded = decodeViewState(
      JSON.stringify({ version: 1, collapsedProjects: ["p9"] }),
    );
    assert.deepEqual(decoded.archivedProjects, []);
    assert.deepEqual(decoded.collapsedProjects, ["p9"]);
  });

  it("drops a list this build cannot use", () => {
    const decoded = decodeViewState(
      JSON.stringify({ version: 1, archivedProjects: ["ok", 7] }),
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

describe("the archived shelf's read", () => {
  it("reads one project at a time, bounded", () => {
    assert.match(server, /listProjectArchivedThreads: \{/);
    assert.match(server, /limit: z\.number\(\)\.int\(\)\.positive\(\)\.max\(MAX_ARCHIVED_SHELF_ROWS\)/);
    assert.match(hook, /rpc\.call\("listProjectArchivedThreads", \{/);
    assert.match(
      server,
      /async listProjectArchivedThreads\(\{[\s\S]*?projectId,[\s\S]*?projectIds,[\s\S]*?environmentIds,[\s\S]*?limit,[\s\S]*?\}\) \{/,
    );
  });

  // Newest archive first, which is the order a person looks for them in.
  it("orders by when bb archived them", () => {
    assert.match(
      server,
      /\.sort\(\(left, right\) => \(right\.archivedAt \?\? 0\) - \(left\.archivedAt \?\? 0\)\)/,
    );
  });

  // The host's own sidebar does not draw hidden threads, so neither does this.
  it("leaves hidden rows out", () => {
    const handler = server.slice(
      server.indexOf("async listProjectArchivedThreads"),
    );
    assert.match(
      handler.slice(0, 1_600),
      /row\.visibility === "visible"/,
    );
  });

  /**
   * "Nothing is archived here" and "we could not look" are different answers,
   * and only one of them is a reason to stop looking — so a failed read draws no
   * shelf rather than an empty one.
   */
  it("draws no shelf for a project whose archive could not be read", () => {
    assert.match(hook, /return \[projectId, null\] as const;/);
    assert.match(hook, /if \(threads !== null\) next\.set\(projectId, threads\);/);
  });

  // One read for the list, not one subscription per project row.
  it("reads once for every open shelf, in the inbox", () => {
    assert.match(inbox, /const archived = useProjectArchivedThreads\(\{/);
    assert.match(inbox, /projectIds: viewState\.archivedProjects,/);
    assert.match(inbox, /limit: ARCHIVED_SHELF_LIMIT,/);
    assert.doesNotMatch(projectNode, /useProjectArchivedThreads/);
  });

  it("re-reads itself when a thread is unarchived", () => {
    assert.match(hook, /useCoalescedRealtime\("lifecycle", read\)/);
  });

  /**
   * Unarchiving goes through the plugin's own `unsettle`, which does exactly the
   * right thing for a thread Nest never settled: it takes bb's archive off the id
   * and clears a row that is not there. It also means a failure gets the retry
   * prompt the settled shelf gets, rather than a second quieter failure path.
   */
  it("unarchives through the settled shelf's own call", () => {
    assert.match(hook, /rpc\s*\n?\s*\.call\("unsettle", \{ threadId \}\)/);
  });

  /**
   * The row leaves optimistically, so a failure has to be said out loud: a
   * silent one is a thread that vanished from the shelf and came back nowhere.
   */
  it("announces an unarchive the host refused", () => {
    assert.match(hook, /announceToSidebar/);
    assert.match(hook, /result\.message !== null/);
    // And not only the resolved failure: a rejected call is the same outcome.
    assert.match(hook, /\.catch\(\(\) => \{/);
  });
});

describe("the archived shelf's surface", () => {
  it("is a toggle on the project's own menu", () => {
    assert.match(projectNode, /label: "Show archived threads"/);
    assert.match(projectNode, /checked: archivedShelfOn/);
    assert.match(projectNode, /onToggleArchivedShelf/);
    assert.match(inbox, /isArchivedShelfOn: \(projectId\) =>/);
    assert.match(inbox, /setArchivedShelf: \(projectId, on\) =>/);
    // A checkbox, not a label that flips: the shelf stays on until it is turned
    // off, and the tick is the only thing that says so.
    assert.match(rowContextMenu, /<ContextMenu\.CheckboxItem/);
  });

  it("draws inside the expanded project, and only when it has rows", () => {
    assert.match(
      projectNode,
      /expanded && viewState\.isArchivedShelfOn\(node\.project\.id\) \? \(/,
    );
    assert.match(shelf, /if \(threads\.length === 0\) return null;/);
  });

  // The same two attributes every row carries, so the numbered thread jumps and
  // the shortcut contract reach an archived row too.
  it("gives its rows the shortcut contract", () => {
    assert.match(shelf, /data-sidebar-thread-shortcut-target=""/);
    assert.match(shelf, /data-sidebar-thread-id=\{thread\.id\}/);
  });

  // Clicking reads it without unarchiving it: a shelf where every look changed
  // the archive would make the user think twice about looking.
  it("separates reading from unarchiving", () => {
    assert.match(shelf, /onOpen\(thread\.id\)/);
    assert.match(shelf, /onUnarchive\(thread\.id\)/);
    assert.match(shelf, /aria-label=\{`Unarchive \$\{title\}`\}/);
  });
});
