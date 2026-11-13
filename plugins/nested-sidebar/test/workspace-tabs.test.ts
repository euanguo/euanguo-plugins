import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ExperimentalPanelTab,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";

import type { Feature } from "../lib/features.ts";
import type { WorkspaceEnvironmentDescriptor } from "../lib/workspace.ts";
import {
  deferSettleUntilOpen,
  familyDescendants,
  featureTitle,
  filterWorkspaceTabs,
  findDiffTabKey,
  shouldShowWorkspaceSearch,
  siblingWorkspaces,
  tabAfterBulkClose,
  tabAfterClose,
  tabsToClose,
  takePendingSettle,
  untitledCloseTarget,
  workspaceChats,
  workspaceSwitchTarget,
  workspaceTabs,
} from "../lib/workspace-tabs.ts";
import { familyStatusPresentation } from "../lib/family-status.ts";
import { testWorkspaceIndex } from "./_workspace-index.ts";

function environment(
  id: string,
  path: string,
  overrides: Partial<WorkspaceEnvironmentDescriptor> = {},
): WorkspaceEnvironmentDescriptor {
  return {
    id,
    projectId: "p1",
    hostId: "host_1",
    path,
    isGitRepo: true,
    isWorktree: false,
    branchName: null,
    name: null,
    providerId: null,
    workspaceDisplayKind: "other",
    ...overrides,
  };
}

function thread(
  id: string,
  environmentId: string | null,
  overrides: Partial<PluginSidebarThread> = {},
): PluginSidebarThread {
  return {
    id,
    projectId: "p1",
    title: id,
    titleFallback: id,
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
    createdAt: 1,
    updatedAt: 1,
    lastReadAt: null,
    latestAttentionAt: 1,
    environment:
      environmentId === null
        ? null
        : {
            id: environmentId,
            name: null,
            branchName: null,
            providerId: null,
            workspaceDisplayKind: null,
          },
    host: null,
    href: `/threads/${id}`,
    ...overrides,
  } as unknown as PluginSidebarThread;
}

const FEATURE: Feature = {
  id: "f1",
  name: "Feature One",
  slug: "feature-one",
  state: "active",
  position: 0,
  rootPath: "/work/feature",
  hostId: "host_1",
};

const index = testWorkspaceIndex({
  environments: {
    env_a: environment("env_a", "/work/a"),
    env_b: environment("env_b", "/work/b"),
    env_root: environment("env_root", "/work/feature", {
      projectId: "pf",
      branchName: "feat/x",
    }),
    env_member_a: environment("env_member_a", "/work/feature/repo-a", {
      projectId: "pf",
      isWorktree: true,
      branchName: "feat/x-a",
    }),
    env_member_b: environment("env_member_b", "/work/feature/repo-b", {
      projectId: "pf",
      isWorktree: true,
      branchName: "feat/x-b",
    }),
    env_checkout: environment("env_checkout", "/work/repo", {
      projectId: "p2",
    }),
    env_sibling: environment("env_sibling", "/work/sibling", {
      projectId: "p2",
      isWorktree: true,
      branchName: "feat/sibling",
    }),
  },
  projects: {
    p1: { projectId: "p1", sourcePath: "/work/a", sourceHostId: "host_1" },
    p2: { projectId: "p2", sourcePath: "/work/repo", sourceHostId: "host_1" },
    pf: { projectId: "pf", sourcePath: "/work/feature", sourceHostId: "host_1" },
  },
  features: [FEATURE],
});
const keyA = "ws:host_1:/work/a";
const keyB = "ws:host_1:/work/b";
const keyRoot = "ws:host_1:/work/feature";
const keyMemberA = "ws:host_1:/work/feature/repo-a";
const keyMemberB = "ws:host_1:/work/feature/repo-b";
const keyCheckout = "ws:host_1:/work/repo";

const NOW = 1_000_000;

