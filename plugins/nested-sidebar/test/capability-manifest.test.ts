/**
 * The plugin's public surface, pinned.
 *
 * The capability the user accepted is a set of names: the RPC methods the
 * frontend may call, the tools an agent may use, and the switches that gate
 * them. A refactor may move every implementation behind those names. It may not
 * rename, add, or remove one without this test failing first.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { DEFAULT_AGENT_TOOL_FLAGS, AGENT_TOOL_SETTING_DESCRIPTORS } from "../lib/agent/settings.ts";
import { wireAgentTools } from "../lib/agent/wire.ts";
import { nestRpcContract } from "../server/contract.ts";

const RPC_METHODS = [
  "addFeatureDecision",
  "addFeatureRef",
  "addFeatureRepositories",
  "adoptWorkspace",
  "assignProjectToGroup",
  "confirmBulkDelete",
  "confirmFeatureDecision",
  "createFeature",
  "createGroup",
  "deleteFeature",
  "deleteFeatureDecisionDraft",
  "deleteGroup",
  "detectProjectIcon",
  "finishFeature",
  "getAppearance",
  "getFeatureMeta",
  "getViewPreferences",
  "inspectFeatureRemoval",
  "inspectWorktree",
  "listFeatures",
  "listGroups",
  "listLifecycle",
  "listManualOrder",
  "listPinnedOrder",
  "listProjectArchivedThreads",
  "listProjectColors",
  "listProjectIcons",
  "listProviders",
  "listRepoFacts",
  "listSettledThreads",
  "listThreadsForRecovery",
  "listWorkspacePaths",
  "planFeatureRepositories",
  "previewBulkDelete",
  "removeFeatureRef",
  "removeFeatureRepository",
  "removeProject",
  "removeWorktree",
  "renameEnvironment",
  "renameFeature",
  "renameFeatureMemberBranch",
  "renameGroup",
  "renameProject",
  "reopenFeature",
  "reorderFamilies",
  "reorderGroups",
  "reorderPinned",
  "reorderProjects",
  "reorderWorkspaces",
  "resetProjectColor",
  "seedManualOrder",
  "setAppearance",
  "setProjectColor",
  "setScopeIcon",
  "setViewPreferences",
  "settle",
  "snooze",
  "spawnThread",
  "unsettle",
  "unsnooze",
  "updateFeatureBrief",
];

const AGENT_TOOLS = [
  "nest_feature_add_repos",
  "nest_feature_adopt",
  "nest_feature_brief",
  "nest_feature_context",
  "nest_feature_create",
  "nest_feature_decide",
  "nest_feature_delete",
  "nest_feature_link",
  "nest_feature_list",
  "nest_feature_remove_repo",
  "nest_feature_rename",
  "nest_feature_reopen",
  "nest_group_create",
  "nest_group_delete",
  "nest_group_rename",
  "nest_project_delete",
  "nest_project_rename",
  "nest_project_set_group",
  "nest_sidebar_map",
  "nest_thread_delete",
  "nest_thread_pin",
  "nest_thread_rename",
  "nest_thread_settle",
  "nest_thread_snooze",
  "nest_thread_spawn",
  "nest_workspace_set_alias",
  "nest_worktree_remove",
];

const AGENT_SWITCHES = [
  "agentToolsAliases",
  "agentToolsDestructive",
  "agentToolsEnabled",
  "agentToolsFeatures",
  "agentToolsGrouping",
  "agentToolsGroups",
  "agentToolsRead",
  "agentToolsRename",
  "agentToolsSpawn",
  "agentToolsThreads",
];

function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

/** The smallest `bb` the agent wiring touches at registration time. */
function stubBb() {
  return {
    agents: {
      registerTool() {},
      configure() {},
      contributeInstructions() {},
    },
  } as never;
}

function stubDeps() {
  const unused = async () => {
    throw new Error("not called at registration time");
  };
  return {
    index: () => null,
    refreshIndex: unused,
    actions: new Proxy(
      {},
      {
        get: () => unused,
      },
    ),
  } as never;
}

function stubFeatures() {
  return new Proxy(
    {},
    {
      get: () => () => null,
    },
  ) as never;
}

function stubSpawn() {
  return new Proxy(
    {},
    {
      get: () => () => null,
    },
  ) as never;
}

describe("the public capability surface", () => {
  it("keeps every RPC method the frontend can call", () => {
    assert.deepEqual(sorted(Object.keys(nestRpcContract)), sorted(RPC_METHODS));
  });

  it("keeps every agent tool and every switch that gates one", () => {
    const registry = wireAgentTools({
      bb: stubBb(),
      flags: { ...DEFAULT_AGENT_TOOL_FLAGS },
      deps: stubDeps(),
      features: stubFeatures(),
      spawn: stubSpawn(),
    });

    assert.deepEqual(sorted(registry.tools.map((tool) => tool.name)), sorted(AGENT_TOOLS));
    assert.deepEqual(
      sorted(Object.keys(AGENT_TOOL_SETTING_DESCRIPTORS)),
      sorted(AGENT_SWITCHES),
    );
  });

  it("keeps the README switch table in step with the descriptors", async () => {
    const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
    for (const descriptor of Object.values(AGENT_TOOL_SETTING_DESCRIPTORS)) {
      const label = descriptor.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const row = readme.match(
        new RegExp(`\\| \\*\\*${label}\\*\\* \\| (on|off) \\|`),
      );
      assert.ok(row, `README has no row for ${descriptor.label}`);
      assert.equal(
        row[1],
        descriptor.default ? "on" : "off",
        `${descriptor.label} default disagrees with the code`,
      );
    }
  });
});
