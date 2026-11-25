import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { z } from "zod";
import { createAgentToolRegistry } from "../lib/agent/toolkit.ts";
import { EMPTY_BRIEF } from "../lib/domain/feature-meta.ts";
import { registerReadTools } from "../lib/agent/tools-read.ts";
import { registerWriteTools } from "../lib/agent/tools-write.ts";
import { registerFeatureTools } from "../lib/agent/tools-features.ts";
import { registerThreadTools } from "../lib/agent/tools-threads.ts";
import { registerDestructiveTools } from "../lib/agent/tools-destructive.ts";
import { registerSpawnTool } from "../lib/agent/tools-spawn.ts";
import {
  AGENT_TOOL_SETTING_DESCRIPTORS,
  DEFAULT_AGENT_TOOL_FLAGS,
} from "../lib/agent/settings.ts";
import type { AgentToolDeps } from "../lib/agent/actions.ts";

const root = path.join(import.meta.dirname, "..");
const read = (file: string) => readFile(path.join(root, file), "utf8");

const [server, toolkit, readTools, writeTools, settings, wire, readme, usage] = await Promise.all([
  read("server.ts"),
  read("lib/agent/toolkit.ts"),
  read("lib/agent/tools-read.ts"),
  read("lib/agent/tools-write.ts"),
  read("lib/agent/settings.ts"),
  read("lib/agent/wire.ts"),
  read("README.md"),
  read("docs/USAGE.md"),
]);
const sidebarIndex = await read("server/sidebar-index-service.ts");

/** The tools this build promises, and the feature each belongs to. */
const TOOLS = [
  { name: "harbor_sidebar_map", feature: "read" },
  { name: "harbor_feature_context", feature: "features" },
  { name: "harbor_feature_brief", feature: "features" },
  { name: "harbor_feature_decide", feature: "features" },
  { name: "harbor_feature_link", feature: "features" },
  { name: "harbor_feature_add_repos", feature: "features" },
  { name: "harbor_feature_list", feature: "features" },
  { name: "harbor_feature_create", feature: "features" },
  { name: "harbor_feature_rename", feature: "features" },
  { name: "harbor_feature_reopen", feature: "features" },
  { name: "harbor_feature_adopt", feature: "features" },
  { name: "harbor_project_rename", feature: "rename" },
  { name: "harbor_thread_settle", feature: "threads" },
  { name: "harbor_thread_snooze", feature: "threads" },
  { name: "harbor_thread_pin", feature: "threads" },
  { name: "harbor_thread_rename", feature: "threads" },
  { name: "harbor_thread_spawn", feature: "spawn" },
  { name: "harbor_thread_delete", feature: "destructive" },
  { name: "harbor_project_delete", feature: "destructive" },
  { name: "harbor_group_delete", feature: "destructive" },
  { name: "harbor_worktree_remove", feature: "destructive" },
  { name: "harbor_feature_delete", feature: "destructive" },
  { name: "harbor_feature_remove_repo", feature: "features" },
  { name: "harbor_project_set_group", feature: "grouping" },
  { name: "harbor_group_create", feature: "groups" },
  { name: "harbor_group_rename", feature: "groups" },
  { name: "harbor_workspace_set_alias", feature: "aliases" },
] as const;

/**
 * The tools as registered, from both ends.
 *
 * `toHost` is what the host is handed, which carries no feature — a feature is
 * this plugin's own vocabulary and not part of the host's API. `registry` is the
 * plugin's own view, which is where the feature lives.
 */
