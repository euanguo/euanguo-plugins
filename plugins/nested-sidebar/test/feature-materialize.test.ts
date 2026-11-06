import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  childDirectoryFor,
  planMaterialize,
  validBranchName,
  type WorktreeProbe,
} from "../lib/feature-materialize.ts";

const probe = (overrides: Partial<WorktreeProbe> = {}): WorktreeProbe => ({
  repository: true,
  mainWorktree: true,
  worktrees: [{ path: "/code/tea-app-im", branch: "main" }],
  branchExists: false,
  targetExists: false,
  ...overrides,
});

const plan = (overrides: Partial<WorktreeProbe> = {}, branch = "feat/ai") =>
  planMaterialize({
    featureDirectory: "/f/ai",
    repositoryName: "tea-app-im",
    branch,
    probe: probe(overrides),
  });

describe("adding a repository to a feature", () => {
  it("creates a new branch in a free target", () => {
    assert.deepEqual(plan(), {
      status: "create",
      path: "/f/ai/tea-app-im",
      branch: "feat/ai",
      newBranch: true,
    });
  });

  it("checks out an existing branch nobody holds", () => {
    const decision = plan({ branchExists: true });
    assert.equal(decision.status, "create");
    assert.equal(decision.status === "create" && decision.newBranch, false);
  });

  it("is idempotent when the branch is already checked out right there", () => {
    const decision = plan({
      worktrees: [
        { path: "/code/tea-app-im", branch: "main" },
        { path: "/f/ai/tea-app-im/", branch: "feat/ai" },
      ],
      targetExists: true,
    });
    assert.equal(decision.status, "reuse");
  });

  it("refuses a branch held elsewhere and says where", () => {
    const decision = plan({
      worktrees: [
        { path: "/code/tea-app-im", branch: "main" },
        { path: "/code/tea-app-im/.wt/x", branch: "feat/ai" },
      ],
    });
    assert.equal(decision.status, "blocked");
    assert.match(decision.status === "blocked" ? decision.reason : "", /\/code\/tea-app-im\/\.wt\/x/u);
  });

  /**
   * The pre-flight used to look only at `git worktree list`, so a plain folder
   * left by an interrupted run read as "ready" and the create then failed. The
   * plan now gets the same disk fact the create checks.
   */
  it("refuses a target that exists on disk even when git does not list it", () => {
    assert.equal(plan({ targetExists: true }).status, "blocked");
  });

  it("refuses a target another worktree occupies on a different branch", () => {
    const decision = plan({
      worktrees: [
        { path: "/code/tea-app-im", branch: "main" },
        { path: "/f/ai/tea-app-im", branch: "other" },
      ],
      targetExists: true,
    });
    assert.equal(decision.status, "blocked");
    assert.match(decision.status === "blocked" ? decision.reason : "", /other/u);
  });

  it("refuses a source that is not a repository, or is itself a linked worktree", () => {
    assert.equal(plan({ repository: false }).status, "blocked");
    assert.equal(plan({ mainWorktree: false }).status, "blocked");
  });

  it("keeps the child folder to one safe path segment", () => {
    assert.equal(childDirectoryFor("Tea App/IM"), "tea-app-im");
    assert.equal(childDirectoryFor("../.."), "repo");
  });

  it("accepts the branch names people type and refuses git's usual traps", () => {
    for (const ok of ["feat/ai", "feat/ai-voice/2", "release-1.2"]) assert.ok(validBranchName(ok), ok);
    for (const bad of ["", "-x", "a..b", "a b", "a~1", "x.lock", "feat/", "a//b", "a@{1}"]) {
      assert.equal(validBranchName(bad), false, bad);
    }
  });
});
