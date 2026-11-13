import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ExperimentalPanelTab,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";

import type { WorkspaceEnvironmentDescriptor } from "../lib/workspace.ts";
import {
  findDiffTabKey,
  tabAfterClose,
  workspaceChats,
} from "../lib/workspace-tabs.ts";
import { testWorkspaceIndex } from "./_workspace-index.ts";

function environment(id: string, path: string): WorkspaceEnvironmentDescriptor {
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

const index = testWorkspaceIndex({
  environments: {
    env_a: environment("env_a", "/work/a"),
    env_b: environment("env_b", "/work/b"),
  },
  projects: {
    p1: { projectId: "p1", sourcePath: "/work/repo", sourceHostId: "host_1" },
  },
});
const keyA = "ws:host_1:/work/a";
const keyB = "ws:host_1:/work/b";

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

describe("tabAfterClose", () => {
  const chats = [thread("a", "env_a"), thread("b", "env_a"), thread("c", "env_a")];

  it("selects the tab to the right, then the left", () => {
    assert.equal(tabAfterClose(chats, "b")?.id, "c");
    assert.equal(tabAfterClose(chats, "c")?.id, "b");
    assert.equal(tabAfterClose([chats[0]!], "a"), null);
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