describe("workspaceChats", () => {
  const threads = [
    thread("later", "env_a", { createdAt: 2 }),
    thread("first", "env_a", { createdAt: 1 }),
    thread("other", "env_b"),
    thread("subagent", "env_a", { parentThreadId: "first" }),
    thread("side-chat", "env_a", { isHidden: true }),
    thread("closed", "env_a", { isArchived: true }),
    thread("no-env", null),
  ];

  it("lists the workspace's visible roots oldest first", () => {
    assert.deepEqual(
      workspaceChats(threads, keyA, "first", index).map((chat) => chat.id),
      ["first", "later"],
    );
  });

  it("keeps the open thread as a tab when it is a subagent or hidden", () => {
    assert.deepEqual(
      workspaceChats(threads, keyA, "subagent", index).map((chat) => chat.id),
      ["first", "subagent", "later"],
    );
    assert.ok(
      workspaceChats(threads, keyA, "side-chat", index).some(
        (chat) => chat.id === "side-chat",
      ),
    );
  });

  it("never shows another workspace, an archived row, or a thread with no workspace", () => {
    const ids = workspaceChats(threads, keyB, "other", index).map(
      (chat) => chat.id,
    );
    assert.deepEqual(ids, ["other"]);
  });
});

describe("family status and child counts on a tab", () => {
  const threads = [
    thread("needs-you-root", "env_a"),
    thread("working-child", "env_a", {
      parentThreadId: "needs-you-root",
      indicator: "runtime",
      createdAt: 2,
    }),
    thread("raised-hand", "env_a", {
      parentThreadId: "working-child",
      hasPendingInteraction: true,
      createdAt: 3,
    }),
    thread("archived-child", "env_a", {
      parentThreadId: "needs-you-root",
      isArchived: true,
    }),
    thread("failed-root", "env_a", { indicator: "unread-error" }),
    thread("unread-root", "env_a", { isUnread: true }),
    thread("quiet-root", "env_a"),
  ];

  it("aggregates the whole family and counts live descendants", () => {
    const tabs = workspaceTabs(threads, keyA, "", index, NOW);
    const byId = new Map(tabs.map((tab) => [tab.thread.id, tab]));
    assert.equal(byId.get("needs-you-root")?.status.kind, "needs-you");
    assert.equal(byId.get("needs-you-root")?.childCount, 2);
    assert.equal(byId.get("failed-root")?.status.kind, "failed");
    assert.equal(byId.get("unread-root")?.status.kind, "unread");
    assert.equal(byId.get("quiet-root")?.status.kind, "inactive");
  });

  it("finds descendants through nested parents", () => {
    assert.deepEqual(
      familyDescendants(threads, "needs-you-root").map((entry) => entry.id),
      ["working-child", "raised-hand"],
    );
  });

  it("uses the family presentation vocabulary", () => {
    assert.equal(
      familyStatusPresentation("needs-you").label,
      "Needs you",
    );
  });
});

describe("a workspace with 44 conversations", () => {
  const threads = Array.from({ length: 44 }, (_, index) =>
    thread(`conversation-${String(index).padStart(2, "0")}`, "env_a", {
      createdAt: index + 1,
      title: `Conversation ${String(index).padStart(2, "0")}`,
      displayTitle: `Conversation ${String(index).padStart(2, "0")}`,
    }),
  );

  it("keeps every conversation, most recently used first", () => {
    const tabs = workspaceTabs(threads, keyA, "", index, NOW);
    assert.equal(tabs.length, 44);
    assert.equal(tabs[0]?.thread.id, "conversation-43");
    assert.equal(tabs[43]?.thread.id, "conversation-00");
  });

  it("grows a search field only past eight rows", () => {
    assert.equal(shouldShowWorkspaceSearch(8), false);
    assert.equal(shouldShowWorkspaceSearch(9), true);
    assert.equal(shouldShowWorkspaceSearch(44), true);
  });

  it("filters the dropdown by title and keeps the strip's order", () => {
    const tabs = workspaceTabs(threads, keyA, "", index, NOW);
    assert.deepEqual(
      filterWorkspaceTabs(tabs, "  conversation 4 ").map(
        (tab) => tab.thread.id,
      ),
      [
        "conversation-43",
        "conversation-42",
        "conversation-41",
        "conversation-40",
      ],
    );
    assert.equal(filterWorkspaceTabs(tabs, "nothing").length, 0);
    assert.equal(filterWorkspaceTabs(tabs, "").length, 44);
  });
});

