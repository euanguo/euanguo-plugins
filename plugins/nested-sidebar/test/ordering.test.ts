import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk";
import { buildTree } from "../lib/tree.ts";
import type { ProjectThreadGroup, ThreadFamily } from "../lib/inbox.ts";
import { UNGROUPED_ORDER_SCOPE } from "../lib/manual-order.ts";
import {
  orderFamilies,
  orderProjectGroups,
  orderedProjectIds,
  projectOrderScope,
} from "../lib/ordering.ts";

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1_000;

function thread(
  id: string,
  projectId: string,
  createdAt: number,
  extra: Partial<PluginSidebarThread> = {},
): PluginSidebarThread {
  return {
    id,
    projectId,
    title: id,
    titleFallback: null,
    displayTitle: id,
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
    href: `/projects/${projectId}/threads/${id}`,
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

function family(
  rootId: string,
  projectId: string,
  createdAt: number,
  extra: Partial<PluginSidebarThread> = {},
): ThreadFamily {
  return { root: thread(rootId, projectId, createdAt, extra), children: [] };
}

function group(
  id: string,
  name: string,
  families: ThreadFamily[],
): ProjectThreadGroup {
  return {
    project: {
      id,
      name,
      isPersonal: false,
      href: `/projects/${id}`,
      settingsHref: `/projects/${id}/settings`,
    },
    families,
  };
}

const ASSIGNMENT = { p1: "g1", p2: "g1", p3: "g2" };

describe("project ordering", () => {
  it("reads the manual order per group and appends unknown projects", () => {
    const groups = [
      group("p1", "Alpha", []),
      group("p2", "Beta", []),
      group("p3", "Gamma", []),
    ];
    const ordered = orderProjectGroups(groups, {
      assignment: ASSIGNMENT,
      groupOrder: ["g1", "g2"],
      manual: { g1: ["p2", "p1"] },
      mode: "manual",
      now: NOW,
    });
    assert.deepEqual(
      ordered.map((item) => item.project.id),
      ["p2", "p1", "p3"],
    );
  });

  it("sorts by name, size, recency, and status", () => {
    // One group, so the four comparators are what decides the order.
    const oneGroup = { p1: "g1", p2: "g1", p3: "g1" };
    const alpha = group("p1", "Alpha", [
      family("t1", "p1", NOW - 10_000, { updatedAt: NOW - 500 }),
    ]);
    const zulu = group("p2", "Zulu", [
      family("t2", "p2", NOW - 20_000),
      family("t3", "p2", NOW - 1_000, { updatedAt: NOW - 1_000 }),
    ]);
    const mike = group("p3", "Mike", [
      family("t4", "p3", NOW - 3 * DAY, {
        updatedAt: NOW - 3 * DAY,
        indicator: "waiting-for-input",
      }),
    ]);
    const groups = [alpha, zulu, mike];
    const order = (mode: "name-asc" | "threads-desc" | "updated-desc" | "status") =>
      orderProjectGroups(groups, {
        assignment: oneGroup,
        groupOrder: ["g1"],
        manual: {},
        mode,
        now: NOW,
      }).map((item) => item.project.id);

    assert.deepEqual(order("name-asc"), ["p1", "p3", "p2"]);
    assert.deepEqual(order("threads-desc"), ["p2", "p1", "p3"]);
    assert.deepEqual(order("updated-desc"), ["p1", "p2", "p3"]);
    // Needs-you outranks recency, and the rest fall back to recency.
    assert.deepEqual(order("status"), ["p3", "p1", "p2"]);
  });

  it("keeps a group's projects together and derives its drawn ids", () => {
    const groups = [group("p2", "Beta", []), group("p1", "Alpha", [])];
    const ordered = orderProjectGroups(groups, {
      assignment: ASSIGNMENT,
      groupOrder: ["g1", "g2"],
      manual: {},
      mode: "name-asc",
      now: NOW,
    });
    assert.deepEqual(
      orderedProjectIds(ordered, ASSIGNMENT, "g1"),
      ["p1", "p2"],
    );
    assert.equal(projectOrderScope(ASSIGNMENT, "p3"), "g2");
    assert.equal(projectOrderScope({}, "p9"), UNGROUPED_ORDER_SCOPE);
  });
});

describe("family ordering", () => {
  it("keeps pinned roots first under every mode", () => {
    const families = [
      family("old", "p1", NOW - 30_000),
      family("pinned", "p1", NOW - 40_000, { isPinned: true }),
      family("new", "p1", NOW - 10_000),
    ];
    const ordered = orderFamilies(families, {
      manual: undefined,
      mode: "created-desc",
      now: NOW,
    });
    assert.deepEqual(ordered.map((item) => item.root.id), [
      "pinned",
      "new",
      "old",
    ]);
  });

  it("sorts by creation, update, name, and status", () => {
    const families = [
      family("bravo", "p1", NOW - 20_000),
      family("alpha", "p1", NOW - 30_000),
      family("zulu", "p1", NOW - 10_000, {
        updatedAt: NOW - 500,
        indicator: "waiting-for-input",
      }),
    ];
    const ids = (mode: "created-desc" | "created-asc" | "updated-desc" | "name-asc" | "status") =>
      orderFamilies(families, { manual: undefined, mode, now: NOW }).map(
        (item) => item.root.id,
      );
    assert.deepEqual(ids("created-desc"), ["zulu", "bravo", "alpha"]);
    assert.deepEqual(ids("created-asc"), ["alpha", "bravo", "zulu"]);
    assert.deepEqual(ids("updated-desc"), ["zulu", "bravo", "alpha"]);
    assert.deepEqual(ids("name-asc"), ["alpha", "bravo", "zulu"]);
    assert.deepEqual(ids("status"), ["zulu", "bravo", "alpha"]);
  });

  it("reads the stored manual order in manual mode", () => {
    const families = [
      family("a", "p1", NOW - 10_000),
      family("b", "p1", NOW - 20_000),
      family("c", "p1", NOW - 30_000),
    ];
    const ordered = orderFamilies(families, {
      manual: ["c", "a", "b"],
      mode: "manual",
      now: NOW,
    });
    assert.deepEqual(ordered.map((item) => item.root.id), ["c", "a", "b"]);
  });

  it("orders by the most recent attention signal", () => {
    const families = [
      family("a", "p1", NOW - 10_000, { latestAttentionAt: NOW - 10_000 }),
      family("b", "p1", NOW - 20_000, { latestAttentionAt: NOW - 100 }),
      family("c", "p1", NOW - 30_000, { latestAttentionAt: NOW - 5_000 }),
    ];
    const ordered = orderFamilies(families, {
      manual: undefined,
      mode: "attention-desc",
      now: NOW,
    });
    assert.deepEqual(ordered.map((item) => item.root.id), ["b", "c", "a"]);
  });
});

describe("the tree keeps the order it is given", () => {
  it("does not re-sort projects by name", () => {
    const nodes = buildTree({
      projectGroups: [
        {
          project: {
            id: "z",
            name: "Zebra",
            isPersonal: false,
            href: "/projects/z",
            settingsHref: "/projects/z/settings",
          },
          families: [],
        },
        {
          project: {
            id: "a",
            name: "Apple",
            isPersonal: false,
            href: "/projects/a",
            settingsHref: "/projects/a/settings",
          },
          families: [],
        },
      ],
      now: NOW,
      assignment: {},
      groupOrder: [],
      workspaceOrder: {},
      ungroupedIcon: "FolderTreeIcon",
    });
    assert.deepEqual(
      nodes.flatMap((node) => node.projects.map((item) => item.project.name)),
      ["Zebra", "Apple"],
    );
  });
});
