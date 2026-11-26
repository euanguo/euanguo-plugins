import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import type { z } from "zod";
import { createAgentToolRegistry } from "../lib/agent/toolkit.ts";
import { registerReadTools, renderSidebarMap } from "../lib/agent/tools-read.ts";
import { registerWriteTools } from "../lib/agent/tools-write.ts";
import { registerDestructiveTools } from "../lib/agent/tools-destructive.ts";
import {
  SIDEBAR_INDEX_MIGRATION,
  SIDEBAR_INDEX_VERSION,
  createSidebarIndexCache,
  type SidebarIndex,
} from "../lib/agent/index-cache.ts";
import type { AgentToolDeps, HarborAgentActions } from "../lib/agent/actions.ts";

const CONTEXT = {
  threadId: "thr_1",
  projectId: "proj_main",
  signal: new AbortController().signal,
};

function index(): SidebarIndex {
  return {
    updatedAt: 1,
    projects: [
      { id: "proj_main", name: "sample-portal" },
      { id: "proj_other", name: "sample-cli" },
    ],
    groups: [{ id: "grp_work", name: "Work", icon: "Layer", position: 0 }],
    assignment: { proj_main: "grp_work" },
    environments: {
      env_wt: {
        id: "env_wt",
        projectId: "proj_main",
        hostId: "host_1",
        path: "/worktrees/app-wt",
        isGitRepo: true,
        isWorktree: true,
        branchName: "bb/thr_1",
        name: "the alias",
        providerId: null,
        workspaceDisplayKind: "managed-worktree",
      },
    },
    projectSources: {
      proj_main: { projectId: "proj_main", sourcePath: "/repos/app", sourceHostId: "host_1" },
    },
    repoFacts: {
      repoKeyByProject: { proj_main: "repo:remote:github.com/example/app" },
      sourceRepoKeyByProject: {
        proj_main: "repo:remote:github.com/example/app",
      },
      workspaceOwnership: {
        env_wt: {
          environmentId: "env_wt",
          claimedProjectId: "proj_main",
          ownerProjectId: "proj_main",
          workspaceKey: "ws:1",
          repoKey: "repo:remote:github.com/example/app",
          kind: "git-worktree",
          confidence: "local-repository",
          conflict: false,
        },
      },
      unseenWorkspaces: {},
      repos: [
        {
          key: "repo:remote:github.com/example/app",
          kind: "git-remote",
          name: "app",
          remoteUrl: "github.com/example/app",
          rootPath: "/repos/app",
          hostIds: ["host_1"],
          projectIds: ["proj_main"],
          workspaces: [
            {
              key: "ws:1",
              hostId: "host_1",
              path: "/worktrees/app-wt",
              rawPaths: ["/worktrees/app-wt"],
              environmentIds: ["env_wt"],
              projectIds: ["proj_main"],
              repoKey: "repo:remote:github.com/example/app",
              isMainWorktree: false,
              isLinkedWorktree: true,
              isNestedRepository: false,
              repositoryRoot: "/worktrees/app-wt",
            },
          ],
          unseenWorktrees: [
            {
              path: "/elsewhere/sandbox-repo",
              branch: "example-user/test",
              head: null,
              detached: false,
              prunable: false,
            },
          ],
          diagnostics: [],
        },
      ],
      diagnostics: [
        {
          code: "unseen-worktree",
          repoKey: "repo:remote:github.com/example/app",
          subjects: ["/elsewhere/sandbox-repo"],
          message: "app has 1 worktree that bb has no environment for.",
        },
      ],
      unavailableHostIds: [],
    },
  };
}

type Registration = {
  name: string;
  description: string;
  parameters: unknown;
  execute: (params: unknown, context: unknown) => Promise<string>;
};

