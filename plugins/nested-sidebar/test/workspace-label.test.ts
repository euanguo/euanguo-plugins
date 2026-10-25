import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import {
  normalizeWorkspacePath,
  disambiguateWorkspaceLabels,
  shouldShowWorkspaces,
  workspaceRefOf,
  workspaceRowLabel,
  workspaceSortOrder,
  type WorkspaceEnvironmentDescriptor,
  type WorkspaceLabelMode,
  type WorkspaceProjectDescriptor,
  type WorkspaceRef,
} from "../lib/workspace.ts";

type FixtureEnvironment = Omit<
  NonNullable<PluginSidebarThread["environment"]>,
  "path" | "isWorktree"
> & {
  readonly path?: string | null;
  readonly isWorktree?: boolean | null;
};

function thread(environment: FixtureEnvironment | null): PluginSidebarThread {
  return {
    id: "thr_fixture",
    projectId: "proj_fixture",
    title: "Fixture",
    titleFallback: null,
    displayTitle: "Fixture",
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
    activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    pinnedAt: null,
    pinSortKey: null,
    isArchived: false,
    archivedAt: null,
    href: "/projects/proj_fixture/threads/thr_fixture",
    isHidden: false,
    environment:
      environment === null
        ? null
        : {
            path: null,
            isWorktree: null,
            ...environment,
          },
    host: { id: "host_fixture", name: "Fixture host" },
    createdAt: 0,
    updatedAt: 0,
    lastReadAt: null,
    latestAttentionAt: 0,
  };
}

function environment(id: string, path: string, extra: Partial<WorkspaceEnvironmentDescriptor> = {}): WorkspaceEnvironmentDescriptor {
  return {
    id,
    projectId: "proj_fixture",
    hostId: "host_fixture",
    path,
    isGitRepo: false,
    isWorktree: false,
    branchName: null,
    name: null,
    providerId: "project-checkout",
    workspaceDisplayKind: "other",
    ...extra,
  };
}

const project: WorkspaceProjectDescriptor = {
  projectId: "proj_fixture",
  sourcePath: "/repo/chat_history",
  sourceHostId: "host_fixture",
};

function resolve(env: WorkspaceEnvironmentDescriptor): WorkspaceRef {
  return workspaceRefOf(
    thread({
      id: env.id,
      name: env.name,
      branchName: env.branchName,
      path: env.path,
      isWorktree: env.isWorktree,
      providerId: env.providerId,
      workspaceDisplayKind: env.workspaceDisplayKind,
    }),
    new Map([[env.id, env]]),
    new Map([[project.projectId, project]]),
  );
}

