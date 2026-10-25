import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { z } from "zod";
import { createAgentToolRegistry, type AgentToolFlags } from "../lib/agent/toolkit.ts";
import { registerReadTools, renderSidebarMap } from "../lib/agent/tools-read.ts";
import { registerWriteTools } from "../lib/agent/tools-write.ts";
import {
  SIDEBAR_INDEX_MIGRATION,
  SIDEBAR_INDEX_VERSION,
  createSidebarIndexCache,
  type SidebarIndex,
} from "../lib/agent/index-cache.ts";
import type { AgentToolDeps, NestAgentActions } from "../lib/agent/actions.ts";

const ALL_ON: AgentToolFlags = {
  enabled: true,
  read: true,
  grouping: true,
  groups: true,
  aliases: true,
};

const CONTEXT = { threadId: "thr_1", projectId: "proj_main", signal: new AbortController().signal };

function index(): SidebarIndex {
  return {
    updatedAt: 1,
    projects: [
      { id: "proj_main", name: "chaoshangtong" },
      { id: "proj_other", name: "bb-plugins" },
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
      repoKeyByProject: { proj_main: "repo:remote:github.com/x/app" },
      sourceRepoKeyByProject: {
        proj_main: "repo:remote:github.com/x/app",
      },
      workspaceOwnership: {
        env_wt: {
          environmentId: "env_wt",
          claimedProjectId: "proj_main",
          ownerProjectId: "proj_main",
          workspaceKey: "ws:1",
          repoKey: "repo:remote:github.com/x/app",
          kind: "git-worktree",
          confidence: "local-repository",
          conflict: false,
        },
      },
      unseenWorkspaces: {},
      repos: [
        {
          key: "repo:remote:github.com/x/app",
          kind: "git-remote",
          name: "app",
          remoteUrl: "github.com/x/app",
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
              repoKey: "repo:remote:github.com/x/app",
              isMainWorktree: false,
              isLinkedWorktree: true,
              isNestedRepository: false,
              repositoryRoot: "/worktrees/app-wt",
            },
          ],
          unseenWorktrees: [
            { path: "/elsewhere/despina", branch: "verger-guo/test", head: null, detached: false, prunable: false },
          ],
          diagnostics: [],
        },
      ],
      diagnostics: [
        {
          code: "unseen-worktree",
          repoKey: "repo:remote:github.com/x/app",
          subjects: ["/elsewhere/despina"],
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

function depsWith(overrides: Partial<NestAgentActions> = {}): {
  deps: AgentToolDeps;
  calls: { name: string; args: unknown[] }[];
} {
  const calls: { name: string; args: unknown[] }[] = [];
  let current: SidebarIndex | null = index();

  const record = <T,>(name: string, answer: T) => async (...args: unknown[]): Promise<T> => {
    calls.push({ name, args });
    return answer;
  };

  const actions: NestAgentActions = {
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
        current = { ...current!, updatedAt: current!.updatedAt + 1 };
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
    flags: ALL_ON,
  });
  registerReadTools(registry, deps);
  registerWriteTools(registry, deps);
  return registrations;
}

const byName = (registrations: Registration[], name: string): Registration => {
  const found = registrations.find((registration) => registration.name === name);
  assert.ok(found, name);
  return found;
};

describe("the map an agent reads", () => {
  it("prints every id a write tool accepts", async () => {
    const { deps } = depsWith();
    const registrations = registrationsFor(deps);
    const text = await byName(registrations, "nest_sidebar_map").execute({}, CONTEXT);

    assert.match(text, /proj_main/);
    assert.match(text, /grp_work/);
    assert.match(text, /env_wt/);
    assert.match(text, /"chaoshangtong"/);
    assert.match(text, /group "Work"/);
    assert.match(text, /branch "bb\/thr_1"/);
    assert.match(text, /alias "the alias"/);
    assert.match(text, /repository: app {2}git-remote {2}github\.com\/x\/app/);
    // The classified kind, not bb's provisioning kind: `unmanaged` is true of
    // every checkout, so printing that raw called a plain directory a worktree.
    assert.match(text, /kind git-worktree/);
    assert.match(text, /no environment in bb/);
    assert.match(text, /\/elsewhere\/despina/);
    assert.match(text, /\[unseen-worktree\]/);
  });

  it("says so rather than guessing when nothing has been read", async () => {
    const registrations = registrationsFor({ ...depsWith().deps, index: () => null });
    const text = await byName(registrations, "nest_sidebar_map").execute({}, CONTEXT);
    assert.match(text, /has not read the sidebar structure yet/);
  });

  it("states that ordering cannot be changed here", () => {
    const text = renderSidebarMap(index());
    assert.match(text, /Ordering within a group is the user's own arrangement and cannot be changed here\./);
  });
});

describe("the writes an agent may make", () => {
  it("files a project and refreshes what the next read sees", async () => {
    const { deps, calls } = depsWith();
    const registrations = registrationsFor(deps);

    const answer = await byName(registrations, "nest_project_set_group").execute(
      { project_id: "proj_main", group_id: "grp_work" },
      CONTEXT,
    );

    assert.deepEqual(calls, [{ name: "assign", args: ["proj_main", "grp_work"] }]);
    assert.match(answer, /Filed "chaoshangtong" under "Work"\./);
    assert.equal(deps.index()?.updatedAt, 2);
  });

  it("unfiles a project with a null group", async () => {
    const { deps, calls } = depsWith();
    const registrations = registrationsFor(deps);

    const answer = await byName(registrations, "nest_project_set_group").execute(
      { project_id: "proj_other", group_id: null },
      CONTEXT,
    );

    assert.deepEqual(calls, [{ name: "assign", args: ["proj_other", null] }]);
    assert.match(answer, /under Ungrouped/);
  });

  it("refuses an id that has gone instead of writing nothing quietly", async () => {
    const { deps, calls } = depsWith();
    const registrations = registrationsFor(deps);

    const answer = await byName(registrations, "nest_project_set_group").execute(
      { project_id: "proj_gone", group_id: "grp_work" },
      CONTEXT,
    );

    assert.match(answer, /No project with id proj_gone/);
    assert.deepEqual(calls, []);
  });

  it("refuses a group id that has gone", async () => {
    const { deps, calls } = depsWith();
    const registrations = registrationsFor(deps);

    const answer = await byName(registrations, "nest_project_set_group").execute(
      { project_id: "proj_main", group_id: "grp_gone" },
      CONTEXT,
    );

    assert.match(answer, /No group with id grp_gone/);
    assert.deepEqual(calls, []);
  });

  it("creates a group and hands back its id", async () => {
    const { deps } = depsWith();
    const registrations = registrationsFor(deps);

    const answer = await byName(registrations, "nest_group_create").execute(
      { name: "Work" },
      CONTEXT,
    );
    assert.match(answer, /Created group grp_new "Work"\./);
  });

  it("says what a refused create was refused for", async () => {
    const { deps } = depsWith({ createGroup: async () => null });
    const registrations = registrationsFor(deps);

    const answer = await byName(registrations, "nest_group_create").execute(
      { name: "Work" },
      CONTEXT,
    );
    assert.match(answer, /Could not create a group named "Work"/);
  });

  it("renames a group and quotes both names", async () => {
    const { deps, calls } = depsWith();
    const registrations = registrationsFor(deps);

    const answer = await byName(registrations, "nest_group_rename").execute(
      { group_id: "grp_work", name: "Day job" },
      CONTEXT,
    );

    assert.deepEqual(calls, [{ name: "rename", args: ["grp_work", "Day job"] }]);
    assert.match(answer, /Renamed "Work" to "Day job"\./);
  });

  it("sets and clears a workspace alias by environment id", async () => {
    const { deps, calls } = depsWith();
    const registrations = registrationsFor(deps);
    const tool = byName(registrations, "nest_workspace_set_alias");

    assert.match(
      await tool.execute({ environment_id: "env_wt", alias: "release" }, CONTEXT),
      /Set the alias for \/worktrees\/app-wt to "release"\./,
    );
    assert.match(
      await tool.execute({ environment_id: "env_wt", alias: null }, CONTEXT),
      /Cleared the alias for \/worktrees\/app-wt/,
    );
    assert.deepEqual(calls, [
      { name: "alias", args: ["env_wt", "release"] },
      { name: "alias", args: ["env_wt", null] },
    ]);
  });

  it("refuses an environment that is not in the map", async () => {
    const { deps, calls } = depsWith();
    const registrations = registrationsFor(deps);

    const answer = await byName(registrations, "nest_workspace_set_alias").execute(
      { environment_id: "env_gone", alias: "x" },
      CONTEXT,
    );

    assert.match(answer, /No environment with id env_gone/);
    assert.deepEqual(calls, []);
  });
});

describe("holding the index where a synchronous callback can read it", () => {
  function cache() {
    const db = new Database(":memory:");
    db.exec(SIDEBAR_INDEX_MIGRATION);
    return { db, cache: createSidebarIndexCache(db) };
  }

  it("answers from memory once written", () => {
    const { cache: store } = cache();
    assert.equal(store.read(), null);
    store.write(index());
    assert.equal(store.read()?.projects.length, 2);
  });

  it("survives a process that has only the row", () => {
    const { db } = cache();
    // What a reload looks like: the row is there, no memory is.
    createSidebarIndexCache(db).write(index());

    const fresh = createSidebarIndexCache(db);
    assert.equal(fresh.read()?.projects[0].id, "proj_main");
    assert.equal(fresh.read()?.repoFacts.repos[0].name, "app");
  });

  it("discards a row written by a build that stored a different shape", () => {
    const { db, cache: store } = cache();
    store.write(index());
    db.prepare(`UPDATE sidebar_index SET version = ? WHERE id = 0`).run(
      SIDEBAR_INDEX_VERSION + 1,
    );

    assert.equal(createSidebarIndexCache(db).read(), null);
  });

  it("discards a row that will not parse", () => {
    const { db, cache: store } = cache();
    store.write(index());
    db.prepare(`UPDATE sidebar_index SET payload = ? WHERE id = 0`).run("{not json");

    assert.equal(createSidebarIndexCache(db).read(), null);
  });

  it("discards a row that is missing what the callbacks read", () => {
    const { db, cache: store } = cache();
    store.write(index());
    db.prepare(`UPDATE sidebar_index SET payload = ? WHERE id = 0`).run(
      JSON.stringify({ projects: [], groups: [] }),
    );

    assert.equal(createSidebarIndexCache(db).read(), null);
  });

  it("keeps one version, in the column, and checks it there", () => {
    const { db, cache: store } = cache();
    store.write(index());
    const row = db.prepare(`SELECT payload FROM sidebar_index WHERE id = 0`).get() as {
      payload: string;
    };
    // A copy inside the payload would be a second answer to one question, and
    // the one that got read would be whichever the reader happened to look at.
    assert.equal(Object.hasOwn(JSON.parse(row.payload), "version"), false);
  });
});

describe("what the plan promises about the tool set", () => {
  it("offers exactly the five documented tools", () => {
    const { deps } = depsWith();
    assert.deepEqual(
      registrationsFor(deps).map((registration) => registration.name).sort(),
      [
        "nest_group_create",
        "nest_group_rename",
        "nest_project_set_group",
        "nest_sidebar_map",
        "nest_workspace_set_alias",
      ],
    );
  });

  it("reaches nothing destructive and no ordering write", async () => {
    const { deps } = depsWith();
    const names = registrationsFor(deps).map((registration) => registration.name).join(" ");
    for (const forbidden of ["remove", "delete", "archive", "reorder", "order", "create_project", "worktree"]) {
      assert.doesNotMatch(names, new RegExp(forbidden));
    }
  });

  it("describes every parameter it accepts, in the words a model reads", () => {
    const { deps } = depsWith();
    for (const registration of registrationsFor(deps)) {
      assert.ok(registration.description.length > 40, registration.name);
      const shape = (registration.parameters as z.ZodObject<z.ZodRawShape>).shape;
      // Underscores and spaces are the same words to a reader, so `group_id`
      // and "group id" both count as naming the parameter.
      const described = registration.description.replaceAll("_", " ");
      for (const field of Object.keys(shape)) {
        assert.ok(
          described.includes(field.replaceAll("_", " ")),
          `${registration.name} describes ${field}`,
        );
      }
    }
  });
});
