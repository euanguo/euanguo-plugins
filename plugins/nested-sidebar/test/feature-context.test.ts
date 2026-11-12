import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  mergeAgentsFile,
  renderFeatureSummary,
  renderManagedBlock,
  renderManifest,
  userNotesOf,
  type FeatureContext,
} from "../lib/feature-context.ts";
import { EMPTY_BRIEF } from "../lib/feature-meta.ts";

const context = (members: FeatureContext["members"] = []): FeatureContext => ({
  id: "f_1",
  name: "AI 语音",
  slug: "ai-voice",
  suggestedBranch: "feat/ai-voice",
  members,
});

describe("the AGENTS.md a feature folder carries", () => {
  it("starts a new file with Nest's block and an empty notes section", () => {
    const file = mergeAgentsFile(null, renderManagedBlock(context()));
    assert.match(file, /<!-- nest:begin/u);
    assert.match(file, /<!-- nest:end -->/u);
    assert.match(file, /## Notes/u);
    assert.match(file, /feat\/ai-voice/u);
    assert.match(file, /git -C <folder>/u);
  });

  /** The point of the markers: everything the person wrote survives a rewrite. */
  it("replaces only its own block and keeps every line outside it", () => {
    const first = mergeAgentsFile(null, renderManagedBlock(context()));
    const edited = `Intro the user wrote.\n\n${first}\n- decided: use the new billing API\n`;
    const next = mergeAgentsFile(
      edited,
      renderManagedBlock(
        context([{ directory: "tea-app-im", repository: "tea-app-im", branch: "feat/ai-voice", install: "pnpm install" }]),
      ),
    );
    assert.ok(next.startsWith("Intro the user wrote."));
    assert.match(next, /decided: use the new billing API/u);
    assert.match(next, /`tea-app-im\/`/u);
    assert.match(next, /pnpm install/u);
    assert.equal(next.match(/nest:begin/gu)?.length, 1);
  });

  it("puts its block above a file a person wrote without markers", () => {
    const next = mergeAgentsFile("# My plan\n", renderManagedBlock(context()));
    assert.ok(next.indexOf("nest:begin") < next.indexOf("# My plan"));
  });

  it("reads back what the person wrote, without Nest's block or placeholder", () => {
    const fresh = mergeAgentsFile(null, renderManagedBlock(context()));
    assert.equal(userNotesOf(fresh), "");
    assert.equal(userNotesOf(`${fresh}\nship by Friday\n`), "ship by Friday");
  });

  it("writes the same members into the manifest", () => {
    const manifest = JSON.parse(
      renderManifest(context([{ directory: "buy", repository: "tea-app-im-buy", branch: null, install: null }])),
    ) as { slug: string; members: { directory: string; branch: string | null }[] };
    assert.equal(manifest.slug, "ai-voice");
    assert.deepEqual(manifest.members, [{ directory: "buy", repository: "tea-app-im-buy", branch: null }]);
  });

  it("carries the requirement and the decisions that stand inside its block", () => {
    const summary = renderFeatureSummary({
      brief: {
        ...EMPTY_BRIEF,
        goal: "Ship the new billing flow",
        acceptance: "The old endpoint still works",
        openQuestions: ["Which region first?"],
      },
      refs: [
        {
          id: "r_1",
          featureId: "f_1",
          kind: "ticket",
          refId: "1020",
          url: "https://issues.example.com/1",
          title: "Billing story",
          createdAt: 1,
        },
      ],
      decisions: [
        {
          id: "d_1",
          featureId: "f_1",
          seq: 1,
          title: "Keep the old endpoint",
          choice: "For one release",
          rationale: "Existing callers need time",
          alternativesRejected: ["Remove it now"],
          impact: "",
          status: "confirmed",
          author: "human",
          threadId: null,
          supersedes: null,
          supersededBy: null,
          createdAt: 1,
        },
      ],
    });
    const file = mergeAgentsFile(
      null,
      renderManagedBlock({ ...context(), summary }),
    );
    assert.match(file, /## What this work is for/u);
    assert.match(file, /Ship the new billing flow/u);
    assert.match(file, /## Decisions that stand/u);
    assert.match(file, /#1 Keep the old endpoint/u);
    assert.ok(
      file.indexOf("What this work is for") <
        file.indexOf("## Rules for working here"),
    );
  });

  it("cannot be closed early by text someone recorded", () => {
    const summary = renderFeatureSummary({
      brief: {
        ...EMPTY_BRIEF,
        goal: "<!-- nest:end -->",
        acceptance: "",
      },
      refs: [],
      decisions: [],
    });
    const file = mergeAgentsFile(
      null,
      renderManagedBlock({ ...context(), summary }),
    );
    // The real end marker, and only the real one.
    assert.equal(file.match(/nest:end -->/gu)?.length, 1);
    assert.match(file, /&lt;!-- nest:end --&gt;/u);
  });
});
