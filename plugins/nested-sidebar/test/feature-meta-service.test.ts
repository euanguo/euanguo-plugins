import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";

import { createFeatureMetaService } from "../server/feature-meta-service.ts";
import { createFeatureMetaStore, FEATURE_META_MIGRATIONS } from "../lib/feature-meta-store.ts";
import type { Feature } from "../lib/features.ts";

const FEATURE: Feature = {
  id: "f_1",
  name: "AI 语音",
  slug: "ai-voice",
  state: "active",
  position: 0,
  rootPath: "/features/ai-voice",
  hostId: "host_1",
};

function serviceWith() {
  const db = new Database(":memory:");
  for (const statement of FEATURE_META_MIGRATIONS) db.exec(statement);
  const metaStore = createFeatureMetaStore(db);
  const writes: string[] = [];
  const summaries: string[] = [];
  const service = createFeatureMetaService({
    metaStore,
    findFeature: (featureId) => (featureId === FEATURE.id ? FEATURE : undefined),
    membersOf: () => [],
    writeContext: async () => {
      writes.push("context");
      return true;
    },
    publish: () => writes.push("publish"),
    setSummary: (featureId) => summaries.push(featureId),
  });
  return { db, metaStore, service, writes, summaries };
}

const input = {
  featureId: "f_1",
  title: "Keep the old endpoint",
  choice: "For one release",
  rationale: "Callers need time",
  alternatives: ["Remove it now"],
  impact: "",
  supersedes: null,
  threadId: "thr_1",
};

describe("the feature metadata service", () => {
  it("rejects a feature that no longer exists", async () => {
    const { db, service } = serviceWith();
    try {
      assert.throws(() => service.meta("f_missing"), /no longer exists/u);
      await assert.rejects(
        service.setBrief("f_missing", {
          goal: "g",
          nonGoals: "",
          acceptance: "",
          notes: "",
          openQuestions: [],
          blockers: [],
        }),
        /no longer exists/u,
      );
    } finally {
      db.close();
    }
  });

  it("turns an agent's decision into a draft whatever it asked for", async () => {
    const { db, service, metaStore } = serviceWith();
    try {
      const decision = await service.addDecision({
        ...input,
        status: "confirmed",
        author: "agent",
      });
      assert.equal(decision.status, "draft");
      assert.equal(decision.author, "agent");
      assert.equal(metaStore.decisions("f_1")[0]?.status, "draft");
    } finally {
      db.close();
    }
  });

  it("writes the context and publishes after every change", async () => {
    const { db, service, writes, summaries } = serviceWith();
    try {
      await service.setBrief("f_1", {
        goal: "Ship it",
        nonGoals: "",
        acceptance: "",
        notes: "",
        openQuestions: [],
        blockers: [],
      });
      assert.deepEqual(writes, ["context", "publish"]);
      assert.deepEqual(summaries, ["f_1"]);
    } finally {
      db.close();
    }
  });

  it("refuses a supersede of a decision that already has a successor", async () => {
    const { db, service } = serviceWith();
    try {
      await service.addDecision({
        ...input,
        status: "confirmed",
        author: "human",
      });
      await service.addDecision({
        ...input,
        title: "Changed my mind",
        supersedes: 1,
        status: "confirmed",
        author: "human",
      });
      await assert.rejects(
        service.addDecision({
          ...input,
          title: "A third answer",
          supersedes: 1,
          status: "confirmed",
          author: "human",
        }),
        /already been superseded/u,
      );
    } finally {
      db.close();
    }
  });
});
