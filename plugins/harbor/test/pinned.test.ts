import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk";
import {
  PINNED_DRAG_TYPE,
  encodeDraggedPinned,
  orderPinnedFamilies,
  parseDraggedPinned,
  pinnedNeighbours,
  pinnedRootIds,
  splitPinnedFamilies,
} from "../lib/domain/pinned.ts";
import type { ProjectThreadGroup, ThreadFamily } from "../lib/domain/inbox.ts";

function thread(
  id: string,
  createdAt: number,
  extra: Partial<PluginSidebarThread> = {},
): PluginSidebarThread {
  return {
    id,
    projectId: "p1",
    title: id,
    titleFallback: null,
    displayTitle: id,
    parentThreadId: null,
    parentNotifications: "auto",
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
    },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    pinnedAt: null,
    pinSortKey: null,
    isArchived: false,
    archivedAt: null,
    href: `/projects/p1/threads/${id}`,
    isHidden: false,
    environment: null,
    host: null,
    createdAt,
    updatedAt: createdAt,
    lastReadAt: null,
    latestAttentionAt: createdAt,
    ...extra,
  };
}

function family(id: string, createdAt: number, pinned = false): ThreadFamily {
  return { root: thread(id, createdAt, { isPinned: pinned }), children: [] };
}

function group(id: string, families: ThreadFamily[]): ProjectThreadGroup {
  return {
    project: {
      id,
      name: id,
      isPersonal: false,
      href: `/projects/${id}`,
      settingsHref: `/projects/${id}/settings`,
    },
    families,
  };
}

describe("splitPinnedFamilies", () => {
  it("takes every project's pinned roots out of the tree", () => {
    const { pinned, rest } = splitPinnedFamilies([
      group("p1", [family("a", 3, true), family("b", 2)]),
      group("p2", [family("c", 1, true)]),
    ]);
    assert.deepEqual(
      pinned.map((entry) => entry.family.root.id),
      ["a", "c"],
    );
    assert.deepEqual(
      rest.flatMap((entry) => entry.families.map((f) => f.root.id)),
      ["b"],
    );
  });

  it("names the project each pinned root came from", () => {
    const { pinned } = splitPinnedFamilies([
      group("p2", [family("c", 1, true)]),
    ]);
    assert.equal(pinned[0]?.projectId, "p2");
    assert.equal(pinned[0]?.projectName, "p2");
  });

  // A pinned row moves to its own section, but its project stays where it has
  // always been: an empty project row is where its next thread starts.
  it("keeps a project whose only thread was pinned", () => {
    const { rest } = splitPinnedFamilies([
      group("p1", [family("a", 1, true)]),
      group("p2", [family("b", 2)]),
    ]);
    assert.deepEqual(
      rest.map((entry) => entry.project.id),
      ["p1", "p2"],
    );
    assert.deepEqual(rest[0]?.families, []);
  });

  it("keeps a project that never had a thread", () => {
    const { rest } = splitPinnedFamilies([group("p1", [])]);
    assert.deepEqual(rest.map((entry) => entry.project.id), ["p1"]);
  });

  it("keeps a child with its pinned parent", () => {
    const child = thread("child", 1, { parentThreadId: "a" });
    const withChild: ThreadFamily = { root: thread("a", 2, { isPinned: true }), children: [child] };
    const { pinned } = splitPinnedFamilies([group("p1", [withChild])]);
    assert.deepEqual(
      pinned[0]?.family.children.map((entry) => entry.id),
      ["child"],
    );
  });

  it("returns nothing to split when nothing is pinned", () => {
    const { pinned, rest } = splitPinnedFamilies([group("p1", [family("a", 1)])]);
    assert.deepEqual(pinned, []);
    assert.equal(rest.length, 1);
  });
});

