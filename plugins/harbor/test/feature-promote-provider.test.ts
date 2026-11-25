import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import { FEATURE_REPOSITORY_MIGRATIONS } from "../lib/stores/feature-repository.ts";
import { createFeatureStore } from "../lib/stores/feature-store.ts";
import { createHarborEnvironmentProvider } from "../server/feature/environment-provider.ts";
import { createFeaturePromoter } from "../server/feature/promote.ts";

describe("feature promotion and native harbor-multi-repo environment provider", () => {
  it("promotes a single worktree to a feature while preserving its environment adoption", async () => {
    const db = new Database(":memory:");
    for (const sql of FEATURE_REPOSITORY_MIGRATIONS) db.exec(sql);
    const store = createFeatureStore(db);

    const calls: string[] = [];
    const promoter = createFeaturePromoter({
      bb: {
        sdk: {
          environments: {
            get: async ({ environmentId }: { environmentId: string }) => ({
              id: environmentId,
              hostId: "host_a",
              path: "/repos/worktrees/acme-web-wt",
              branchName: "feat/pay-v2",
            }),
          },
        },
      } as never,
      store,
      refLinks: { list: () => [], add: () => null, remove: () => false, deleteForFeature: () => {} },
      call: async (method) => {
        calls.push(String(method));
        return { status: "ok" } as never;
      },
      ensureDirectory: async () => undefined,
      featuresFolderOf: async () => "/repos/harbor-features",
      addRepositories: async ({ featureId, baseBranch, repositories }) => {
        calls.push(`add:${featureId}:${baseBranch ?? ""}:${repositories.length}`);
        return repositories.map((repo) => ({
          projectId: repo.projectId,
          repository: "acme-api",
          outcome: "created" as const,
          path: "/repos/harbor-features/pay-v2/acme-api",
          branch: repo.branch ?? "feat/pay-v2",
          role: repo.role ?? "worktree",
          setup: [],
          reason: null,
        }));
      },
      refresh: async () => ({
        features: store.list(),
        adoptions: store.adoptions(),
        members: [],
        refLinks: [],
        homeProjects: {},
        featureProjectIds: [],
        memberScanFailures: [],
        meta: {},
      }),
      writeContext: async () => true,
      membersOf: () => [],
      publish: () => calls.push("publish"),
      invalidate: () => calls.push("invalidate"),
    });

    const promoted = await promoter.promoteToFeature({
      environmentId: "env_wt_1",
      name: "Pay V2 Rollout",
      baseBranch: "main",
      additionalRepositories: [{ projectId: "prj_api" }],
    });
    assert.equal(promoted.feature.slug, "pay-v2-rollout");
    assert.equal(promoted.adoptedEnvironmentId, "env_wt_1");
    assert.equal(store.adoptions().env_wt_1, promoted.feature.id);
    assert.equal(promoted.repositories[0]?.branch, "feat/pay-v2");
    assert.ok(calls.includes("linkFeatureReference"));
    assert.ok(calls.includes("publish"));

    // Refuses promoting an environment that already sits inside a feature root.
    const insidePromoter = createFeaturePromoter({
      bb: {
        sdk: {
          environments: {
            get: async () => ({
              id: "env_inside",
              hostId: "host_a",
              path: "/repos/harbor-features/pay-v2-rollout/acme-api",
              branchName: "feat/pay-v2",
            }),
          },
        },
      } as never,
      store,
      refLinks: { list: () => [], add: () => null, remove: () => false, deleteForFeature: () => {} },
      call: async () => ({ status: "ok" }) as never,
      ensureDirectory: async () => undefined,
      featuresFolderOf: async () => "/repos/harbor-features",
      addRepositories: async () => [],
      refresh: async () => ({
        features: store.list(),
        adoptions: store.adoptions(),
        members: [],
        refLinks: [],
        homeProjects: {},
        featureProjectIds: [],
        memberScanFailures: [],
        meta: {},
      }),
      writeContext: async () => true,
      membersOf: () => [],
      publish: () => {},
      invalidate: () => {},
    });
    await assert.rejects(
      () => insidePromoter.promoteToFeature({ environmentId: "env_inside", name: "Dup" }),
      /already lives inside feature/u,
    );
  });

  it("registers harbor-multi-repo provider with null retireGraceMs and per-thread paths", async () => {
    const db = new Database(":memory:");
    for (const sql of FEATURE_REPOSITORY_MIGRATIONS) db.exec(sql);
    const store = createFeatureStore(db);
    store.create({
      id: "f_existing",
      name: "Existing Feature",
      slug: "existing-feature",
      rootPath: "/repos/harbor-features/existing-feature",
      hostId: "host_a",
    });

    const provider = createHarborEnvironmentProvider({
      store,
      createFeature: async ({ name }) => ({
        feature: {
          id: "f_new",
          name,
          slug: "new-feature",
          state: "active",
          position: 0,
          rootPath: "/repos/harbor-features/new-feature",
          hostId: "host_a",
        },
        repositories: [
          {
            projectId: "prj_web",
            repository: "acme-web",
            outcome: "created",
            path: "/repos/harbor-features/new-feature/acme-web",
            branch: "feat/new-feature",
            role: "worktree",
            setup: [],
            reason: null,
          },
        ],
      }),
      addRepositories: async () => [],
    });

    assert.equal(provider.id, "harbor-multi-repo");
    assert.equal(provider.policy.retireGraceMs, null);
    assert.equal(provider.policy.pathKeys, "per-thread");

    assert.equal(
      provider.availability({ host: { status: "disconnected", name: "mac-mini" } } as never).status,
      "unavailable",
    );
    assert.equal(
      provider.availability({ host: { status: "connected", name: "mac-mini" } } as never).status,
      "available",
    );
    assert.equal(
      provider.experimental_existingPath({ featureId: "f_existing" }),
      "/repos/harbor-features/existing-feature",
    );
    assert.equal(
      provider.validate({ inputs: { featureId: "f_missing" } } as never).action,
      "refuse",
    );

    const steps: string[] = [];
    const logs: string[] = [];
    const claimed: string[] = [];
    const created = await provider.create({
      inputs: { featureName: "Multi Checkout" },
      project: { id: "prj_web", name: "acme-web", kind: "standard" },
      thread: { title: "Implement sync" },
      suggestedBranchName: "feat/sync",
      report: {
        step: (msg: string) => steps.push(msg),
        log: (msg: string) => logs.push(msg),
      },
      experimental_claimPath: async (dir: string) => {
        claimed.push(dir);
      },
    } as never);

    assert.equal(created.status, "created");
    if (created.status === "created") {
      assert.equal(created.path, "/repos/harbor-features/new-feature");
      assert.equal(created.ownsPath, false);
    }
    assert.deepEqual(claimed, ["/repos/harbor-features/new-feature"]);
    assert.ok(steps.some((step) => step.includes("Creating multi-repo feature")));
    assert.ok(logs.some((line) => line.includes("acme-web: created")));

    const removed = await provider.remove({} as never);
    assert.equal(removed.status, "removed");
  });
});
