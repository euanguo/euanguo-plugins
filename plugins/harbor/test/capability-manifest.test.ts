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
import { harborRpcContract } from "../server/contract.ts";

const RPC_METHODS = [
  "activateOrphanWorktree",
  "addFeatureDecision",
  "addFeatureRef",
  "addFeatureReferenceRepo",
  "addFeatureRepositories",
  "adoptWorkspace",
  "assignProjectToGroup",
  "batchSettleIdleThreads",
  "commitFeatureRepo",
  "confirmBulkDelete",
  "confirmFeatureDecision",
  "createFeature",
  "createGroup",
  "deleteFeature",
  "deleteFeatureDecisionDraft",
  "deleteFeaturePreset",
  "deleteGroup",
  "detectProjectIcon",
  "finishFeature",
  "getAppearance",
  "getFeatureGitStatus",
  "getFeatureMeta",
  "getViewPreferences",
  "importCodeWorkspace",
  "inspectFeatureHealth",
  "inspectFeatureRemoval",
  "inspectWorktree",
  "listFeaturePresets",
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
  "parkFeature",
  "planFeatureRepositories",
  "previewBulkDelete",
  "promoteToFeature",
  "pushFeatureRepo",
  "readFeatureRepoDiff",
  "removeFeatureRef",
  "removeFeatureReferenceRepo",
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
  "saveFeaturePreset",
  "setAppearance",
  "setProjectColor",
  "setScopeIcon",
  "setViewPreferences",
  "settle",
  "snooze",
  "spawnThread",
  "suggestFeatureCommitMessage",
  "unparkFeature",
  "unsettle",
  "unsnooze",
  "updateFeatureBrief",
];

const AGENT_TOOLS = [
  "harbor_feature_add_ref",
  "harbor_feature_add_repos",
  "harbor_feature_adopt",
  "harbor_feature_brief",
  "harbor_feature_context",
  "harbor_feature_create",
  "harbor_feature_decide",
  "harbor_feature_delete",
  "harbor_feature_git_status",
  "harbor_feature_link",
  "harbor_feature_list",
  "harbor_feature_park",
  "harbor_feature_promote",
  "harbor_feature_remove_repo",
  "harbor_feature_rename",
  "harbor_feature_reopen",
  "harbor_feature_unpark",
  "harbor_group_create",
  "harbor_group_delete",
  "harbor_group_rename",
  "harbor_project_delete",
  "harbor_project_rename",
  "harbor_project_set_group",
  "harbor_sidebar_map",
  "harbor_thread_delete",
  "harbor_thread_pin",
  "harbor_thread_rename",
  "harbor_thread_settle",
  "harbor_thread_snooze",
  "harbor_thread_spawn",
  "harbor_workspace_set_alias",
  "harbor_worktree_remove",
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
    assert.deepEqual(sorted(Object.keys(harborRpcContract)), sorted(RPC_METHODS));
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