describe("orderPinnedFamilies", () => {
  const pinned = splitPinnedFamilies([
    group("p1", [family("a", 3, true), family("b", 2, true)]),
    group("p2", [family("c", 1, true)]),
  ]).pinned;

  /**
   * bb's order, not a private one. A pin moved in the built-in sidebar has to be
   * in the same place here, or the two surfaces disagree about the same list.
   */
  it("follows bb's order rather than the tree's", () => {
    assert.deepEqual(
      pinnedRootIds(orderPinnedFamilies(pinned, ["c", "a", "b"])),
      ["c", "a", "b"],
    );
  });

  /**
   * A read that has not caught up — a pin made on another client — must not hide
   * a row. An unnamed entry lands after the named ones, newest first, which is
   * the same order the tree would have drawn it in.
   */
  it("appends what the order does not name, newest first", () => {
    assert.deepEqual(
      pinnedRootIds(orderPinnedFamilies(pinned, ["c"])),
      ["c", "a", "b"],
    );
    assert.deepEqual(
      pinnedRootIds(orderPinnedFamilies(pinned, ["b"])),
      ["b", "a", "c"],
    );
  });

  it("falls back to creation order when there is no order at all", () => {
    assert.deepEqual(
      pinnedRootIds(orderPinnedFamilies(pinned, [])),
      ["a", "b", "c"],
    );
  });

  it("keeps every row when the order names nothing it holds", () => {
    assert.equal(orderPinnedFamilies(pinned, ["gone", "also-gone"]).length, 3);
  });

  it("maps an empty section to an empty list", () => {
    assert.deepEqual(orderPinnedFamilies([], ["a"]), []);
  });
});

describe("pinnedNeighbours", () => {
  const ids = ["a", "b", "c"];

  /**
   * bb's reorder takes the ids either side of the drop, and those are the
   * neighbours the row would land between — so the list is read without the row
   * being moved. Reading it with the source still in place would name the source
   * itself as a neighbour for an adjacent drop.
   */
  it("names the pair a drop lands between", () => {
    assert.deepEqual(
      pinnedNeighbours({ orderedIds: ids, sourceId: "a", targetId: "c", position: "before" }),
      { previousThreadId: "b", nextThreadId: "c" },
    );
    assert.deepEqual(
      pinnedNeighbours({ orderedIds: ids, sourceId: "c", targetId: "a", position: "before" }),
      { previousThreadId: null, nextThreadId: "a" },
    );
    assert.deepEqual(
      pinnedNeighbours({ orderedIds: ids, sourceId: "a", targetId: "c", position: "after" }),
      { previousThreadId: "c", nextThreadId: null },
    );
  });

  it("refuses a move against the row being moved", () => {
    assert.equal(
      pinnedNeighbours({ orderedIds: ids, sourceId: "a", targetId: "a", position: "after" }),
      null,
    );
  });

  // A reorder that moves the wrong row is worse than one that does nothing.
  it("refuses an id the list does not hold", () => {
    assert.equal(
      pinnedNeighbours({ orderedIds: ids, sourceId: "gone", targetId: "a", position: "before" }),
      null,
    );
    assert.equal(
      pinnedNeighbours({ orderedIds: ids, sourceId: "a", targetId: "gone", position: "before" }),
      null,
    );
  });
});

describe("the pinned drag payload", () => {
  it("round-trips a root id", () => {
    assert.deepEqual(parseDraggedPinned(encodeDraggedPinned("thr_1")), {
      rootId: "thr_1",
    });
  });

  it("rejects anything it did not write", () => {
    for (const raw of ["", "{", "null", "[]", "{}", '{"rootId":1}', '{"rootId":""}']) {
      assert.equal(parseDraggedPinned(raw), null, raw);
    }
  });

  // Its own type, because a drop handler has to tell "move inside the project"
  // from "move inside the pinned section": they land in different stores.
  it("is not the family payload", () => {
    assert.equal(PINNED_DRAG_TYPE, "application/x-harbor-pinned");
    assert.notEqual(PINNED_DRAG_TYPE, "application/x-harbor-family");
  });
});
