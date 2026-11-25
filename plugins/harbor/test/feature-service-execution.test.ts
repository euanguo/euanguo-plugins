import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import {
  createFeatureMetaStore,
} from "../lib/stores/feature-meta-store.ts";
import {
  createFeatureRepository,
  FEATURE_REPOSITORY_MIGRATIONS,
} from "../lib/stores/feature-repository.ts";
import { createFeatureStore } from "../lib/stores/feature-store.ts";
import { FEATURE_CHANNEL } from "../lib/realtime-channels.ts";
import {
  createFeatureService,
  FeatureError,
  type FeatureHost,
} from "../server/feature/service.ts";

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function openMemoryDb(): Database.Database {
  const db = new Database(":memory:");
  for (const sql of FEATURE_REPOSITORY_MIGRATIONS) db.exec(sql);
  return db;
}

function createHarness() {
  const db = openMemoryDb();
  const store = createFeatureStore(db);
  const metaStore = createFeatureMetaStore(db);
  const repository = createFeatureRepository(db, metaStore);

  const calls: { method: string; input: unknown }[] = [];
  const publishes: string[] = [];
  let scanImpl: (input: { roots: readonly string[] }) => Promise<unknown> = async ({
    roots,
  }) => ({
    results: roots.map((root) => ({ root, members: [] })),
  });
  let writeContextImpl: (input: unknown) => Promise<unknown> = async () => ({
    status: "ok",
  });
  let archiveShouldFail = false;
  let envList: { id: string; path: string | null }[] = [];

  const host: FeatureHost = {
    async call(method, input) {
      calls.push({ method, input });
      switch (method) {
        case "readHomeDirectory":
          return { home: "/Users/example" };
        case "readDataDirectory":
          return { dataDir: "/Users/example/.bb" };
        case "ensureFeatureDirectory":
          return { status: "ok" };
        case "writeFeatureContext":
          return writeContextImpl(input);
        case "scanFeatureDirectories":
          return scanImpl(input as { roots: readonly string[] });
        case "probeFeatureWorktree":
          return {
            status: "ok",
            repository: true,
            mainWorktree: true,
            mainRepoPath: "/work/acme-app",
            worktrees: [],
            branchExists: false,
            targetExists: false,
            defaultBase: "main",
          };
        case "createFeatureWorktree":
          return {
            status: "created",
            path: "/Users/example/.bb/harbor-features/alpha-work/acme-app",
            branch: "feat/alpha-work",
            base: "main",
            setup: [],
          };
        case "inspectFeatureWorktrees": {
          const paths = (input as { paths: readonly string[] }).paths;
          return {
            worktrees: paths.map((entry) => ({
              path: entry,
              changedFiles: 0,
              untrackedFiles: 0,
              aheadCommits: 0,
              missing: false,
            })),
          };
        }
        case "removeWorktree":
          return { status: "removed" };
        case "deleteFeatureBranch":
          return { status: "deleted" };
        case "removeFeatureDirectory":
          return { status: "removed" };
        default:
          throw new Error(`Unexpected host call: ${method}`);
      }
    },
  };

  const bb = {
    log: {
      warn() {},
    },
    realtime: {
      publish(channel: string) {
        publishes.push(channel);
      },
    },
    sdk: {
      hosts: {
        async list() {
          return [{ id: "host_1", status: "connected" }];
        },
      },
      projects: {
        async list() {
          return [
            {
              id: "proj_features",
              name: "Features",
              sources: [
                {
                  type: "local_path",
                  hostId: "host_1",
                  path: "/Users/example/.bb/harbor-features",
                },
              ],
            },
          ];
        },
        async create() {
          return { id: "proj_features" };
        },
      },
      environments: {
        async list() {
          return envList;
        },
        async archiveThreads() {
          if (archiveShouldFail) {
            throw new Error("bb archive refused");
          }
          return { archivedThreadIds: ["thr_1"] };
        },
      },
      threads: {
        async list() {
          return [{ id: "thr_1" }];
        },
      },
    },
  } as unknown as BbPluginApi;

  const service = createFeatureService({
    bb,
    store,
    metaStore,
    repository,
    host,
    projectSource: async (projectId) =>
      projectId === "proj_app"
        ? { path: "/work/acme-app", hostId: "host_1" }
        : null,
  });

  return {
    db,
    store,
    service,
    calls,
    publishes,
    countCalls: (method: string) =>
      calls.filter((entry) => entry.method === method).length,
    setScanImpl: (next: typeof scanImpl) => {
      scanImpl = next;
    },
    setWriteContextImpl: (next: typeof writeContextImpl) => {
      writeContextImpl = next;
    },
    setArchiveShouldFail: (fail: boolean) => {
      archiveShouldFail = fail;
    },
    setEnvList: (next: typeof envList) => {
      envList = next;
    },
  };
}

