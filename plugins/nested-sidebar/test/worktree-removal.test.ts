import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  planWorktreeRemoval,
  removalSubmissionBlocker,
  type WorktreeSurvey,
} from "../lib/worktree-removal.ts";

const PATH = "/Users/example/worktrees/example-repo/sc-cooled-helium-e50f";

/** An attached, bb-unowned worktree with nothing to lose. */
function survey(overrides: Partial<WorktreeSurvey> = {}): WorktreeSurvey {
  return {
    path: PATH,
    hostId: "host_fixture",
    branch: "feat/before-callback-billing",
    bbOwned: false,
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

const kinds = (plan: ReturnType<typeof planWorktreeRemoval>) =>
  plan.directory.warnings.map((warning) => warning.kind);

describe("planWorktreeRemoval", () => {
  it("removes a worktree through git when bb knows the repository", () => {
    const plan = planWorktreeRemoval(survey());
    assert.equal(plan.directory.via, "git");
    assert.equal(plan.directory.refusal, null);
    // bb did not create it, so the tool that did keeps a stale row.
    assert.deepEqual(kinds(plan), ["external"]);
  });

  it("falls back to a plain delete without the main repository", () => {
    const plan = planWorktreeRemoval(survey({ mainRepoPath: null }));
    assert.equal(plan.directory.via, "delete");
  });

  it("names what the directory step is about to lose", () => {
    const plan = planWorktreeRemoval(
      survey({ changedFiles: 3, untrackedFiles: 1, aheadCommits: 2 }),
    );
    assert.deepEqual(kinds(plan), ["discard", "discard", "discard", "external"]);
    assert.deepEqual(
      plan.directory.warnings.map((warning) => warning.text),
      [
        "3 changed files will be lost",
        "1 untracked file will be lost",
        "2 commits not on origin/master will be lost",
      ].concat(
        "bb did not create this directory, so the tool that did will still list it",
      ),
    );
  });

  it("counts one file as one", () => {
    const plan = planWorktreeRemoval(survey({ changedFiles: 1, aheadCommits: 1 }));
    assert.equal(plan.directory.warnings[0]?.text, "1 changed file will be lost");
    assert.equal(
      plan.directory.warnings[1]?.text,
      "1 commit not on origin/master will be lost",
    );
  });

  it("calls a base branch it does not know the base branch", () => {
    const plan = planWorktreeRemoval(survey({ aheadCommits: 1, baseRef: null }));
    assert.equal(
      plan.directory.warnings[0]?.text,
      "1 commit not on the base branch will be lost",
    );
  });

  it("warns that open terminals are still holding the directory", () => {
    const plan = planWorktreeRemoval(survey({ openTerminals: 2 }));
    assert.equal(plan.directory.warnings[0]?.kind, "in-use");
    assert.equal(
      plan.directory.warnings[0]?.text,
      "2 terminals are still open here",
    );
  });

  it("refuses the project's own checkout", () => {
    const plan = planWorktreeRemoval(survey({ gitWorktree: false }));
    assert.equal(
      plan.directory.refusal,
      "This is the project's own checkout, not a worktree.",
    );
  });

  it("refuses a directory that is already gone", () => {
    const plan = planWorktreeRemoval(survey({ directoryExists: false }));
    assert.equal(plan.directory.refusal, "The directory is already gone.");
  });

  it("counts the threads the first step archives", () => {
    const plan = planWorktreeRemoval(survey({ threads: 4, liveThreads: 2 }));
    assert.equal(plan.threadCount, 4);
    assert.equal(plan.liveThreadCount, 2);
  });
});

describe("removalSubmissionBlocker", () => {
  const plan = planWorktreeRemoval(survey({ changedFiles: 2 }));

  it("asks for nothing extra when the directory stays put", () => {
    assert.equal(
      removalSubmissionBlocker(plan, {
        deleteDirectory: false,
        acknowledged: false,
      }),
      null,
    );
  });

  it("asks for the one box, and only the one box, when the directory would go", () => {
    assert.equal(
      removalSubmissionBlocker(plan, {
        deleteDirectory: true,
        acknowledged: false,
      }),
      "acknowledgement",
    );
    assert.equal(
      removalSubmissionBlocker(plan, {
        deleteDirectory: true,
        acknowledged: true,
      }),
      null,
    );
  });

  it("asks for it even when there is nothing to lose", () => {
    // The box is what the step costs, not what the counts are: a clean worktree
    // still loses the directory, so the same box covers both.
    const clean = planWorktreeRemoval(survey({ bbOwned: true }));
    assert.deepEqual(clean.directory.warnings, []);
    assert.equal(
      removalSubmissionBlocker(clean, {
        deleteDirectory: true,
        acknowledged: false,
      }),
      "acknowledgement",
    );
    assert.equal(
      removalSubmissionBlocker(clean, {
        deleteDirectory: true,
        acknowledged: true,
      }),
      null,
    );
  });

  it("refuses a directory that must not be removed, acknowledged or not", () => {
    const checkout = planWorktreeRemoval(survey({ gitWorktree: false }));
    assert.equal(
      removalSubmissionBlocker(checkout, {
        deleteDirectory: true,
        acknowledged: true,
      }),
      "unavailable",
    );
  });

  it("ignores the acknowledgement a check left behind on the way out", () => {
    // Turning the directory step off again must not require unticking the box
    // to submit the reversible half.
    assert.equal(
      removalSubmissionBlocker(plan, {
        deleteDirectory: false,
        acknowledged: true,
      }),
      null,
    );
  });
});
