import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";

import { createFeatureMetaStore } from "../lib/feature-meta-store.ts";
import { FEATURE_MIGRATIONS, createFeatureStore } from "../lib/feature-store.ts";

function createStore() {
  const db = new Database(":memory:");
  for (const statement of FEATURE_MIGRATIONS) db.exec(statement);
  return { db, store: createFeatureMetaStore(db) };
}

const ref = {
  kind: "ticket" as const,
  refId: "1020",
  url: "https://issues.example.com/1",
  title: "Billing story",
};

const decision = (title: string) => ({
  title,
  choice: "Do it",
  rationale: "Because the old endpoint is going away",
  alternativesRejected: ["Keep it"],
  impact: "One release",
  supersedes: null,
});

describe("the feature metadata store", () => {
  it("round-trips a brief and its lists", () => {
    const { db, store } = createStore();
    try {
      assert.deepEqual(store.brief("f_1").openQuestions, []);
      store.setBrief("f_1", {
        goal: "Ship it",
        nonGoals: "",
        acceptance: "Works",
        notes: "n",
        openQuestions: ["Which region?"],
        blockers: ["Approval"],
      });
      const brief = store.brief("f_1");
      assert.equal(brief.goal, "Ship it");
      assert.deepEqual(brief.openQuestions, ["Which region?"]);
      assert.deepEqual(brief.blockers, ["Approval"]);
      assert.notEqual(brief.updatedAt, null);
    } finally {
      db.close();
    }
  });

  it("adds and removes references", () => {
    const { db, store } = createStore();
    try {
      const added = store.addRef("f_1", ref);
      assert.equal(added?.kind, "ticket");
      assert.equal(store.refs("f_1").length, 1);
      assert.equal(store.removeRef("f_1", added?.id ?? ""), true);
      assert.deepEqual(store.refs("f_1"), []);
    } finally {
      db.close();
    }
  });

  it("numbers decisions per feature and only lets a draft be deleted", () => {
    const { db, store } = createStore();
    try {
      const first = store.addDecision({
        featureId: "f_1",
        decision: decision("First"),
        status: "confirmed",
        author: "human",
        threadId: null,
      });
      const second = store.addDecision({
        featureId: "f_1",
        decision: decision("Second"),
        status: "draft",
        author: "agent",
        threadId: "thr_1",
      });
      assert.equal(first?.seq, 1);
      assert.equal(second?.seq, 2);
      assert.equal(store.addDecision({
        featureId: "f_2",
        decision: decision("Other feature"),
        status: "confirmed",
        author: "human",
        threadId: null,
      })?.seq, 1);

      assert.equal(store.removeDraft("f_1", first?.id ?? ""), false);
      assert.equal(store.removeDraft("f_1", second?.id ?? ""), true);
      assert.deepEqual(store.decisions("f_1").map((entry) => entry.seq), [1]);
      assert.equal(store.decisions("f_1")[0]?.threadId, null);
    } finally {
      db.close();
    }
  });

  it("supersedes a standing decision and refuses a second successor", () => {
    const { db, store } = createStore();
    try {
      const first = store.addDecision({
        featureId: "f_1",
        decision: decision("First"),
        status: "confirmed",
        author: "human",
        threadId: null,
      });
      const replacement = store.addDecision({
        featureId: "f_1",
        decision: { ...decision("Replacement"), supersedes: 1 },
        status: "confirmed",
        author: "human",
        threadId: null,
      });
      assert.equal(replacement?.seq, 2);
      const updated = store.decisions("f_1");
      assert.equal(updated[0]?.status, "superseded");
      assert.equal(updated[0]?.supersededBy, 2);
      assert.equal(updated[1]?.supersedes, 1);

      // The first decision already has a successor, so nothing may supersede it again.
      assert.equal(
        store.addDecision({
          featureId: "f_1",
          decision: { ...decision("Second replacement"), supersedes: 1 },
          status: "confirmed",
          author: "human",
          threadId: null,
        }),
        null,
      );
      assert.equal(first?.status, "confirmed");
    } finally {
      db.close();
    }
  });

  it("applies a draft's supersede only when it is confirmed", () => {
    const { db, store } = createStore();
    try {
      const first = store.addDecision({
        featureId: "f_1",
        decision: decision("First"),
        status: "confirmed",
        author: "human",
        threadId: null,
      });
      const draft = store.addDecision({
        featureId: "f_1",
        decision: { ...decision("Changed my mind"), supersedes: 1 },
        status: "draft",
        author: "agent",
        threadId: "thr_1",
      });
      assert.equal(store.decisions("f_1")[0]?.status, "confirmed");
      assert.equal(store.confirmDecision("f_1", draft?.id ?? ""), true);
      const after = store.decisions("f_1");
      assert.equal(after[0]?.status, "superseded");
      assert.equal(after[0]?.supersededBy, 2);
      assert.equal(after[1]?.status, "confirmed");
      assert.equal(store.confirmDecision("f_1", draft?.id ?? ""), false);
      assert.equal(first?.seq, 1);
    } finally {
      db.close();
    }
  });

  it("drops the brief, references and decisions with the feature", () => {
    const db = new Database(":memory:");
    try {
      for (const statement of FEATURE_MIGRATIONS) db.exec(statement);
      const features = createFeatureStore(db);
      const meta = createFeatureMetaStore(db);
      features.create({
        id: "f_1",
        name: "One",
        slug: "one",
        rootPath: "/features/one",
        hostId: "host_1",
      });
      meta.setBrief("f_1", {
        goal: "g",
        nonGoals: "",
        acceptance: "",
        notes: "",
        openQuestions: [],
        blockers: [],
      });
      meta.addRef("f_1", ref);
      meta.addDecision({
        featureId: "f_1",
        decision: decision("First"),
        status: "confirmed",
        author: "human",
        threadId: null,
      });

      assert.equal(features.remove("f_1"), true);
      assert.deepEqual(meta.refs("f_1"), []);
      assert.deepEqual(meta.decisions("f_1"), []);
      assert.equal(meta.brief("f_1").goal, "");
    } finally {
      db.close();
    }
  });
});
