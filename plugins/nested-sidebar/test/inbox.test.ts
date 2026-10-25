import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  PluginSidebarProject,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk";
import {
  buildProjectGroups,
  childrenOf,
  parentOf,
  searchProjectThreadGroups,
  searchThreadsByTitle,
  sortByCreatedAtDescending,
  threadDisplayTitle,
  threadIsWorking,
  visibleInboxThreads,
} from "../lib/inbox.ts";

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
    createdAt: 100,
    updatedAt: 100,
    lastReadAt: 100,
    latestAttentionAt: 100,
    ...overrides,
  };
}

function project(
  id: string,
  name: string,
  isPersonal = false,
): PluginSidebarProject {
  return {
    id,
    name,
    isPersonal,
    href: `/projects/${id}`,
    settingsHref: `/projects/${id}/settings`,
  };
}

describe("sortByCreatedAtDescending", () => {
  it("puts the newest thread first", () => {
    const ordered = sortByCreatedAtDescending([
      thread({ id: "a", createdAt: 1 }),
      thread({ id: "b", createdAt: 3 }),
      thread({ id: "c", createdAt: 2 }),
    ]);
    assert.deepEqual(
      ordered.map((t) => t.id),
      ["b", "c", "a"],
    );
  });

  // The whole premise: activity must never move a row. Only createdAt is read,
  // so a thread that just did work keeps its place.
  it("ignores activity and update time", () => {
    const before = [
      thread({ id: "a", createdAt: 2, updatedAt: 1 }),
      thread({ id: "b", createdAt: 1, updatedAt: 999, indicator: "runtime" }),
    ];
    assert.deepEqual(
      sortByCreatedAtDescending(before).map((t) => t.id),
      ["a", "b"],
    );
  });

  it("breaks ties on id so the order is stable", () => {
    const ordered = sortByCreatedAtDescending([
      thread({ id: "b", createdAt: 5 }),
      thread({ id: "a", createdAt: 5 }),
    ]);
    assert.deepEqual(
      ordered.map((t) => t.id),
      ["a", "b"],
    );
  });

  it("does not mutate its input", () => {
    const input = [
      thread({ id: "a", createdAt: 1 }),
      thread({ id: "b", createdAt: 2 }),
    ];
    sortByCreatedAtDescending(input);
    assert.deepEqual(
      input.map((t) => t.id),
      ["a", "b"],
    );
  });
});

describe("threadDisplayTitle", () => {
  it("prefers the title, then the fallback, then a placeholder", () => {
    assert.equal(threadDisplayTitle(thread({ title: "Real" })), "Real");
    assert.equal(
      threadDisplayTitle(thread({ title: null, titleFallback: "Fallback" })),
      "Fallback",
    );
    assert.equal(
      threadDisplayTitle(thread({ title: null, titleFallback: null })),
      "Untitled thread",
    );
  });

  it("treats a whitespace-only title as absent", () => {
    assert.equal(
      threadDisplayTitle(thread({ title: "   ", titleFallback: "Fallback" })),
      "Fallback",
    );
  });
});

describe("searchThreadsByTitle", () => {
  it("matches case-insensitively on the visible title", () => {
    const threads = [
      thread({ id: "a", title: "Sidebar work" }),
      thread({ id: "b", title: "Something else" }),
      thread({ id: "c", title: null, titleFallback: "sidebar fallback" }),
    ];
    assert.deepEqual(
      searchThreadsByTitle(threads, "SIDEBAR").map((t) => t.id),
      ["a", "c"],
    );
  });

  it("returns everything for a blank query", () => {
    const threads = [thread({ id: "a" }), thread({ id: "b" })];
    assert.equal(searchThreadsByTitle(threads, "   ").length, 2);
  });
});

describe("filtering", () => {
  it("drops archived threads", () => {
    const threads = [
      thread({ id: "a" }),
      thread({ id: "b", isArchived: true }),
    ];
    assert.deepEqual(
      visibleInboxThreads(threads, new Set()).map((t) => t.id),
      ["a"],
    );
  });

  // Settling archives the thread in bb, so the archive flag alone would empty
  // the settled shelf the moment anything landed on it.
  it("keeps an archived thread the plugin parked", () => {
    const threads = [
      thread({ id: "a", isArchived: true }),
      thread({ id: "b", isArchived: true }),
    ];
    assert.deepEqual(
      visibleInboxThreads(threads, new Set(["a"])).map((t) => t.id),
      ["a"],
    );
  });

});

