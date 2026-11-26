import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  asciiSlug,
  featureBranch,
  featureForPath,
  featureOfWorkspace,
  featureRenameIntent,
  generateDraftFeatureName,
  isDraftFeatureName,
  isFeatureRoot,
  liveAssignment,
  normalizeParkNote,
  normalizeParkReason,
  planFeatureRemoval,
  sortFeatures,
  suggestFeatureSlug,
  uniqueSlug,
  validFeatureSlug,
  type Feature,
} from "../lib/domain/features.ts";

function feature(id: string, overrides: Partial<Feature> = {}): Feature {
  return {
    id,
    name: id,
    slug: id,
    state: "active",
    position: 0,
    rootPath: `/home/u/HarborFeatures/${id}`,
    hostId: "host_a",
    ...overrides,
  };
}

describe("feature slugs", () => {
  it("keeps the ASCII words of a name and nothing else", () => {
    assert.equal(asciiSlug("AI 示例插件 2"), "ai-2");
    assert.equal(asciiSlug("Message callback → prepaid"), "message-callback-prepaid");
    assert.equal(asciiSlug("订单通知改造"), "");
  });

  /**
   * The bug this replaces: two all-CJK names both became `feat/feat/<repo>`, so
   * the second feature was told its branch was held by the first.
   */
  it("never gives two all-CJK names the same slug", () => {
    let n = 0;
    const random = () => {
      n += 1;
      return `r${n}xx`;
    };
    const first = suggestFeatureSlug("订单通知改造", new Set(), random);
    const second = suggestFeatureSlug("结算流程重构", new Set([first]), random);
    assert.notEqual(first, second);
    assert.ok(validFeatureSlug(first) && validFeatureSlug(second));
    assert.notEqual(featureBranch(first), featureBranch(second));
  });

  it("suffixes a taken slug and stays within the length limit", () => {
    assert.equal(uniqueSlug("voice", new Set(["voice"])), "voice-2");
    const long = "a".repeat(40);
    const next = uniqueSlug(long, new Set([long]));
    assert.ok(next.length <= 40 && next.endsWith("-2"));
    const trailingHyphen = `${"a".repeat(37)}-${"a".repeat(2)}`;
    const safeNext = uniqueSlug(trailingHyphen, new Set([trailingHyphen]));
    assert.equal(safeNext.includes("--"), false);
    assert.ok(validFeatureSlug(safeNext));
  });

  it("strips every control character from park reason and note", () => {
    assert.equal(normalizeParkReason("wait\u0001for\u0007qa"), "wait for qa");
    assert.equal(normalizeParkNote("line1\u0001\nline2\u001Fend"), "line1 line2 end");
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
    assert.equal(featureRenameIntent("  AI   助手 ", "AI"), "AI 助手");
  });

  it("generates unique, slug-friendly draft feature names", () => {
    const first = generateDraftFeatureName(new Set(), () => 0);
    assert.equal(first, "Draft · amber-anchor");
    assert.equal(isDraftFeatureName(first), true);
    assert.equal(isDraftFeatureName("Order Notification V2"), false);

    const second = generateDraftFeatureName(new Set([first]), () => 0);
    assert.notEqual(second, first);
    assert.equal(isDraftFeatureName(second), true);
    assert.ok(validFeatureSlug(asciiSlug(second)));
  });
});

describe("what belongs to a feature", () => {
  const ai = feature("ai", { rootPath: "/f/ai" });
  const ai2 = feature("ai2", { rootPath: "/f/ai-2" });

  it("is decided by path segment, not by string prefix", () => {
    assert.equal(featureForPath([ai, ai2], "/f/ai/acme-web")?.id, "ai");
    assert.equal(featureForPath([ai, ai2], "/f/ai-2/acme-web")?.id, "ai2");
    assert.equal(featureForPath([ai, ai2], "/f/ai-20"), null);
    assert.equal(featureForPath([ai], "/f/ai/")?.id, "ai");
  });

  it("tells the folder itself from a member inside it", () => {
    assert.equal(isFeatureRoot(ai, "/f/ai"), true);
    assert.equal(isFeatureRoot(ai, "/f/ai/acme-web"), false);
  });

  it("lets the path win over an adoption label", () => {
    const resolved = featureOfWorkspace({
      features: [ai, ai2],
      adoptions: { env_x: "ai2" },
      environmentId: "env_x",
      path: "/f/ai/acme-web",
    });
    assert.equal(resolved?.id, "ai");
  });

  it("uses the adoption label only outside every feature folder", () => {
    const resolved = featureOfWorkspace({
      features: [ai, ai2],
      adoptions: { env_x: "ai2" },
      environmentId: "env_x",
      path: "/code/acme-web/.worktrees/x",
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
  const worktree = (
    overrides: Partial<{
      changedFiles: number;
      untrackedFiles: number;
      aheadCommits: number | null;
      error: string | null;
    }>,
  ) => ({
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

  it("fails closed when worktree git status returned an error", () => {
    const plan = planFeatureRemoval({
      worktrees: [worktree({ error: "fatal: bad index" })],
      threadCount: 0,
    });
    assert.equal(plan.requiresConfirmation, true);
    assert.match(plan.warnings[0] ?? "", /could not be checked/u);
  });
});
