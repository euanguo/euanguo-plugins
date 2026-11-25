import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk";

import { workspaceIndexFromThreads, useWorkspaceIndex } from "../hooks/use-workspace-index.ts";
import { buildWorkspaceIndex, type WorkspaceIndex } from "../lib/domain/workspace-index.ts";
import { physicalWorkspaceKey } from "../lib/domain/workspace-key.ts";
import type { WorkspaceEnvironmentDescriptor } from "../lib/domain/workspace.ts";

const HOST = "host_1";

function thread(
  id: string,
  environmentId: string | null,
  path: string | null,
  hostId: string | null = HOST,
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
            path,
            isWorktree: null,
            providerId: null,
            workspaceDisplayKind: null,
          },
    host: hostId === null ? null : { id: hostId, name: "Host" },
    href: `/threads/${id}`,
  } as unknown as PluginSidebarThread;
}

function environment(
  id: string,
  path: string,
): WorkspaceEnvironmentDescriptor {
  return {
    id,
    projectId: "p1",
    hostId: HOST,
    path,
    isGitRepo: true,
    isWorktree: false,
    branchName: null,
    name: null,
    providerId: null,
    workspaceDisplayKind: null,
  };
}

describe("the workspace index derived from threads", () => {
  it("keys a workspace by host and path, as the full index does", () => {
    const light = workspaceIndexFromThreads([
      thread("thr_a", "env_a", "/work/tree"),
      thread("thr_b", "env_b", "/work/tree"),
      thread("thr_c", "env_c", "/work/other"),
    ]);
    const full = buildWorkspaceIndex({
      environments: {
        env_a: environment("env_a", "/work/tree"),
        env_b: environment("env_b", "/work/tree"),
        env_c: environment("env_c", "/work/other"),
      },
      projects: {},
    });

    assert.deepEqual(
      [...light.byKey.keys()].sort(),
      [...full.byKey.keys()].sort(),
    );

    const workspace = light.byKey.get(physicalWorkspaceKey(HOST, "/work/tree"));
    assert.ok(workspace);
    assert.deepEqual(
      workspace.records.map((record) => record.environmentId).sort(),
      ["env_a", "env_b"],
    );
  });

  it("answers the workspace a thread runs in, and none it does not", () => {
    const threads = [
      thread("thr_a", "env_a", "/work/tree"),
      thread("thr_none", null, null),
      thread("thr_no_host", "env_b", "/work/tree", null),
    ];
    const index = workspaceIndexFromThreads(threads);

    assert.equal(
      index.workspaceOfThread(threads[0] as PluginSidebarThread)?.key,
      physicalWorkspaceKey(HOST, "/work/tree"),
    );
    assert.equal(index.workspaceOfThread(threads[1] as PluginSidebarThread), null);
    assert.equal(index.workspaceOfThread(threads[2] as PluginSidebarThread), null);
  });
});

/**
 * The hook outside the sidebar derives from thread rows, so its answer is a
 * partial index. Typing it as the full one would let a header read maps nobody
 * built and draw neighbours from an empty repository.
 */
describe("the partial index the header reads", () => {
  it("is not assignable to the full workspace index", () => {
    const narrow = null as unknown as ReturnType<typeof useWorkspaceIndex>;
    // @ts-expect-error A partial index has no list, roots, byPath or childrenOf.
    const full: WorkspaceIndex = narrow;
    assert.equal(full, null);
  });
});