describe("workspace identity", () => {
  it("normalizes separators and trailing slashes", () => {
    assert.equal(normalizeWorkspacePath("/repo/chat_history///"), "/repo/chat_history");
    assert.equal(normalizeWorkspacePath("  C:\\\\repo\\\\app\\\\  "), "C:/repo/app");
  });

  it("recognizes the configured source as the project checkout", () => {
    const ref = resolve(environment("env_checkout", "/repo/chat_history", { branchName: "main" }));
    assert.equal(ref.kind, "project-checkout");
    assert.equal(ref.label, "main");
  });

  it("recognizes an unrelated git directory as external checkout", () => {
    const ref = resolve(environment("env_external", "/repo/important_project/bb", { isGitRepo: true, branchName: "main", providerId: null }));
    assert.equal(ref.kind, "external-checkout");
    assert.equal(ref.label, "bb");
    assert.match(ref.diagnostic ?? "", /outside/);
  });

  it("keeps two different paths distinct even when branch names match", () => {
    const first = resolve(environment("env_one", "/repo/one", { isGitRepo: true, branchName: "main", providerId: null }));
    const second = resolve(environment("env_two", "/repo/two", { isGitRepo: true, branchName: "main", providerId: null }));
    assert.notEqual(first.key, second.key);
    assert.equal(shouldShowWorkspaces([first, second], 0), true);
  });

  // One workspace under a project with threads is the project's own checkout
  // being named twice, so it stays flat. With no threads the row is the only
  // thing under the project — and a worktree that was just created is exactly
  // what the user came to look at.
  it("draws one workspace only while the project has no threads", () => {
    const checkout = resolve(environment("env_checkout", "/repo/chat_history", { branchName: "main" }));
    assert.equal(shouldShowWorkspaces([checkout], 3), false);
    assert.equal(shouldShowWorkspaces([checkout], 0), true);
    assert.equal(shouldShowWorkspaces([], 0), false);
  });

  it("merges duplicate environment records for one physical path", () => {
    const first = resolve(environment("env_one", "/repo/chat_history", { branchName: "main" }));
    const second = resolve(environment("env_two", "/repo/chat_history/", { branchName: "main" }));
    assert.equal(first.key, second.key);
  });

  it("keeps identity stable if classification metadata changes", () => {
    const checkout = resolve(environment("env_one", "/repo/same", { isGitRepo: true }));
    const worktree = resolve(environment("env_two", "/repo/same", { isWorktree: true, workspaceDisplayKind: "unmanaged-worktree" }));
    assert.equal(checkout.key, worktree.key);
  });

  it("requires the source host to match", () => {
    const foreign = workspaceRefOf(
      thread({ id: "env_foreign", name: null, branchName: null, providerId: null, workspaceDisplayKind: "other" }),
      new Map([["env_foreign", environment("env_foreign", "/repo/chat_history", { hostId: "host_other" })]]),
      new Map([[project.projectId, project]]),
    );
    assert.notEqual(foreign.kind, "project-checkout");
  });

  it("disambiguates equal labels from different physical paths", () => {
    const first = resolve(environment("env_one", "/repo/one/bb", { isGitRepo: true, branchName: "main", providerId: null }));
    const second = resolve(environment("env_two", "/repo/two/bb", { isGitRepo: true, branchName: "main", providerId: null }));
    const labels = disambiguateWorkspaceLabels([first, second]).map((ref) => ref.label);
    assert.deepEqual(labels, ["bb · one/bb", "bb · two/bb"]);
  });

  it("uses an explicit unresolved state when environment metadata is missing", () => {
    const ref = workspaceRefOf(thread({ id: "env_missing", name: null, branchName: "main", providerId: null, workspaceDisplayKind: "other" }));
    assert.equal(ref.kind, "unresolved");
    assert.match(ref.label, /Unresolved/);
  });

  it("keeps personal and absent environments out of workspace rows", () => {
    assert.equal(workspaceRefOf(thread(null)).kind, "personal");
    assert.equal(workspaceRefOf(thread({ id: "scratch", name: null, branchName: null, providerId: "personal-workspace", workspaceDisplayKind: "other" })).kind, "personal");
  });
});

describe("workspace labels and order", () => {
  const ref = (alias: string | null, branch: string | null): WorkspaceRef => ({
    kind: "git-worktree", key: "env_x", label: alias ?? branch ?? "Git worktree", alias, branch,
    environmentId: "env_x", environmentIds: ["env_x"], path: "/repo/worktree", hostId: "host_fixture", diagnostic: null,
  });
  const modes: readonly WorkspaceLabelMode[] = ["alias-over-branch", "alias-and-branch", "alias-only", "branch-only"];

  it("retains the existing alias and branch layout", () => {
    assert.deepEqual(workspaceRowLabel(ref("登录重构", "feature/login"), "alias-over-branch"), {
      label: "登录重构", labelIsBranch: false, detail: "feature/login", stacked: true,
    });
  });

  it("never renders an absent half or duplicates equal alias and branch", () => {
    for (const mode of modes) {
      assert.equal(workspaceRowLabel(ref("main", "main"), mode).detail, null);
      assert.equal(workspaceRowLabel(ref(null, "feature/login"), mode).label, "feature/login");
    }
  });

  it("orders project checkout before worktrees and diagnostics", () => {
    const kinds = ["unresolved", "external-checkout", "nested-checkout", "git-worktree", "project-checkout"] as const;
    assert.deepEqual([...kinds].sort((a, b) => workspaceSortOrder(a) - workspaceSortOrder(b)), ["project-checkout", "git-worktree", "nested-checkout", "external-checkout", "unresolved"]);
  });
});
