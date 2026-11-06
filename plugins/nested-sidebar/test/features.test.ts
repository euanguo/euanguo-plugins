import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assignWorkspaceFeature,
  environmentsOfFeature,
  featureIdFrom,
  featureRenameIntent,
  featuresByGroup,
  labelForProject,
  liveAssignment,
  sortFeatures,
  type Feature,
} from "../lib/features.ts";

function feature(id: string, overrides: Partial<Feature> = {}): Feature {
  return {
    id,
    name: id,
    state: "draft",
    groupId: null,
    position: 0,
    ...overrides,
  };
}

describe("feature identity", () => {
  it("derives a stable id from the name and never collides", () => {
    assert.equal(featureIdFrom("AI 语音", new Set()), "feat_ai-语音");
    assert.equal(
      featureIdFrom("AI 语音", new Set(["feat_ai-语音"])),
      "feat_ai-语音-2",
    );
    assert.equal(featureIdFrom("  ", new Set()), "feat_feature");
  });

  it("treats an empty or unchanged rename as no rename", () => {
    assert.equal(featureRenameIntent("   ", "AI"), null);
    assert.equal(featureRenameIntent("AI", "AI"), null);
    assert.equal(featureRenameIntent("  AI   语音 ", "AI"), "AI 语音");
  });

  it("orders by position, then name", () => {
    const sorted = sortFeatures([
      feature("b", { position: 1 }),
      feature("c", { position: 0 }),
      feature("a", { position: 0 }),
    ]);
    assert.deepEqual(sorted.map((item) => item.id), ["a", "c", "b"]);
  });
});

describe("filing features under groups", () => {
  it("puts a feature whose group was deleted back under Ungrouped", () => {
    const buckets = featuresByGroup(
      [
        feature("kept", { groupId: "grp_a" }),
        feature("orphan", { groupId: "grp_gone" }),
      ],
      new Set(["grp_a"]),
    );
    assert.deepEqual(buckets.get("grp_a")?.map((item) => item.id), ["kept"]);
    assert.deepEqual(buckets.get(null)?.map((item) => item.id), ["orphan"]);
  });

  it("drops an empty group rather than drawing an empty bucket", () => {
    const buckets = featuresByGroup([feature("only")], new Set());
    assert.equal(buckets.has("grp_a"), false);
    assert.equal(buckets.get(null)?.length, 1);
  });
});

describe("workspace labels", () => {
  it("forgets a label whose feature no longer exists", () => {
    const live = liveAssignment(
      { env_a: "feat_a", env_b: "feat_gone" },
      new Set(["feat_a"]),
    );
    assert.deepEqual(live, { env_a: "feat_a" });
  });

  it("moves a label, and refuses a feature that does not exist", () => {
    assert.deepEqual(
      assignWorkspaceFeature({}, new Set(["feat_a"]), "env_a", "feat_a"),
      { env_a: "feat_a" },
    );
    assert.equal(
      assignWorkspaceFeature({}, new Set(["feat_a"]), "env_a", "feat_b"),
      null,
    );
    assert.equal(
      assignWorkspaceFeature({ env_a: "feat_a" }, new Set(["feat_a"]), "env_a", "feat_a"),
      null,
    );
    assert.deepEqual(
      assignWorkspaceFeature({ env_a: "feat_a" }, new Set(["feat_a"]), "env_a", null),
      {},
    );
  });

  it("lists the workspaces of one feature", () => {
    assert.deepEqual(
      environmentsOfFeature({ env_a: "f", env_b: "g", env_c: "f" }, "f").sort(),
      ["env_a", "env_c"],
    );
  });

  it("borrows a project's label only when its workspaces agree", () => {
    assert.equal(labelForProject({ env_a: "f" }, ["env_a"]), "f");
    assert.equal(labelForProject({ env_a: "f", env_b: "g" }, ["env_a", "env_b"]), null);
    assert.equal(labelForProject({}, [null]), null);
  });
});
