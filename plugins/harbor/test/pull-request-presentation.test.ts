import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pullRequestPresentation } from "../lib/domain/pull-request-presentation.ts";

describe("pullRequestPresentation", () => {
  it("gives terminal states precedence over stale attention", () => {
    assert.deepEqual(
      pullRequestPresentation({ state: "merged", attention: "checks_failed" }),
      {
        label: "MERGED",
        icon: "GitMerge",
        tone: "merged",
        colorRole: "merged",
      },
    );
    assert.deepEqual(
      pullRequestPresentation({ state: "closed", attention: "ready_to_merge" }),
      {
        label: "CLOSED",
        icon: "GitPullRequestClosed",
        tone: "closed",
        colorRole: "closed",
      },
    );
    assert.deepEqual(
      pullRequestPresentation({ state: "draft", attention: "none" }),
      {
        label: "DRAFT",
        icon: "GitPullRequestDraft",
        tone: "muted",
        colorRole: "draft",
      },
    );
  });

  it("maps open pull request attention into compact semantic states", () => {
    const cases = [
      ["changes_requested", "CHANGES", "destructive", "CircleX", "blocked"],
      ["blocked", "BLOCKED", "destructive", "CircleX", "blocked"],
      ["checks_failed", "BLOCKED", "destructive", "CircleX", "blocked"],
      ["conflicts", "BLOCKED", "destructive", "CircleX", "blocked"],
      ["checks_pending", "CHECKS", "warning", "Circle", "checks"],
      ["review_requested", "IN REVIEW", "primary", "Eye", "review"],
      ["ready_to_merge", "READY", "success", "Check", "ready"],
      ["none", "OPEN", "muted", "GitPullRequest", "draft"],
    ] as const;

    for (const [attention, label, tone, icon, colorRole] of cases) {
      const presentation = pullRequestPresentation({
        state: "open",
        attention,
      });
      assert.equal(presentation.label, label);
      assert.equal(presentation.tone, tone);
      assert.equal(presentation.icon, icon);
      assert.equal(presentation.colorRole, colorRole);
    }
  });
});
