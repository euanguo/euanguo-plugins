import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EMPTY_BRIEF,
  EMPTY_BRIEF_DRAFT,
  MAX_BRIEF_ITEMS,
  activeDecisions,
  linesOf,
  neutralizeBlockMarkers,
  readBriefInput,
  readDecisionInput,
  readRefInput,
  refKindLabel,
  summaryOf,
  toBriefDraft,
  toBriefInput,
  type FeatureDecision,
} from "../lib/domain/feature-meta.ts";

describe("what a feature records", () => {
  it("cleans and bounds a brief", () => {
    const brief = readBriefInput({
      goal: "  Ship the new billing flow  ",
      nonGoals: "",
      acceptance: "Old endpoint still works",
      notes: "",
      openQuestions: "Which region?\n\nWhich region?\nWhen?",
      blockers: Array.from({ length: MAX_BRIEF_ITEMS + 5 }, (_, index) => `b${index}`),
    });
    assert.equal(brief.goal, "Ship the new billing flow");
    assert.deepEqual(brief.openQuestions, ["Which region?", "When?"]);
    assert.equal(brief.blockers.length, MAX_BRIEF_ITEMS);
  });

  it("keeps the kind the caller chose, and defaults to a plain link", () => {
    const ref = readRefInput({
      kind: "ticket",
      url: "https://issues.example.com/1",
      title: "Billing",
    });
    assert.equal(ref?.kind, "ticket");
    assert.equal(ref?.title, "Billing");

    assert.equal(
      readRefInput({ url: "https://example.com/x" })?.kind,
      "link",
    );
    assert.equal(readRefInput({ url: "not a url" }), null);
    assert.equal(readRefInput({ title: "nothing to follow" }), null);
  });

  it("requires a title and a choice for a decision, and bounds the rest", () => {
    assert.equal(readDecisionInput({ title: "T" }), null);
    assert.equal(readDecisionInput({ choice: "C" }), null);
    const decision = readDecisionInput({
      title: "  Use the old endpoint  ",
      choice: "Keep it for one release",
      alternatives: ["Rewrite now", "Rewrite now", "Do nothing"],
      supersedes: 3,
    });
    assert.equal(decision?.title, "Use the old endpoint");
    assert.deepEqual(decision?.alternativesRejected, ["Rewrite now", "Do nothing"]);
    assert.equal(decision?.supersedes, 3);
    assert.equal(readDecisionInput({ title: "T", choice: "C", supersedes: -1 })?.supersedes, null);
  });

  it("keeps the block markers out of user text", () => {
    assert.equal(
      neutralizeBlockMarkers("see <!-- harbor:end --> here"),
      "see &lt;!-- harbor:end --&gt; here",
    );
  });

  it("counts what still stands", () => {
    const decisions: FeatureDecision[] = [
      decision(1, "confirmed", null),
      decision(2, "confirmed", 3),
      decision(3, "draft", null),
    ];
    assert.deepEqual(activeDecisions(decisions).map((entry) => entry.seq), [1]);
    const summary = summaryOf({
      brief: { ...EMPTY_BRIEF, acceptance: "works" },
      refs: [],
      decisions,
    });
    assert.equal(summary.decisionCount, 3);
    assert.equal(summary.activeDecisionCount, 1);
    assert.equal(summary.draftCount, 1);
    assert.equal(summary.acceptanceSet, true);
  });

  it("turns a saved brief into textarea lines and back into lists", () => {
    const draft = toBriefDraft({
      ...EMPTY_BRIEF,
      goal: "Ship the billing flow",
      openQuestions: ["Which region?", "When?"],
      blockers: ["Waiting on the API"],
    });
    assert.deepEqual(draft, {
      goal: "Ship the billing flow",
      nonGoals: "",
      acceptance: "",
      notes: "",
      openQuestions: "Which region?\nWhen?",
      blockers: "Waiting on the API",
    });

    const input = toBriefInput(draft);
    assert.deepEqual(input.openQuestions, ["Which region?", "When?"]);
    assert.deepEqual(input.blockers, ["Waiting on the API"]);
    assert.deepEqual(toBriefInput(EMPTY_BRIEF_DRAFT), {
      goal: "",
      nonGoals: "",
      acceptance: "",
      notes: "",
      openQuestions: [],
      blockers: [],
    });
  });

  it("reads textarea lines, dropping blanks and surrounding space", () => {
    assert.deepEqual(linesOf("  a \n\n b\n"), ["a", "b"]);
    assert.deepEqual(linesOf("\n   \n"), []);
  });

  it("labels reference kinds", () => {
    assert.equal(refKindLabel("ticket"), "Ticket");
    assert.equal(refKindLabel("document"), "Doc");
    assert.equal(refKindLabel("link"), "Link");
  });
});

function decision(
  seq: number,
  status: FeatureDecision["status"],
  supersededBy: number | null,
): FeatureDecision {
  return {
    id: `d_${seq}`,
    featureId: "f_1",
    seq,
    title: `Decision ${seq}`,
    choice: "Do it",
    rationale: "",
    alternativesRejected: [],
    impact: "",
    status,
    author: "human",
    threadId: null,
    supersedes: null,
    supersededBy,
    createdAt: seq,
  };
}