describe("the strip's order", () => {
  it("puts pinned conversations first in bb's pin order", () => {
    const threads = [
      thread("newest", "env_a", { createdAt: 4, lastReadAt: 10 }),
      thread("oldest", "env_a", { createdAt: 1, lastReadAt: 1 }),
      thread("pinned-late", "env_a", {
        createdAt: 2,
        isPinned: true,
        pinnedAt: 5,
        pinSortKey: "b",
      }),
      thread("pinned-early", "env_a", {
        createdAt: 3,
        isPinned: true,
        pinnedAt: 4,
        pinSortKey: "a",
      }),
    ];
    assert.deepEqual(
      workspaceTabs(threads, keyA, "", index, 1_000).map((tab) => tab.thread.id),
      ["pinned-early", "pinned-late", "newest", "oldest"],
    );
  });

  it("puts the rest in the order they were last read", () => {
    const threads = [
      thread("read-long-ago", "env_a", { createdAt: 1, lastReadAt: 5 }),
      thread("never-opened", "env_a", { createdAt: 30 }),
      thread("read-just-now", "env_a", { createdAt: 2, lastReadAt: 40 }),
      thread("read-mid", "env_a", { createdAt: 3, lastReadAt: 20 }),
    ];
    assert.deepEqual(
      workspaceTabs(threads, keyA, "", index, 1_000).map((tab) => tab.thread.id),
      ["read-just-now", "never-opened", "read-mid", "read-long-ago"],
    );
  });
});

describe("tabAfterClose", () => {
  const chats = [thread("a", "env_a"), thread("b", "env_a"), thread("c", "env_a")];

  it("selects the tab to the right, then the left", () => {
    assert.equal(tabAfterClose(chats, "b")?.id, "c");
    assert.equal(tabAfterClose(chats, "c")?.id, "b");
    assert.equal(tabAfterClose([chats[0]!], "a"), null);
  });
});

describe("closing a run of tabs", () => {
  const chats = [
    thread("pinned", "env_a", { createdAt: 1, isPinned: true, pinnedAt: 1 }),
    thread("a", "env_a", { createdAt: 2 }),
    thread("b", "env_a", { createdAt: 3 }),
    thread("c", "env_a", { createdAt: 4 }),
  ];

  it("closes every unpinned tab but the anchor", () => {
    assert.deepEqual(
      tabsToClose(chats, "b", "others").map((chat) => chat.id),
      ["a", "c"],
    );
  });

  it("closes one side, and never a pinned tab", () => {
    assert.deepEqual(
      tabsToClose(chats, "c", "left").map((chat) => chat.id),
      ["a", "b"],
      "the pinned tab at the left edge stays",
    );
    assert.deepEqual(
      tabsToClose(chats, "a", "right").map((chat) => chat.id),
      ["b", "c"],
    );
    assert.deepEqual(tabsToClose(chats, "c", "right"), []);
  });

  it("leaves the pane alone when the open tab survives", () => {
    assert.equal(tabAfterBulkClose(chats, new Set(["a", "c"]), "b"), null);
  });

  it("moves to the right neighbour, then the left, when the open tab closes", () => {
    assert.equal(tabAfterBulkClose(chats, new Set(["c"]), "c")?.id, "b");
    assert.equal(tabAfterBulkClose(chats, new Set(["a", "b", "c"]), "c")?.id, "pinned");
    assert.equal(tabAfterBulkClose(chats, new Set(["a", "b", "c"]), "a")?.id, "pinned");
  });
});

describe("the settle handoff", () => {
  it("fires only for the pair that navigated, and only inside its window", () => {
    deferSettleUntilOpen("closed", "next", 1_000);
    assert.equal(takePendingSettle("closed", "another", 1_100), false);
    assert.equal(takePendingSettle("closed", "next", 1_100), true);
    assert.equal(takePendingSettle("closed", "next", 1_100), false);

    deferSettleUntilOpen("closed", "next", 1_000);
    assert.equal(takePendingSettle("closed", "next", 7_000), false);
  });
});

