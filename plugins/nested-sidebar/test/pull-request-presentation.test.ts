import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import { pullRequestPresentation } from "../lib/pull-request-presentation.ts";

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
      ["checks_pending", "CHECKS", "warning", "Hourglass", "checks"],
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

const metadataSource = await readFile(
  new URL("../components/inbox/row-metadata.tsx", import.meta.url),
  "utf8",
);

describe("PR semantic icon surface", () => {
  it("uses the configured PR color for a visible tinted background", () => {
    assert.match(metadataSource, /data-nest-pr-state/);
    assert.match(metadataSource, /backgroundColor: `color-mix\(in srgb, \$\{semanticColor\} 24%/);
    assert.match(metadataSource, /--nest-pr-\$\{presentation\.colorRole\}/);
  });
});