function registeredTools() {
  const toHost: { name: string; parameters: unknown }[] = [];
  const registry = createAgentToolRegistry({
    bb: {
      agents: {
        registerTool(registration: { name: string; parameters: unknown }) {
          toHost.push(registration);
        },
      },
    } as never,
    flags: DEFAULT_AGENT_TOOL_FLAGS,
  });
  const deps: AgentToolDeps = {
    index: () => null,
    refreshIndex: async () => undefined,
    actions: {
      renameProject: async () => "New name",
      settleThread: async () => ({ ok: true, message: null }),
      snoozeThread: async () => ({ ok: true, message: null }),
      setThreadPinned: async () => true,
      renameThread: async () => true,
      deleteThreads: async () => ({
        preview: { token: null, expiresAt: null, included: [], skipped: [], rootCount: 0, childCount: 0, totalThreadCount: 0 },
        result: null,
      }),
      removeProject: async () => true,
      deleteGroup: async () => true,
      removeWorkspace: async () => ({
        ok: true,
        code: null,
        archivedThreads: true,
        environmentRemoved: true,
        directory: "removed" as const,
        message: null,
      }),
      spawnThread: async () => "thr_new",
      assignProjectToGroup: async () => true,
      createGroup: async () => null,
      renameGroup: async () => true,
      setWorkspaceAlias: async () => null,
    },
  };
  registerReadTools(registry, deps);
  registerWriteTools(registry, deps);
  registerThreadTools(registry, deps);
  registerDestructiveTools(registry, deps);
  registerFeatureTools(registry, {
    locate: () => null,
    features: () => [],
    membersOf: () => [],
    threadPath: async () => null,
    projects: async () => [],
    refresh: async () => undefined,
    create: async () => {
      throw new Error("not in this test");
    },
    addRepositories: async () => [],
    rename: async () => true,
    reopen: async () => undefined,
    adopt: async () => true,
    deleteFeature: async () => ({ removedWorktrees: 0, leftovers: [], removedFolder: true }),
    removeRepository: async () => ({ removed: true }),
    meta: () => ({ brief: EMPTY_BRIEF, refs: [], decisions: [] }),
    addDecision: async () => {
      throw new Error("not in this test");
    },
    addRef: async () => {
      throw new Error("not in this test");
    },
  });
  registerSpawnTool(registry, {
    locate: () => null,
    threadPath: async () => null,
    environment: async () => null,
    homeProject: async (_containerPath: string) => null,
    resolveProject: async () => null,
    spawn: async () => null,
  });
  return { toHost, registry };
}

describe("Harbor's agent surface, as the plan promises it", () => {
  it("offers exactly the documented tools, each under its feature", () => {
    const { toHost, registry } = registeredTools();
    assert.deepEqual(
      registry.tools.map((tool) => ({ name: tool.name, feature: tool.feature })).sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
      [...TOOLS].sort((a, b) => a.name.localeCompare(b.name)),
    );
    // Every tool the registry knows reached the host, and nothing else did.
    assert.deepEqual(
      toHost.map((tool) => tool.name).sort(),
      TOOLS.map((tool) => tool.name).sort(),
    );
  });

  it("turns every tool off with a switch, and every switch off a tool", () => {
    const { registry } = registeredTools();
    const features = new Set(registry.tools.map((tool) => tool.feature));
    // The flag names are the feature names, so a tool whose feature has no
    // setting is a tool no user can turn off.
    for (const feature of features) {
      assert.ok(feature in DEFAULT_AGENT_TOOL_FLAGS, `${feature} has a flag`);
    }
    assert.equal(features.size, 9);
    // And the other way: no switch that gates nothing.
    const gateable = new Set(Object.keys(DEFAULT_AGENT_TOOL_FLAGS).filter((flag) => flag !== "enabled"));
    assert.deepEqual([...features].sort(), [...gateable].sort());
  });

  it("gates every destructive tool, and reaches no ordering write", () => {
    const { toHost } = registeredTools();
    const destructive = toHost.filter((tool) => /delete|remove/.test(tool.name));
    assert.ok(destructive.length >= 5, "the destructive tools are registered");
    for (const tool of destructive) {
      const shape = (tool.parameters as z.ZodObject<z.ZodRawShape>).shape;
      assert.ok(
        "acknowledged" in shape || "force" in shape,
        `${tool.name} takes an acknowledgement`,
      );
    }
    // The manual arrangement is the one thing two clients can fight over, and
    // the reason no tool needs a revision. A tool reaching the order store is
    // how that stops being true.
    const names = toHost.map((tool) => tool.name).join(" ");
    assert.doesNotMatch(names, /reorder|create_project/);
    for (const source of [readTools, writeTools]) {
      assert.doesNotMatch(source, /setProjectOrder|setFamilyOrder|setWorkspaceOrder|reorderGroups/);
      assert.doesNotMatch(source, /\borders\b/);
    }
  });

  it("registers the three agent callbacks, each exactly once", () => {
    assert.equal(wire.split("bb.agents.configure(").length - 1, 1);
    assert.equal(wire.split("bb.agents.contributeInstructions(").length - 1, 1);
    assert.match(wire, /tools: registry\s*\.enabledToolNames\(\)/);
    // A missing `skills` field is a malformed selection, which fails closed for
    // the whole plugin, so every branch answers one — empty outside a feature.
    assert.match(wire, /skills: located === null \? \[\] : \[FEATURE_SKILL\]/);
  });

  it("gates at call time as well as at selection time", () => {
    // `registerTool` has no disposer, so a session that was already running when
    // a switch flipped keeps its old tool list. Without this the switch would
    // only take effect after a restart.
    assert.match(toolkit, /if \(!isEnabled\(tool\.feature\)\)/);
    assert.match(toolkit, /isEnabled/);
  });

  it("declares the agent settings in one place, beside the tools", () => {
    assert.match(server, /\.\.\.AGENT_TOOL_SETTING_DESCRIPTORS/);
    assert.equal(settings.split("AGENT_TOOL_SETTING_DESCRIPTORS = {").length - 1, 1);
    for (const key of Object.keys(AGENT_TOOL_SETTING_DESCRIPTORS)) {
      assert.match(server, new RegExp(`\\.\\.\\.AGENT_TOOL_SETTING_DESCRIPTORS|${key}`));
    }
  });

  it("keeps the switches readable from the settings page", () => {
    // The README names them the way the settings page does, in the words a user
    // reads, rather than by their internal keys.
    for (const descriptor of Object.values(AGENT_TOOL_SETTING_DESCRIPTORS)) {
      assert.ok(readme.includes(descriptor.label), descriptor.label);
    }
  });

  it("says in the README what the defaults are and why reading is one of them", () => {
    assert.match(readme, /Reading is on for the reason above/);
    // `bb harbor status` is the diagnostic command, documented with the rest of
    // the usage in docs/USAGE.md after the README split.
    assert.match(usage, /bb harbor status/);
  });

  it("appends the index migration rather than inserting it", () => {
    const migrations = server.slice(
      server.indexOf("const migrations"),
      server.indexOf("];", server.indexOf("const migrations")) + 2,
    );
    // The feature journal is appended as a group, so what this pins is that the
    // group is last: a statement added above it would rewrite the history of a
    // database that already ran it.
    assert.match(migrations, /SIDEBAR_INDEX_MIGRATION,\n\s*\.\.\.FEATURE_REPOSITORY_MIGRATIONS,\n\];/);
  });

  it("does not write an index built on a probe that answered nothing", () => {
    // Measured, not theoretical: priming at plugin load wrote ten repositories
    // and twelve findings where the same read a moment later said nine and two,
    // because the host client was not connected yet.
    assert.match(
      sidebarIndex,
      /if \(targets\.length > 0 && facts\.length === 0\) return index\.read\(\);/,
    );
  });

  it("describes every parameter in words a model can match to the schema", () => {
    const { toHost } = registeredTools();
    assert.equal(toHost.length, TOOLS.length);
    for (const tool of toHost) {
      const fields = Object.keys((tool.parameters as z.ZodObject<z.ZodRawShape>).shape);
      for (const field of fields) assert.ok(field.length > 0, tool.name);
    }
  });
});