function depsWith(overrides: Partial<HarborAgentActions> = {}): {
  deps: AgentToolDeps;
  calls: { name: string; args: unknown[] }[];
} {
  const calls: { name: string; args: unknown[] }[] = [];
  let current: SidebarIndex | null = index();

  const record = <T,>(name: string, answer: T) => async (...args: unknown[]): Promise<T> => {
    calls.push({ name, args });
    return answer;
  };

  const actions: HarborAgentActions = {
    deleteThreads:
      overrides.deleteThreads ??
      record("delete-threads", {
        preview: {
          token: "tok_1",
          expiresAt: 1000,
          included: [{ id: "thr_x", title: "Old thread", childCount: 1 }],
          skipped: [],
          rootCount: 1,
          childCount: 1,
          totalThreadCount: 2,
        },
        result: null,
      }),
    removeProject: overrides.removeProject ?? record("remove-project", true),
    deleteGroup: overrides.deleteGroup ?? record("delete-group", true),
    removeWorkspace:
      overrides.removeWorkspace ??
      record("remove-workspace", {
        ok: true,
        code: null,
        archivedThreads: true,
        environmentRemoved: true,
        directory: "removed",
        message: null,
      }),
    spawnThread: overrides.spawnThread ?? record("spawn", "thr_new"),
    renameProject: overrides.renameProject ?? record("rename-project", "New name"),
    settleThread: overrides.settleThread ?? record("settle", { ok: true, message: null }),
    snoozeThread: overrides.snoozeThread ?? record("snooze", { ok: true, message: null }),
    setThreadPinned: overrides.setThreadPinned ?? record("pin", true),
    renameThread: overrides.renameThread ?? record("rename-thread", true),
    assignProjectToGroup: overrides.assignProjectToGroup ?? record("assign", true),
    createGroup:
      overrides.createGroup ??
      (async (name: string) => {
        calls.push({ name: "create", args: [name] });
        return { id: "grp_new", name, icon: "Layer", position: 1 };
      }),
    renameGroup: overrides.renameGroup ?? record("rename", true),
    setWorkspaceAlias:
      overrides.setWorkspaceAlias ??
      (async (environmentId: string, alias: string | null) => {
        calls.push({ name: "alias", args: [environmentId, alias] });
        return alias;
      }),
  };

  return {
    calls,
    deps: {
      index: () => current,
      async refreshIndex() {
        if (current !== null) {
          current = { ...current, updatedAt: current.updatedAt + 1 };
        }
      },
      actions,
    },
  };
}

function registrationsFor(deps: AgentToolDeps): Registration[] {
  const registrations: Registration[] = [];
  const registry = createAgentToolRegistry({
    bb: {
      agents: {
        registerTool(registration: Registration) {
          registrations.push(registration);
        },
      },
    } as never,
    getTier: () => "full",
  });
  registerReadTools(registry, deps);
  registerWriteTools(registry, deps);
  registerDestructiveTools(registry, deps);
  return registrations;
}

const byName = (registrations: Registration[], name: string): Registration => {
  const found = registrations.find((registration) => registration.name === name);
  assert.ok(found, name);
  return found;
};

