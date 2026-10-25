import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyWorkspace,
  workspaceDisplayKindOf,
  type WorkspaceEnvironmentDescriptor,
  type WorkspaceProjectDescriptor,
} from "../lib/workspace.ts";

const HOST = "host_1";

function environment(
  overrides: Partial<WorkspaceEnvironmentDescriptor> = {},
): WorkspaceEnvironmentDescriptor {
  return {
    id: "env_1",
    projectId: "proj_1",
    hostId: HOST,
    path: "/repos/app",
    isGitRepo: true,
    isWorktree: false,
    branchName: "main",
    name: null,
    providerId: "project-checkout",
    workspaceDisplayKind: "other",
    ...overrides,
  };
}

const SOURCE: WorkspaceProjectDescriptor = {
  projectId: "proj_1",
  sourcePath: "/repos/app",
  sourceHostId: HOST,
};

/**
 * The bug this file exists for: `workspaceProvisionType` is `unmanaged` for every
 * project checkout, because it means "bb did not create this directory". Reading
 * it as "a worktree bb does not manage" labelled every plain directory a worktree
 * and made the two external kinds unreachable.
 */
describe("bb's provisioning kind, as a workspace reads it", () => {
  it("takes the worktree question from the field that answers it", () => {
    // bb's own data, measured on a live install: every non-worktree environment,
    // a plain directory included, arrives as `unmanaged`.
    assert.equal(
      workspaceDisplayKindOf({ workspaceProvisionType: "unmanaged", isWorktree: false }),
      "other",
    );
    assert.equal(
      workspaceDisplayKindOf({ workspaceProvisionType: "unmanaged", isWorktree: true }),
      "unmanaged-worktree",
    );
  });

  it("still calls a directory bb made a managed worktree", () => {
    assert.equal(
      workspaceDisplayKindOf({ workspaceProvisionType: "managed-worktree", isWorktree: true }),
      "managed-worktree",
    );
  });

  it("treats a missing kind as no worktree", () => {
    assert.equal(
      workspaceDisplayKindOf({ workspaceProvisionType: null, isWorktree: false }),
      "other",
    );
  });
});

describe("what a workspace is", () => {
  it("calls the project's own directory a checkout, whatever bb provisioned", () => {
    assert.equal(
      classifyWorkspace(environment({ workspaceDisplayKind: "other" }), SOURCE),
      "project-checkout",
    );
  });

  it("reaches external-directory, which the provisioning kind made impossible", () => {
    assert.equal(
      classifyWorkspace(
        environment({ path: "/elsewhere/plain", isGitRepo: false, workspaceDisplayKind: "other" }),
        SOURCE,
      ),
      "external-directory",
    );
  });

  it("reaches external-checkout", () => {
    assert.equal(
      classifyWorkspace(
        environment({ path: "/elsewhere/repo", isGitRepo: true, workspaceDisplayKind: "other" }),
        SOURCE,
      ),
      "external-checkout",
    );
  });

  it("calls a managed worktree a worktree, even outside the source", () => {
    assert.equal(
      classifyWorkspace(
        environment({
          path: "/Users/verger/.bb/plugins/worktrees/thr_1/app",
          isWorktree: true,
          workspaceDisplayKind: "managed-worktree",
        }),
        SOURCE,
      ),
      "git-worktree",
    );
  });

  it("calls an unmanaged worktree a worktree", () => {
    assert.equal(
      classifyWorkspace(
        environment({
          path: "/elsewhere/wt",
          isWorktree: true,
          workspaceDisplayKind: "unmanaged-worktree",
        }),
        SOURCE,
      ),
      "git-worktree",
    );
  });

  it("keeps a personal workspace out of the project axis", () => {
    assert.equal(
      classifyWorkspace(
        environment({ providerId: "personal-workspace", workspaceDisplayKind: "other" }),
        SOURCE,
      ),
      "personal",
    );
  });

  it("calls a workspace with no path unresolved", () => {
    assert.equal(
      classifyWorkspace(environment({ path: null, workspaceDisplayKind: "other" }), SOURCE),
      "unresolved",
    );
  });

  it("needs the same machine as the source to call it a checkout", () => {
    assert.equal(
      classifyWorkspace(
        environment({ hostId: "host_2", workspaceDisplayKind: "other" }),
        SOURCE,
      ),
      "external-checkout",
    );
  });
});
