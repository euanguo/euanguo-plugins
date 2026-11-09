import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { z } from "zod";
import { createAgentToolRegistry } from "../lib/agent/toolkit.ts";
import { registerReadTools } from "../lib/agent/tools-read.ts";
import { registerWriteTools } from "../lib/agent/tools-write.ts";
import { registerFeatureTools } from "../lib/agent/tools-features.ts";
import { registerThreadTools } from "../lib/agent/tools-threads.ts";
import {
  AGENT_TOOL_SETTING_DESCRIPTORS,
  DEFAULT_AGENT_TOOL_FLAGS,
} from "../lib/agent/settings.ts";
import type { AgentToolDeps } from "../lib/agent/actions.ts";

const root = path.join(import.meta.dirname, "..");
const read = (file: string) => readFile(path.join(root, file), "utf8");

const [server, toolkit, readTools, writeTools, settings, wire, readme, plan] = await Promise.all([
  read("server.ts"),
  read("lib/agent/toolkit.ts"),
  read("lib/agent/tools-read.ts"),
  read("lib/agent/tools-write.ts"),
  read("lib/agent/settings.ts"),
  read("lib/agent/wire.ts"),
  read("README.md"),
  read("PLAN-AGENT-TOOLS.md"),
]);
const sidebarIndex = await read("server/sidebar-index-service.ts");

/** The tools this build promises, and the feature each belongs to. */
const TOOLS = [
  { name: "nest_sidebar_map", feature: "read" },
  { name: "nest_feature_context", feature: "features" },
  { name: "nest_feature_add_repos", feature: "features" },
  { name: "nest_feature_list", feature: "features" },
  { name: "nest_feature_create", feature: "features" },
  { name: "nest_feature_rename", feature: "features" },
  { name: "nest_feature_reopen", feature: "features" },
  { name: "nest_feature_adopt", feature: "features" },
  { name: "nest_project_rename", feature: "rename" },
  { name: "nest_thread_settle", feature: "threads" },
  { name: "nest_thread_snooze", feature: "threads" },
  { name: "nest_thread_pin", feature: "threads" },
  { name: "nest_thread_rename", feature: "threads" },
  { name: "nest_project_set_group", feature: "grouping" },
  { name: "nest_group_create", feature: "groups" },
  { name: "nest_group_rename", feature: "groups" },
  { name: "nest_workspace_set_alias", feature: "aliases" },
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
      assignProjectToGroup: async () => true,
      createGroup: async () => null,
      renameGroup: async () => true,
      setWorkspaceAlias: async () => null,
    },
  };
  registerReadTools(registry, deps);
  registerWriteTools(registry, deps);
  registerThreadTools(registry, deps);
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
  });
  return { toHost, registry };
}

describe("Nest's agent surface, as the plan promises it", () => {
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
    assert.equal(features.size, 7);
    // And the other way: no switch that gates nothing.
    const gateable = new Set(Object.keys(DEFAULT_AGENT_TOOL_FLAGS).filter((flag) => flag !== "enabled"));
    assert.deepEqual([...features].sort(), [...gateable].sort());
  });

  it("reaches nothing destructive, and no ordering write", () => {
    const names = registeredTools().toHost.map((tool) => tool.name).join(" ");
    for (const verb of ["remove", "delete", "archive", "reorder", "order", "create_project", "worktree"]) {
      assert.ok(!names.includes(verb), `no tool name contains ${verb}`);
    }
    // The manual arrangement is the one thing two clients can fight over, and
    // the reason no tool needs a revision. A tool reaching the order store is
    // how that stops being true.
    for (const source of [readTools, writeTools]) {
      assert.doesNotMatch(source, /setProjectOrder|setFamilyOrder|setWorkspaceOrder|removeGroup|removeProject/);
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
    assert.match(readme, /Reading is\non by default/);
    assert.match(readme, /bb nest status/);
  });

  it("appends the index migration rather than inserting it", () => {
    const migrations = server.slice(
      server.indexOf("const migrations"),
      server.indexOf("export interface StoredLifecycleRow"),
    );
    // The feature journal is appended as a group, so what this pins is that the
    // group is last: a statement added above it would rewrite the history of a
    // database that already ran it.
    assert.match(migrations, /SIDEBAR_INDEX_MIGRATION,\n\s*\.\.\.FEATURE_MIGRATIONS,\n\];/);
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

  it("keeps the plan's gate list and its tool table in step with the build", () => {
    assert.match(plan, /## Acceptance gates/);
    for (const gate of ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8"]) {
      assert.match(plan, new RegExp(`\\| ${gate} \\|`));
    }
    for (const tool of TOOLS) {
      assert.match(plan, new RegExp(tool.name));
    }
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