describe("project thread groups", () => {
  it("lists every project bb reports, with an empty body when it has no threads", () => {
    const groups = buildProjectGroups(
      [thread({ id: "only", projectId: "p2" })],
      [project("p1", "Empty"), project("p2", "Populated")],
    );
    assert.deepEqual(
      groups.map((group) => group.project.id),
      ["p1", "p2"],
    );
    assert.deepEqual(groups[0]?.families, []);
    assert.deepEqual(
      groups[1]?.families.map((family) => family.root.id),
      ["only"],
    );
  });

  // A thread bb files under a project it does not list still needs a row.
  it("files a thread whose project is not listed after the known ones", () => {
    const groups = buildProjectGroups(
      [
        thread({ id: "known", projectId: "p1" }),
        thread({ id: "stray_b", projectId: "p9" }),
        thread({ id: "stray_a", projectId: "p8" }),
      ],
      [project("p1", "Known")],
    );
    assert.deepEqual(
      groups.map((group) => group.project.id),
      ["p1", "p8", "p9"],
    );
    assert.deepEqual(
      groups.slice(1).map((group) => group.project.name),
      ["Other project", "Other project"],
    );
  });

  it("keeps bb's project order, pins roots within a project, and flattens descendants", () => {
    const groups = buildProjectGroups(
      [
        thread({ id: "root", projectId: "p1", createdAt: 10 }),
        thread({
          id: "child",
          projectId: "p1",
          parentThreadId: "root",
          createdAt: 20,
        }),
        thread({
          id: "grandchild",
          projectId: "p1",
          parentThreadId: "child",
          createdAt: 30,
        }),
        thread({
          id: "pinned",
          projectId: "p1",
          isPinned: true,
          createdAt: 5,
        }),
        thread({ id: "other", projectId: "p2", createdAt: 40 }),
      ],
      [project("p2", "Second"), project("p1", "First")],
    );

    assert.deepEqual(
      groups.map((group) => group.project.id),
      ["p2", "p1"],
    );
    assert.deepEqual(
      groups[1]?.families.map((family) => family.root.id),
      ["pinned", "root"],
    );
    assert.deepEqual(
      groups[1]?.families[1]?.children.map((child) => child.id),
      ["child", "grandchild"],
    );
  });

  it("buckets a thread by its workspace owner, not its claimed project", () => {
    const groups = buildProjectGroups(
      [
        thread({
          id: "moved",
          projectId: "p1",
          environment: {
            id: "env_moved",
            name: null,
            branchName: "main",
            path: "/work/warren",
            isWorktree: false,
            providerId: "project-checkout",
            workspaceDisplayKind: "other",
          },
        }),
      ],
      [project("p1", "Claimed"), project("p2", "Owner")],
      {
        env_moved: {
          environmentId: "env_moved",
          claimedProjectId: "p1",
          ownerProjectId: "p2",
          workspaceKey: "ws:host:/work/warren",
          repoKey: "repo:remote:example/warren",
          kind: "project-checkout",
          confidence: "exact-source",
          conflict: true,
        },
      },
    );

    assert.deepEqual(groups[0]?.families, []);
    assert.deepEqual(
      groups[1]?.families.map((family) => family.root.id),
      ["moved"],
    );
  });

  it("promotes a child when its parent is not visible", () => {
    const groups = buildProjectGroups(
      [thread({ id: "child", parentThreadId: "parked" })],
      [project("proj_1", "Project")],
    );
    assert.equal(groups[0]?.families[0]?.root.id, "child");
  });

  it("keeps a parent as context when only its child matches search", () => {
    const groups = buildProjectGroups(
      [
        thread({ id: "root", title: "Parent" }),
        thread({
          id: "match",
          title: "Fix checkout",
          parentThreadId: "root",
        }),
        thread({
          id: "other",
          title: "Review taxes",
          parentThreadId: "root",
        }),
      ],
      [project("proj_1", "Storefront")],
    );
    const result = searchProjectThreadGroups(groups, "checkout");
    assert.equal(result[0]?.families[0]?.root.id, "root");
    assert.deepEqual(
      result[0]?.families[0]?.children.map((child) => child.id),
      ["match"],
    );
  });

  it("matches a project name and keeps the whole project", () => {
    const groups = buildProjectGroups(
      [thread({ id: "root" })],
      [project("proj_1", "Storefront")],
    );
    assert.equal(searchProjectThreadGroups(groups, "store").length, 1);
  });
});

describe("threadIsWorking", () => {
  it("includes activity counts and resolved runtime states", () => {
    assert.equal(
      threadIsWorking(
        thread({ activity: { workflows: 0, backgroundAgents: 1, backgroundCommands: 0, planMode: 0, goals: 0 } }),
      ),
      true,
    );
    assert.equal(threadIsWorking(thread({ indicator: "runtime" })), true);
    assert.equal(threadIsWorking(thread()), false);
  });
});

describe("child threads", () => {
  it("lists a thread's children oldest first", () => {
    const children = childrenOf(
      [
        thread({ id: "parent" }),
        thread({ id: "b", parentThreadId: "parent", createdAt: 20 }),
        thread({ id: "a", parentThreadId: "parent", createdAt: 10 }),
        thread({ id: "other", parentThreadId: "elsewhere" }),
      ],
      "parent",
    );
    assert.deepEqual(
      children.map((t) => t.id),
      ["a", "b"],
    );
  });
});

describe("parentOf", () => {
  // The list hides an archived parent, but the child's header must still get
  // it back — otherwise the child is a dead end.
  it("finds a parent the inbox filters out", () => {
    const parent = parentOf(
      [
        thread({ id: "parent", isArchived: true, projectId: "other" }),
        thread({ id: "child", parentThreadId: "parent" }),
      ],
      "child",
    );
    assert.equal(parent?.id, "parent");
  });

  it("returns null for a root thread", () => {
    assert.equal(parentOf([thread({ id: "root" })], "root"), null);
  });

  it("returns null when the parent row is gone", () => {
    const threads = [thread({ id: "child", parentThreadId: "deleted" })];
    assert.equal(parentOf(threads, "child"), null);
  });
});
