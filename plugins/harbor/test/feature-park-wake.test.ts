import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import { FEATURE_REPOSITORY_MIGRATIONS } from "../lib/stores/feature-repository.ts";
import { createFeatureStore } from "../lib/stores/feature-store.ts";
import { createFeatureParkController } from "../server/feature/park.ts";
import type { FeatureSnapshot } from "../server/feature/types.ts";

function setupDb() {
  const db = new Database(":memory:");
  for (const sql of FEATURE_REPOSITORY_MIGRATIONS) db.exec(sql);
  return db;
}

describe("feature Park and Wake lifecycle", () => {
  it("parks, filters due wakes, unparks, and clears metadata on restore", () => {
    const db = setupDb();
    const store = createFeatureStore(db);
    store.create({
      id: "f_checkout",
      name: "订单通知改造",
      slug: "order-notify",
      rootPath: "/repos/harbor-features/order-notify",
      hostId: "host_a",
    });

    const futureWake = Date.now() + 60_000;
    const pastWake = Date.now() - 5_000;

    assert.equal(
      store.park("f_checkout", {
        reason: "waiting-qa",
        note: "Waiting on integration staging deploy",
        wakeAt: pastWake,
        wakeOnActivity: true,
      }),
      true,
    );

    const parked = store.find("f_checkout");
    assert.ok(parked);
    assert.equal(parked.state, "parked");
    assert.equal(parked.parkedReason, "waiting-qa");
    assert.equal(parked.parkedNote, "Waiting on integration staging deploy");
    assert.equal(parked.wakeAt, pastWake);
    assert.equal(parked.wakeOnActivity, true);
    assert.ok(typeof parked.parkedAt === "number");

    assert.equal(store.dueParkedWakes(Date.now()).length, 1);
    assert.equal(store.unpark("f_checkout"), true);

    const restored = store.find("f_checkout");
    assert.ok(restored);
    assert.equal(restored.state, "active");
    assert.equal(restored.parkedAt, null);
    assert.equal(restored.parkedReason, null);
    assert.equal(restored.parkedNote, null);
    assert.equal(restored.wakeAt, null);
    assert.equal(restored.wakeOnActivity, false);

    // Park again with future wake: not due yet.
    store.park("f_checkout", { wakeAt: futureWake });
    assert.equal(store.dueParkedWakes(Date.now()).length, 0);
  });

  it("refuses parking archived features and auto-wakes on thread activity", async () => {
    const db = setupDb();
    const store = createFeatureStore(db);
    store.create({
      id: "f_active",
      name: "结算流程重构",
      slug: "settlement-flow",
      rootPath: "/repos/harbor-features/settlement-flow",
      hostId: "host_a",
    });
    store.create({
      id: "f_archived",
      name: "Done Feature",
      slug: "done-feature",
      rootPath: "/repos/harbor-features/done-feature",
      hostId: "host_a",
    });
    store.setState("f_archived", "archived");

    let publishes = 0;
    const invalidated: string[][] = [];
    const controller = createFeatureParkController({
      bb: {
        sdk: {
          threads: {
            get: async ({ threadId }: { threadId: string }) => ({
              id: threadId,
              environmentId: threadId === "thr_adopted" ? "env_adopted" : "env_inside",
            }),
          },
          environments: {
            get: async ({ environmentId }: { environmentId: string }) => ({
              id: environmentId,
              path:
                environmentId === "env_inside"
                  ? "/repos/harbor-features/settlement-flow/acme-web"
                  : "/repos/outside/acme-api",
            }),
          },
        },
      } as never,
      store,
      getCached: (): FeatureSnapshot => ({
        features: store.list(),
        adoptions: { env_adopted: "f_active" },
        members: [],
        refLinks: [],
        homeProjects: {},
        featureProjectIds: [],
        memberScanFailures: [],
        meta: {},
      }),
      refresh: async () => ({
        features: store.list(),
        adoptions: { env_adopted: "f_active" },
        members: [],
        refLinks: [],
        homeProjects: {},
        featureProjectIds: [],
        memberScanFailures: [],
        meta: {},
      }),
      publish: () => {
        publishes += 1;
      },
      invalidate: (tags) => {
        invalidated.push([...tags]);
      },
    });

    await assert.rejects(
      () => controller.park({ featureId: "f_archived", reason: "deferred" }),
      /Archived features must be reopened/u,
    );

    const parked = await controller.park({
      featureId: "f_active",
      reason: "waiting-backend",
      wakeOnActivity: true,
    });
    assert.equal(parked.state, "parked");

    // Thread inside feature wakes it automatically.
    await controller.handleThreadActivity("thr_inside");
    assert.equal(store.find("f_active")?.state, "active");

    // Adopted outside worktree thread also wakes a parked feature.
    await controller.park({ featureId: "f_active", wakeOnActivity: true });
    assert.equal(store.find("f_active")?.state, "parked");
    await controller.handleThreadActivity("thr_adopted");
    assert.equal(store.find("f_active")?.state, "active");

    // Due wake timer fires automatically when scheduled close to now.
    await controller.park({
      featureId: "f_active",
      wakeAt: Date.now() + 25,
    });
    assert.equal(store.find("f_active")?.state, "parked");
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(store.find("f_active")?.state, "active");
    assert.ok(publishes >= 4);
    assert.ok(invalidated.some((tags) => tags.includes("feature:f_active")));

    controller.dispose();
  });
});