describe("starting a thread inside a feature", () => {
  it("asks for the Features project by the feature's container path", async () => {
    const homeProjectCalls: string[] = [];
    const spawnCalls: { environment?: unknown; projectId: string }[] = [];
    let registered: { execute: (params: unknown, context: unknown) => Promise<string> } | undefined;
    registerSpawnTool(
      {
        register(tool: { execute: (params: unknown, context: unknown) => Promise<string> }) {
          registered = tool;
        },
        tools: [],
        enabledToolNames: () => [],
        isEnabled: () => true,
      } as never,
      {
        locate: () => ({
          feature: {
            id: "f_ai_voice",
            name: "AI voice",
            slug: "ai-voice",
            state: "active",
            position: 0,
            rootPath: "/data/harbor-features/ai-voice",
            hostId: "host_1",
          },
          members: [],
          inRoot: true,
        }),
        threadPath: async () => "/data/harbor-features/ai-voice",
        environment: async () => null,
        homeProject: async (containerPath) => {
          homeProjectCalls.push(containerPath);
          return "prj_features";
        },
        resolveProject: async () => null,
        spawn: async (input) => {
          spawnCalls.push({ environment: input.environment, projectId: input.projectId });
          return "thr_new";
        },
      },
    );
    assert.ok(registered);
    await registered.execute({ prompt: "Do the work.", as_child: true }, { threadId: "thr_call" });
    assert.deepEqual(homeProjectCalls, ["/data/harbor-features"]);
    assert.equal(spawnCalls[0]?.projectId, "prj_features");
    assert.deepEqual(spawnCalls[0]?.environment, {
      type: "host",
      hostId: "host_1",
      workspace: { type: "unmanaged", path: "/data/harbor-features/ai-voice" },
    });
  });
});
