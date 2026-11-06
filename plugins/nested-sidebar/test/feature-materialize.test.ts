import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  branchForFeature,
  childDirectoryFor,
  planMaterialize,
} from "../lib/feature-materialize.ts";

const base = {
  featureDirectory: "/home/me/NestFeatures/feat_ai",
  repositoryName: "tea-app-im",
  branch: "feat/feat_ai",
  probe: {
    repository: true,
    mainWorktree: true,
    worktrees: [{ path: "/home/me/code/tea-app-im", branch: "master" }],
  },
  targetExists: false,
};

describe("feature materialization", () => {
  it("derives one branch name from the feature", () => {
    assert.equal(branchForFeature("feat_ai"), "feat/feat_ai");
  });

  it("sanitises a repository name into one path segment", () => {
    assert.equal(childDirectoryFor("tea-app-im"), "tea-app-im");
    assert.equal(childDirectoryFor("Org/Repo"), "org-repo");
    assert.equal(childDirectoryFor("/../.."), "repo");
  });

  it("plans a create when the branch is free and nothing is in the way", () => {
    const decision = planMaterialize(base);
    assert.equal(decision.status, "create");
    if (decision.status !== "create") return;
    assert.equal(decision.path, "/home/me/NestFeatures/feat_ai/tea-app-im");
    assert.equal(decision.branch, "feat/feat_ai");
  });

  it("refuses a branch another worktree holds, and names where", () => {
    const decision = planMaterialize({
      ...base,
      probe: {
        ...base.probe,
        worktrees: [
          { path: "/home/me/code/tea-app-im", branch: "master" },
          { path: "/home/me/elsewhere", branch: "feat/feat_ai" },
        ],
      },
    });
    assert.equal(decision.status, "blocked");
    if (decision.status !== "blocked") return;
    assert.match(decision.reason, /\/home\/me\/elsewhere/u);
  });

  it("reuses the same branch in the same place, so a retry is idempotent", () => {
    const decision = planMaterialize({
      ...base,
      probe: {
        ...base.probe,
        worktrees: [
          { path: "/home/me/code/tea-app-im", branch: "master" },
          {
            path: "/home/me/NestFeatures/feat_ai/tea-app-im",
            branch: "feat/feat_ai",
          },
        ],
      },
    });
    assert.equal(decision.status, "reuse");
  });

  it("refuses a leftover directory instead of deleting it", () => {
    const decision = planMaterialize({ ...base, targetExists: true });
    assert.equal(decision.status, "blocked");
    if (decision.status !== "blocked") return;
    assert.match(decision.reason, /目录已存在/u);
  });

  it("refuses a source that is not a repository", () => {
    const decision = planMaterialize({
      ...base,
      probe: { ...base.probe, repository: false },
    });
    assert.equal(decision.status, "blocked");
  });

  it("refuses to nest a worktree inside another worktree", () => {
    const decision = planMaterialize({
      ...base,
      probe: { ...base.probe, mainWorktree: false },
    });
    assert.equal(decision.status, "blocked");
    if (decision.status !== "blocked") return;
    assert.match(decision.reason, /worktree/u);
  });
});
