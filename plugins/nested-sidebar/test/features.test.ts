import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  asciiSlug,
  featureBranch,
  featureForPath,
  featureOfWorkspace,
  featureRenameIntent,
  isFeatureRoot,
  liveAssignment,
  planFeatureRemoval,
  sortFeatures,
  suggestFeatureSlug,
  uniqueSlug,
  validFeatureSlug,
  type Feature,
} from "../lib/features.ts";

function feature(id: string, overrides: Partial<Feature> = {}): Feature {
  return {
    id,
    name: id,
    slug: id,
    state: "active",
    position: 0,
    rootPath: `/home/u/NestFeatures/${id}`,
    hostId: "host_a",
    ...overrides,
  };
}

describe("feature slugs", () => {
  it("keeps the ASCII words of a name and nothing else", () => {
    assert.equal(asciiSlug("AI 智能语音插件 2"), "ai-2");
    assert.equal(asciiSlug("Message callback → prepaid"), "message-callback-prepaid");
    assert.equal(asciiSlug("消息回调转预付费"), "");
  });

  /**
   * The bug this replaces: two all-CJK names both became `feat/feat/<repo>`, so
   * the second feature was told its branch was held by the first.
   */
  it("never gives two all-CJK names the same slug", () => {
    let n = 0;
    const random = () => `r${(n += 1)}xx`;
    const first = suggestFeatureSlug("消息回调转预付费", new Set(), random);
    const second = suggestFeatureSlug("计费改造", new Set([first]), random);
    assert.notEqual(first, second);
    assert.ok(validFeatureSlug(first) && validFeatureSlug(second));
    assert.notEqual(featureBranch(first), featureBranch(second));
  });

  it("suffixes a taken slug and stays within the length limit", () => {
    assert.equal(uniqueSlug("voice", new Set(["voice"])), "voice-2");
    const long = "a".repeat(40);
    const next = uniqueSlug(long, new Set([long]));
    assert.ok(next.length <= 40 && next.endsWith("-2"));
  });

  it("accepts only lowercase letters, digits and single dashes", () => {
    assert.ok(validFeatureSlug("ai-voice-2"));
    for (const bad of ["AI", "-a", "a-", "a--b", "a b", "语音", ""]) {
      assert.equal(validFeatureSlug(bad), false, bad);
    }
  });

  it("treats an empty or unchanged rename as no rename", () => {
    assert.equal(featureRenameIntent("   ", "AI"), null);
    assert.equal(featureRenameIntent("AI", "AI"), null);
    assert.equal(featureRenameIntent("  AI   语音 ", "AI"), "AI 语音");
  });
});

describe("what belongs to a feature", () => {
  const ai = feature("ai", { rootPath: "/f/ai" });
  const ai2 = feature("ai2", { rootPath: "/f/ai-2" });

  it("is decided by path segment, not by string prefix", () => {
    assert.equal(featureForPath([ai, ai2], "/f/ai/tea-app-im")?.id, "ai");
    assert.equal(featureForPath([ai, ai2], "/f/ai-2/tea-app-im")?.id, "ai2");
    assert.equal(featureForPath([ai, ai2], "/f/ai-20"), null);
    assert.equal(featureForPath([ai], "/f/ai/")?.id, "ai");
  });

  it("tells the folder itself from a member inside it", () => {
    assert.equal(isFeatureRoot(ai, "/f/ai"), true);
    assert.equal(isFeatureRoot(ai, "/f/ai/tea-app-im"), false);
  });

  it("lets the path win over an adoption label", () => {
    const resolved = featureOfWorkspace({
      features: [ai, ai2],
      adoptions: { env_x: "ai2" },
      environmentId: "env_x",
      path: "/f/ai/tea-app-im",
    });
    assert.equal(resolved?.id, "ai");
  });

  it("uses the adoption label only outside every feature folder", () => {
    const resolved = featureOfWorkspace({
      features: [ai, ai2],
      adoptions: { env_x: "ai2" },
      environmentId: "env_x",
      path: "/code/tea-app-im/.worktrees/x",
    });
    assert.equal(resolved?.id, "ai2");
  });

  it("forgets a label whose feature no longer exists", () => {
    assert.deepEqual(
      liveAssignment({ env_a: "ai", env_b: "gone" }, new Set(["ai"])),
      { env_a: "ai" },
    );
  });
});

describe("feature order", () => {
  it("orders by position, then name", () => {
    const sorted = sortFeatures([
      feature("b", { position: 1 }),
      feature("c", { position: 0 }),
      feature("a", { position: 0 }),
    ]);
    assert.deepEqual(sorted.map((item) => item.id), ["a", "c", "b"]);
  });
});

describe("what ending a feature would cost", () => {
  const worktree = (overrides: Partial<{ changedFiles: number; untrackedFiles: number; aheadCommits: number | null }>) => ({
    path: "/f/ai/x",
    changedFiles: 0,
    untrackedFiles: 0,
    aheadCommits: 0,
    missing: false,
    ...overrides,
  });

  it("needs nothing typed when only conversations are archived", () => {
    const plan = planFeatureRemoval({ worktrees: [worktree({})], threadCount: 3 });
    assert.equal(plan.requiresConfirmation, false);
    assert.deepEqual(plan.warnings, ["3 threads will be archived"]);
  });

  it("asks for the name when uncommitted work would go", () => {
    const plan = planFeatureRemoval({ worktrees: [worktree({ changedFiles: 2 })], threadCount: 0 });
    assert.equal(plan.requiresConfirmation, true);
  });

  /** A finish keeps the branches, so commits not yet pushed are not lost by it. */
  it("counts unpushed commits as lost only when branches are deleted", () => {
    const survey = { worktrees: [worktree({ aheadCommits: 4 })], threadCount: 0 };
    assert.equal(planFeatureRemoval(survey, { deletesBranches: false }).requiresConfirmation, false);
    assert.equal(planFeatureRemoval(survey, { deletesBranches: true }).requiresConfirmation, true);
  });
});