describe("feature service execution", () => {
  it("coalesces concurrent refresh() calls and keeps refresh() pure of context/dir writes", async () => {
    const harness = createHarness();
    try {
      const feature = harness.store.create({
        id: "f_alpha",
        name: "Alpha Work",
        slug: "alpha-work",
        rootPath: "/Users/example/.bb/harbor-features/alpha-work",
        hostId: "host_1",
      });
      assert.ok(feature);

      const gate = deferred<{
        results: {
          root: string;
          members: {
            directory: string;
            repository: string;
            repositoryPath: string;
            branch: string | null;
            path: string;
          }[];
        }[];
      }>();
      harness.setScanImpl(() => gate.promise);

      const pending = Promise.all([
        harness.service.refresh(),
        harness.service.refresh(),
        harness.service.refresh(),
      ]);
      // Allow all queued microtasks to settle onto the single scan.
      await Promise.resolve();
      await Promise.resolve();

      gate.resolve({
        results: [
          {
            root: "/Users/example/.bb/harbor-features/alpha-work",
            members: [
              {
                directory: "acme-app",
                repository: "acme-app",
                repositoryPath: "/work/acme-app",
                branch: "feat/alpha-work",
                path: "/Users/example/.bb/harbor-features/alpha-work/acme-app",
              },
            ],
          },
        ],
      });

      const [first, second, third] = await pending;
      assert.equal(harness.countCalls("scanFeatureDirectories"), 1);
      assert.strictEqual(first, second);
      assert.strictEqual(second, third);
      assert.equal(first.members.length, 1);

      // refresh() itself must never invoke ensureFeatureDirectory or writeFeatureContext.
      assert.equal(harness.countCalls("ensureFeatureDirectory"), 0);
      assert.equal(harness.countCalls("writeFeatureContext"), 0);
    } finally {
      harness.db.close();
    }
  });

  it("dedupes concurrent syncContextFiles() per feature and caches successful writes", async () => {
    const harness = createHarness();
    try {
      harness.store.create({
        id: "f_sync",
        name: "Sync Work",
        slug: "sync-work",
        rootPath: "/Users/example/.bb/harbor-features/sync-work",
        hostId: "host_1",
      });
      await harness.service.refresh();

      const gate = deferred<{ status: string }>();
      harness.setWriteContextImpl(() => gate.promise);

      const concurrent = Promise.all([
        harness.service.syncContextFiles(),
        harness.service.syncContextFiles(),
      ]);
      await Promise.resolve();
      gate.resolve({ status: "ok" });
      await concurrent;

      assert.equal(harness.countCalls("writeFeatureContext"), 1);

      // Subsequent syncContextFiles() calls skip already-written active features.
      await harness.service.syncContextFiles();
      assert.equal(harness.countCalls("writeFeatureContext"), 1);
    } finally {
      harness.db.close();
    }
  });

  it("drives create -> addRepositories -> survey -> finish -> reopen -> remove with failure guards", async () => {
    const harness = createHarness();
    try {
      let memberPresent = false;
      harness.setScanImpl(async ({ roots }) => ({
        results: roots.map((root) => ({
          root,
          members: memberPresent
            ? [
                {
                  directory: "acme-app",
                  repository: "acme-app",
                  repositoryPath: "/work/acme-app",
                  branch: "feat/alpha-work",
                  path: "/Users/example/.bb/harbor-features/alpha-work/acme-app",
                },
              ]
            : [],
        })),
      }));

      const created = await harness.service.create({
        name: "Alpha Work",
        slug: "alpha-work",
        repositories: [],
      });
      assert.equal(created.feature.state, "active");
      assert.equal(harness.countCalls("ensureFeatureDirectory"), 1);
      assert.equal(harness.countCalls("writeFeatureContext"), 1);
      assert.ok(harness.publishes.includes(FEATURE_CHANNEL));

      memberPresent = true;
      harness.setEnvList([
        {
          id: "env_member_1",
          path: "/Users/example/.bb/harbor-features/alpha-work/acme-app",
        },
      ]);

      const added = await harness.service.addRepositories({
        featureId: created.feature.id,
        repositories: [{ projectId: "proj_app", branch: null }],
      });
      assert.equal(added.length, 1);
      assert.equal(added[0]?.outcome, "created");
      assert.equal(harness.service.snapshot().members.length, 1);
      assert.equal(harness.service.createdBranchCount(created.feature.id), 1);

      const surveyed = await harness.service.survey(created.feature.id, {
        deletesBranches: false,
      });
      assert.equal(surveyed.members.length, 1);
      assert.equal(surveyed.threadCount, 1);
      assert.equal(surveyed.requiresConfirmation, false);

      // Refuses finish without altering state when archiving fails.
      harness.setArchiveShouldFail(true);
      await assert.rejects(
        () => harness.service.finish(created.feature.id, true),
        (error: unknown) =>
          error instanceof FeatureError &&
          error.code === "unavailable" &&
          /archive threads/u.test(error.message),
      );
      assert.equal(harness.store.find(created.feature.id)?.state, "active");

      // Succeeds once thread archiving succeeds.
      harness.setArchiveShouldFail(false);
      const finished = await harness.service.finish(created.feature.id, false);
      assert.equal(finished.archivedThreads, 1);
      assert.equal(finished.removedWorktrees, 1);
      assert.equal(harness.store.find(created.feature.id)?.state, "archived");

      // Reopen restores active state.
      await harness.service.reopen(created.feature.id);
      assert.equal(harness.store.find(created.feature.id)?.state, "active");

      // Guard against scan failures before destructive survey/remove.
      harness.setScanImpl(async () => {
        throw new Error("machine disconnected");
      });
      await harness.service.refresh();
      assert.ok(harness.service.snapshot().memberScanFailures.includes("host_1"));
      await assert.rejects(
        () =>
          harness.service.remove({
            featureId: created.feature.id,
            acknowledged: true,
            deleteBranches: true,
          }),
        (error: unknown) =>
          error instanceof FeatureError &&
          error.code === "unavailable" &&
          /Nothing was removed/u.test(error.message),
      );
      assert.ok(harness.store.find(created.feature.id) !== undefined);

      // Restore host scan and perform full remove with branch + folder cleanup.
      memberPresent = true;
      harness.setScanImpl(async ({ roots }) => ({
        results: roots.map((root) => ({
          root,
          members: [
            {
              directory: "acme-app",
              repository: "acme-app",
              repositoryPath: "/work/acme-app",
              branch: "feat/alpha-work",
              path: "/Users/example/.bb/harbor-features/alpha-work/acme-app",
            },
          ],
        })),
      }));
      const removed = await harness.service.remove({
        featureId: created.feature.id,
        acknowledged: true,
        deleteBranches: true,
      });
      assert.equal(removed.archivedThreads, 1);
      assert.equal(removed.removedWorktrees, 1);
      assert.equal(removed.deletedBranches, 1);
      assert.equal(removed.removedFolder, true);
      assert.equal(harness.store.find(created.feature.id), undefined);
    } finally {
      harness.db.close();
    }
  });
});
