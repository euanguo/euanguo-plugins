/**
 * The plugin's public surface, pinned.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HARBOR_AGENT_TOOL_NAMES,
  toolsForAccessTier,
  type AgentAccessTier,
} from "../lib/domain/agent-access.ts";
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
  "batchRemoveWorktrees",
  "batchSettleIdleThreads",
  "batchSurveyWorktrees",
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
  "getAgentAccess",
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
  "setAgentAccess",
  "setAppearance",
  "setProjectColor",
  "setScopeIcon",
  "setViewPreferences",
  "settle",
  "snooze",
  "spawnThread",
  "unparkFeature",
  "unsettle",
  "unsnooze",
  "updateFeatureBrief",
];

const EXPECTED_AGENT_TOOLS = [
  "harbor_admin_delete",
  "harbor_feature_brief",
  "harbor_feature_git_status",
  "harbor_feature_lifecycle",
  "harbor_feature_list",
  "harbor_feature_meta",
  "harbor_feature_repos",
  "harbor_sidebar_map",
  "harbor_sidebar_organize",
  "harbor_thread_spawn",
];

function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

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
    assert.equal("commitFeatureRepo" in harborRpcContract, false);
    assert.equal("suggestFeatureCommitMessage" in harborRpcContract, false);
  });

  it("registers the consolidated V3 agent toolset and exposes tools per tier", () => {
    let tier: AgentAccessTier = "read-only";
    const registry = wireAgentTools({
      bb: stubBb(),
      getTier: () => tier,
      deps: stubDeps(),
      features: stubFeatures(),
      spawn: stubSpawn(),
    });

    assert.deepEqual(
      sorted(registry.tools.map((tool) => tool.name)),
      sorted(EXPECTED_AGENT_TOOLS),
    );
    assert.deepEqual(sorted(HARBOR_AGENT_TOOL_NAMES), sorted(EXPECTED_AGENT_TOOLS));

    assert.deepEqual(registry.enabledToolNames(), [
      "harbor_sidebar_map",
      "harbor_feature_list",
      "harbor_feature_brief",
      "harbor_feature_git_status",
    ]);

    tier = "off";
    assert.deepEqual(registry.enabledToolNames(), []);

    tier = "full";
    assert.deepEqual(
      sorted(registry.enabledToolNames()),
      sorted(toolsForAccessTier("full")),
    );
  });
});