describe("the map an agent reads", () => {
  it("prints every id a write tool accepts and omits the obsolete edit footer", async () => {
    const { deps } = depsWith();
    const registrations = registrationsFor(deps);
    const text = await byName(registrations, "harbor_sidebar_map").execute({}, CONTEXT);

    assert.match(text, /proj_main/);
    assert.match(text, /grp_work/);
    assert.match(text, /env_wt/);
    assert.match(text, /"sample-portal"/);
    assert.match(text, /group "Work"/);
    assert.match(text, /branch "bb\/thr_1"/);
    assert.match(text, /alias "the alias"/);
    assert.match(text, /repository: app {2}git-remote {2}github\.com\/example\/app/);
    assert.match(text, /kind git-worktree/);
    assert.match(text, /no environment in bb/);
    assert.match(text, /\/elsewhere\/sandbox-repo/);
    assert.match(text, /\[unseen-worktree\]/);
    assert.doesNotMatch(text, /## What can be changed/);
  });

  it("says so rather than guessing when nothing has been read", async () => {
    const registrations = registrationsFor({ ...depsWith().deps, index: () => null });
    const text = await byName(registrations, "harbor_sidebar_map").execute({}, CONTEXT);
    assert.match(text, /has not read the sidebar structure yet/);
    assert.doesNotMatch(renderSidebarMap(index()), /harbor_project_set_group/);
  });
});

describe("consolidated sidebar organization tool", () => {
  it("files a project and refreshes what the next read sees", async () => {
    const { deps, calls } = depsWith();
    const organize = byName(registrationsFor(deps), "harbor_sidebar_organize");

    const answer = await organize.execute(
      { action: "project_set_group", project_id: "proj_main", group_id: "grp_work" },
      CONTEXT,
    );

    assert.deepEqual(calls, [{ name: "assign", args: ["proj_main", "grp_work"] }]);
    assert.match(answer, /Filed "sample-portal" under "Work"\./);
    assert.equal(deps.index()?.updatedAt, 2);
  });

  it("unfiles a project with a null group", async () => {
    const { deps, calls } = depsWith();
    const organize = byName(registrationsFor(deps), "harbor_sidebar_organize");

    const answer = await organize.execute(
      { action: "project_set_group", project_id: "proj_other", group_id: null },
      CONTEXT,
    );

    assert.deepEqual(calls, [{ name: "assign", args: ["proj_other", null] }]);
    assert.match(answer, /under Ungrouped/);
  });

  it("refuses project or group ids that are gone", async () => {
    const { deps, calls } = depsWith();
    const organize = byName(registrationsFor(deps), "harbor_sidebar_organize");

    const missingProject = await organize.execute(
      { action: "project_set_group", project_id: "proj_gone", group_id: "grp_work" },
      CONTEXT,
    );
    assert.match(missingProject, /No project with id proj_gone/);

    const missingGroup = await organize.execute(
      { action: "project_set_group", project_id: "proj_main", group_id: "grp_gone" },
      CONTEXT,
    );
    assert.match(missingGroup, /No group with id grp_gone/);
    assert.deepEqual(calls, []);
  });

  it("creates and renames groups and handles refusal cleanly", async () => {
    const { deps, calls } = depsWith();
    const organize = byName(registrationsFor(deps), "harbor_sidebar_organize");

    const created = await organize.execute(
      { action: "group_create", name: "Work" },
      CONTEXT,
    );
    assert.match(created, /Created group grp_new "Work"\./);

    const renamed = await organize.execute(
      { action: "group_rename", group_id: "grp_work", name: "Day job" },
      CONTEXT,
    );
    assert.match(renamed, /Renamed "Work" to "Day job"\./);
    assert.deepEqual(calls[1], { name: "rename", args: ["grp_work", "Day job"] });

    const refused = await byName(
      registrationsFor(depsWith({ createGroup: async () => null }).deps),
      "harbor_sidebar_organize",
    ).execute({ action: "group_create", name: "Work" }, CONTEXT);
    assert.match(refused, /Could not create a group named "Work"/);
  });

  it("sets and clears a workspace alias and rejects unknown environment ids", async () => {
    const { deps, calls } = depsWith();
    const organize = byName(registrationsFor(deps), "harbor_sidebar_organize");

    assert.match(
      await organize.execute(
        { action: "workspace_set_alias", environment_id: "env_wt", alias: "release" },
        CONTEXT,
      ),
      /Set the alias for \/worktrees\/app-wt to "release"\./,
    );
    assert.match(
      await organize.execute(
        { action: "workspace_set_alias", environment_id: "env_wt", alias: null },
        CONTEXT,
      ),
      /Cleared the alias for \/worktrees\/app-wt/,
    );
    assert.match(
      await organize.execute(
        { action: "workspace_set_alias", environment_id: "env_gone", alias: "x" },
        CONTEXT,
      ),
      /No environment with id env_gone/,
    );
    assert.deepEqual(calls, [
      { name: "alias", args: ["env_wt", "release"] },
      { name: "alias", args: ["env_wt", null] },
    ]);
  });
});

describe("destructive two-step confirmation gates", () => {
  it("requires acknowledged true for every harbor_admin_delete action", async () => {
    const { deps, calls } = depsWith();
    const del = byName(registrationsFor(deps), "harbor_admin_delete");

    const previewThread = await del.execute(
      { action: "thread_delete", thread_ids: ["thr_x"], acknowledged: false },
      CONTEXT,
    );
    assert.match(previewThread, /Preview token: tok_1/);
    assert.match(previewThread, /acknowledged true/);
    assert.equal(calls.length, 1);
    assert.equal(
      (calls[0]?.args[0] as { acknowledged: boolean } | undefined)?.acknowledged,
      false,
    );

    const previewProject = await del.execute(
      {
        action: "project_delete",
        project_id: "proj_main",
        expected_name: "sample-portal",
        acknowledged: false,
      },
      CONTEXT,
    );
    assert.match(previewProject, /acknowledged true/);

    const previewGroup = await del.execute(
      { action: "group_delete", group_id: "grp_work", acknowledged: false },
      CONTEXT,
    );
    assert.match(previewGroup, /acknowledged true/);

    const previewWorktree = await del.execute(
      { action: "worktree_remove", environment_id: "env_wt", acknowledged: false },
      CONTEXT,
    );
    assert.match(previewWorktree, /acknowledged true/);
    // None of project/group/worktree mutations ran on preview.
    assert.equal(calls.length, 1);

    await del.execute(
      {
        action: "project_delete",
        project_id: "proj_main",
        expected_name: "sample-portal",
        acknowledged: true,
      },
      CONTEXT,
    );
    await del.execute(
      { action: "group_delete", group_id: "grp_work", acknowledged: true },
      CONTEXT,
    );
    await del.execute(
      {
        action: "worktree_remove",
        environment_id: "env_wt",
        delete_directory: true,
        acknowledged: true,
      },
      CONTEXT,
    );
    assert.deepEqual(
      calls.slice(1).map((call) => call.name),
      ["remove-project", "delete-group", "remove-workspace"],
    );
  });

  it("keeps a worktree directory unless the schema asks for deletion", () => {
    const { deps } = depsWith();
    const shape = (
      byName(registrationsFor(deps), "harbor_admin_delete")
        .parameters as z.ZodObject<z.ZodRawShape>
    ).shape;
    const deleteDirectory = shape.delete_directory as z.ZodDefault<z.ZodBoolean>;

    assert.equal(deleteDirectory.parse(undefined), false);
    assert.match(
      deleteDirectory.description ?? "",
      /directory is kept unless delete_directory is true/,
    );
  });
});

describe("holding the index where a synchronous callback can read it", () => {
  function cache() {
    const db = new Database(":memory:");
    db.exec(SIDEBAR_INDEX_MIGRATION);
    return { db, cache: createSidebarIndexCache(db) };
  }

  it("answers from memory once written and survives a reload", () => {
    const { db, cache: store } = cache();
    assert.equal(store.read(), null);
    store.write(index());
    assert.equal(store.read()?.projects.length, 2);

    const fresh = createSidebarIndexCache(db);
    assert.equal(fresh.read()?.projects[0]?.id, "proj_main");
    assert.equal(fresh.read()?.repoFacts.repos[0]?.name, "app");
  });

  it("discards rows with a mismatched version, bad json, or missing fields", () => {
    const { db, cache: store } = cache();
    store.write(index());
    db.prepare(`UPDATE sidebar_index SET version = ? WHERE id = 0`).run(
      SIDEBAR_INDEX_VERSION + 1,
    );
    assert.equal(createSidebarIndexCache(db).read(), null);

    store.write(index());
    db.prepare(`UPDATE sidebar_index SET payload = ? WHERE id = 0`).run("{not json");
    assert.equal(createSidebarIndexCache(db).read(), null);

    store.write(index());
    db.prepare(`UPDATE sidebar_index SET payload = ? WHERE id = 0`).run(
      JSON.stringify({ projects: [], groups: [] }),
    );
    assert.equal(createSidebarIndexCache(db).read(), null);
  });
});