describe("sibling workspaces and where choosing one goes", () => {
  const root = index.byKey.get(keyRoot)!;
  const memberA = index.byKey.get(keyMemberA)!;
  const checkout = index.byKey.get(keyCheckout)!;

  it("names a feature root and its members with the feature's name", () => {
    assert.equal(featureTitle(memberA, index), "Feature One");
    assert.equal(featureTitle(root, index), "Feature One");
  });

  it("names a feature member whose feature folder never ran anything", () => {
    const rootless = testWorkspaceIndex({
      environments: {
        env_member_a: environment("env_member_a", "/work/feature/repo-a", {
          projectId: "pf",
          isWorktree: true,
          branchName: "feat/x-a",
        }),
      },
      projects: {
        pf: { projectId: "pf", sourcePath: "/work/feature", sourceHostId: "host_1" },
      },
      features: [FEATURE],
    });
    const member = rootless.byKey.get(keyMemberA)!;
    assert.equal(member.featureId, "f1");
    assert.equal(member.parentKey, null);
    assert.equal(featureTitle(member, rootless), "Feature One");
  });

  it("lists the other workspaces of the same feature, root first", () => {
    assert.deepEqual(
      siblingWorkspaces(memberA, index).map((workspace) => workspace.key),
      [keyRoot, keyMemberB],
    );
  });

  it("lists the other workspaces of the same project outside a feature", () => {
    assert.deepEqual(
      siblingWorkspaces(checkout, index).map((workspace) => workspace.label),
      ["feat/sibling"],
    );
  });

  it("opens the last active conversation when it is still visible", () => {
    const workspace = index.byKey.get(keyA)!;
    const threads = [
      thread("old", "env_a", { createdAt: 1 }),
      thread("recent", "env_a", { createdAt: 2 }),
    ];
    assert.deepEqual(
      workspaceSwitchTarget(workspace, threads, index, "recent"),
      { kind: "thread", threadId: "recent" },
    );
  });

  it("falls back to the oldest visible conversation", () => {
    const workspace = index.byKey.get(keyA)!;
    const threads = [
      thread("newest", "env_a", { createdAt: 2 }),
      thread("oldest", "env_a", { createdAt: 1 }),
    ];
    assert.deepEqual(
      workspaceSwitchTarget(workspace, threads, index, "archived-elsewhere"),
      { kind: "thread", threadId: "oldest" },
    );
  });

  it("opens a new conversation when nothing is left", () => {
    const workspace = index.byKey.get(keyA)!;
    assert.deepEqual(workspaceSwitchTarget(workspace, [], index, null), {
      kind: "new-chat",
      environmentId: "env_a",
    });
  });

  it("closing Untitled returns to the last active, else the newest", () => {
    const workspace = index.byKey.get(keyA)!;
    const threads = [
      thread("old", "env_a", { createdAt: 1 }),
      thread("new", "env_a", { createdAt: 2 }),
    ];
    assert.equal(untitledCloseTarget(workspace, threads, index, "old"), "old");
    assert.equal(untitledCloseTarget(workspace, threads, index, "gone"), "new");
    assert.equal(untitledCloseTarget(workspace, [], index, null), null);
  });

  it("opens a new conversation for a workspace whose only route is the composer", () => {
    const unseen = index.byKey.get(keyMemberB)!;
    assert.deepEqual(workspaceSwitchTarget(unseen, [], index, null), {
      kind: "new-chat",
      environmentId: "env_member_b",
    });
  });
});

describe("findDiffTabKey", () => {
  it("finds the Git plugin's diff tab", () => {
    const tabs: ExperimentalPanelTab[] = [
      {
        key: "plugin-fixed:bb--git:diff",
        title: "Diff",
        status: null,
        closable: false,
        detail: {
          kind: "plugin",
          pluginId: "bb--git",
          tab: {
            id: "diff",
            context: { kind: "thread" },
            availability: "fixed",
          },
          params: null,
        },
      },
    ];
    assert.equal(tabAfterClose([], "x"), null);
    assert.equal(findDiffTabKey(tabs), "plugin-fixed:bb--git:diff");
    assert.equal(findDiffTabKey([]), null);
  });
});
