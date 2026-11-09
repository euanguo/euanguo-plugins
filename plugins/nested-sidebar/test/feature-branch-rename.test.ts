import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renameFeatureMemberBranch } from "../server/feature-branch-rename.ts";
import type { Feature, FeatureMember } from "../lib/features.ts";

const FEATURE: Feature = {
  id: "f_ai",
  name: "AI",
  slug: "ai",
  state: "active",
  position: 0,
  rootPath: "/home/u/NestFeatures/ai",
  hostId: "host_1",
};
const MEMBER: FeatureMember = {
  featureId: "f_ai",
  directory: "tea-app-im",
  path: "/home/u/NestFeatures/ai/tea-app-im",
  repository: "tea-app-im",
  repositoryPath: "/code/tea-app-im",
  branch: "feat/old-name",
  hostId: "host_1",
};

function harness(options: {
  branchExists?: boolean;
  recorded?: boolean;
  renameFails?: boolean;
  member?: FeatureMember | undefined;
} = {}) {
  const calls: { method: string; payload: unknown }[] = [];
  const recorded: string[] = options.recorded === false ? [] : ["feat/old-name"];
  const deps = {
    store: {
      branches: () =>
        recorded.map((branch) => ({
          repositoryPath: MEMBER.repositoryPath,
          hostId: MEMBER.hostId,
          branch,
        })),
      forgetBranch: (input: { branch: string }) => {
        const at = recorded.indexOf(input.branch);
        if (at >= 0) recorded.splice(at, 1);
      },
      recordBranch: (input: { branch: string }) => {
        recorded.push(input.branch);
      },
    },
    call: async <T,>(method: string, payload: unknown): Promise<T> => {
      calls.push({ method, payload });
      if (method === "probeFeatureWorktree") {
        return {
          status: "ok",
          branchExists: options.branchExists ?? false,
          worktrees: [],
        } as T;
      }
      return (
        options.renameFails === true
          ? { status: "failed", message: "git refused." }
          : { status: "renamed" }
      ) as T;
    },
    requireFeature: () => FEATURE,
    membersOf: () => (options.member === undefined ? [MEMBER] : []),
    refresh: async () => undefined,
    writeContext: async () => true,
    publish: () => undefined,
    timeoutMs: 1_000,
  };
  return { deps: deps as never, calls, recorded };
}

describe("renaming one member's branch", () => {
  it("renames through git and moves the record to the new name", async () => {
    const { deps, calls, recorded } = harness();
    const result = await renameFeatureMemberBranch(deps, {
      featureId: "f_ai",
      directory: "tea-app-im",
      branch: "feature/im-ai-voice",
    });
    assert.deepEqual(result, { ok: true, reason: null });
    const rename = calls.find((call) => call.method === "renameFeatureBranch");
    assert.deepEqual(rename?.payload, {
      repositoryPath: MEMBER.path,
      from: "feat/old-name",
      to: "feature/im-ai-voice",
    });
    assert.deepEqual(recorded, ["feature/im-ai-voice"]);
  });

  /** A branch the person brought is theirs: deleting the feature must not take it. */
  it("leaves no record behind for a branch Nest did not create", async () => {
    const { deps, recorded } = harness({ recorded: false });
    const result = await renameFeatureMemberBranch(deps, {
      featureId: "f_ai",
      directory: "tea-app-im",
      branch: "feature/mine",
    });
    assert.equal(result.ok, true);
    assert.deepEqual(recorded, [], "a branch that was not recorded stays unrecorded");
  });

  it("refuses a name that already exists in the repository", async () => {
    const { deps, calls } = harness({ branchExists: true });
    const result = await renameFeatureMemberBranch(deps, {
      featureId: "f_ai",
      directory: "tea-app-im",
      branch: "feat/taken",
    });
    assert.equal(result.ok, false);
    assert.match(result.reason ?? "", /already exists/);
    assert.equal(calls.some((call) => call.method === "renameFeatureBranch"), false);
  });

  it("refuses an invalid branch name without asking git", async () => {
    const { deps, calls } = harness();
    const result = await renameFeatureMemberBranch(deps, {
      featureId: "f_ai",
      directory: "tea-app-im",
      branch: "feat/has space",
    });
    assert.equal(result.ok, false);
    assert.equal(calls.length, 0);
  });

  it("carries git's refusal out", async () => {
    const { deps } = harness({ renameFails: true });
    const result = await renameFeatureMemberBranch(deps, {
      featureId: "f_ai",
      directory: "tea-app-im",
      branch: "feature/new",
    });
    assert.equal(result.ok, false);
    assert.match(result.reason ?? "", /git refused/);
  });

  it("says when the folder is not in the feature", async () => {
    const { deps } = harness({ member: undefined });
    const result = await renameFeatureMemberBranch(deps, {
      featureId: "f_ai",
      directory: "nope",
      branch: "feature/new",
    });
    assert.equal(result.ok, false);
    assert.match(result.reason ?? "", /No repository folder/);
  });
});
