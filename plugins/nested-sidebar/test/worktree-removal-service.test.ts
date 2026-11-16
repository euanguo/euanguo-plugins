import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { worktreePlanDigest, type WorktreeSurvey } from "../lib/domain/worktree-removal.ts";
import { createWorktreeRemovalService } from "../server/worktree-removal-service.ts";

const PATH = "/Users/example/worktrees/example-repo/sc-cooled-helium-e50f";

function survey(overrides: Partial<WorktreeSurvey> = {}): WorktreeSurvey {
  return {
    path: PATH,
    hostId: "host_fixture",
    branch: "feat/before-callback-billing",
    bbOwned: true,
    gitWorktree: true,
    directoryExists: true,
    mainRepoPath: "/Users/example/Documents/Code/example-repo",
    changedFiles: 0,
    untrackedFiles: 0,
    aheadCommits: 0,
    baseRef: "origin/master",
    threads: 1,
    liveThreads: 0,
    openTerminals: 0,
    ...overrides,
  };
}

describe("worktree removal service", () => {
  it("proceeds when the second survey still matches the inspected plan", async () => {
    const clean = survey();
    const surveys = [clean, survey()];
    const calls = {
      archive: 0,
      release: 0,
      removeDirectory: 0,
      invalidate: 0,
    };
    const removal = createWorktreeRemovalService({
      bb: {
        sdk: {
          environments: {
            archiveThreads: async () => {
              calls.archive += 1;
            },
            delete: async () => {
              calls.release += 1;
            },
          },
        },
      } as unknown as BbPluginApi,
      surveyWorktree: async () => {
        const next = surveys.shift();
        assert.ok(next, "the fake survey ran out before the service finished");
        return next;
      },
      removeWorktreeDirectory: async () => {
        calls.removeDirectory += 1;
        return { directory: "removed", message: null };
      },
      invalidateFacts: () => {
        calls.invalidate += 1;
      },
    });
    const outcome = await removal.remove({
      environmentId: "env_1",
      deleteDirectory: true,
      acknowledged: true,
      expectedDigest: worktreePlanDigest(clean),
    });

    assert.deepEqual(outcome, {
      ok: true,
      code: null,
      archivedThreads: true,
      environmentRemoved: true,
      directory: "removed",
      message: null,
    });
    assert.deepEqual(calls, {
      archive: 1,
      release: 1,
      removeDirectory: 1,
      invalidate: 1,
    });
    assert.equal(surveys.length, 1, "the service surveys only once per removal");
  });

  it("refuses changed work without archiving, releasing, or touching disk", async () => {
    const clean = survey();
    let surveyCalls = 0;
    const calls = {
      archive: 0,
      release: 0,
      removeDirectory: 0,
      invalidate: 0,
    };
    const removal = createWorktreeRemovalService({
      bb: {
        sdk: {
          environments: {
            archiveThreads: async () => {
              calls.archive += 1;
            },
            delete: async () => {
              calls.release += 1;
            },
          },
        },
      } as unknown as BbPluginApi,
      surveyWorktree: async () => {
        surveyCalls += 1;
        return survey({ changedFiles: 1 });
      },
      removeWorktreeDirectory: async () => {
        calls.removeDirectory += 1;
        return { directory: "removed", message: null };
      },
      invalidateFacts: () => {
        calls.invalidate += 1;
      },
    });

    const outcome = await removal.remove({
      environmentId: "env_1",
      deleteDirectory: true,
      acknowledged: true,
      expectedDigest: worktreePlanDigest(clean),
    });

    assert.deepEqual(outcome, {
      ok: false,
      code: "changed",
      archivedThreads: false,
      environmentRemoved: false,
      directory: "kept",
      message:
        "The workspace changed after you inspected it. Review it again before removing anything.",
    });
    assert.deepEqual(calls, {
      archive: 0,
      release: 0,
      removeDirectory: 0,
      invalidate: 0,
    });
    assert.equal(surveyCalls, 1, "the service surveys only once per removal");
  });
});
