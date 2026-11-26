import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  draftKeyFor,
  draftKeyForTarget,
  environmentIdFromSubPath,
  featureNewChatSubPath,
  parseNewChatSubPath,
} from "../app/new-chat/route.ts";
import {
  clearActiveNewChat,
  getActiveNewChat,
  publishActiveNewChat,
} from "../lib/ui/workspace-index-store.ts";

describe("new-chat route parsing", () => {
  it("round-trips feature and environment subpaths cleanly", () => {
    const featurePath = featureNewChatSubPath("f_order 1");
    assert.equal(featurePath, "feature/f_order%201");
    assert.deepEqual(parseNewChatSubPath(featurePath), {
      kind: "feature",
      featureId: "f_order 1",
    });
    assert.deepEqual(parseNewChatSubPath(" /feature/f_123/ "), {
      kind: "feature",
      featureId: "f_123",
    });
    assert.equal(environmentIdFromSubPath(featurePath), null);

    assert.deepEqual(parseNewChatSubPath("/env_abc/"), {
      kind: "environment",
      environmentId: "env_abc",
    });
    assert.equal(environmentIdFromSubPath("/env_abc/"), "env_abc");
  });

  it("rejects empty or malformed subpaths safely", () => {
    assert.equal(parseNewChatSubPath(""), null);
    assert.equal(parseNewChatSubPath("///"), null);
    assert.equal(parseNewChatSubPath("feature/"), null);
    assert.deepEqual(parseNewChatSubPath("feature/%E0%A4%A"), {
      kind: "feature",
      featureId: "%E0%A4%A",
    });
  });

  it("derives isolated draft keys for environments and features", () => {
    const envTarget = parseNewChatSubPath("env_1");
    const featureTarget = parseNewChatSubPath("feature/feat_1");
    assert.ok(envTarget && featureTarget);
    assert.equal(draftKeyForTarget(envTarget), draftKeyFor("env_1"));
    assert.equal(draftKeyForTarget(featureTarget), "harbor:new-chat:feature:feat_1");
  });
});

describe("active new-chat store", () => {
  it("tracks active new-chat target without clobbering newer navigations", () => {
    const featureA = { kind: "feature", featureId: "feat_a" } as const;
    const featureB = { kind: "feature", featureId: "feat_b" } as const;
    const envTarget = { kind: "environment", environmentId: "env_1" } as const;

    publishActiveNewChat(null);
    assert.equal(getActiveNewChat(), null);

    publishActiveNewChat(featureA);
    assert.deepEqual(getActiveNewChat(), featureA);

    publishActiveNewChat(featureB);
    clearActiveNewChat(featureA);
    assert.deepEqual(getActiveNewChat(), featureB);

    clearActiveNewChat(featureB);
    assert.equal(getActiveNewChat(), null);

    publishActiveNewChat(envTarget);
    assert.deepEqual(getActiveNewChat(), envTarget);
    clearActiveNewChat(envTarget);
    assert.equal(getActiveNewChat(), null);
  });
});
