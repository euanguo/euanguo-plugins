import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";

import { createFeatureMetaStore } from "../lib/stores/feature-meta-store.ts";
import { createFeatureStore } from "../lib/stores/feature-store.ts";
import {
  FEATURE_REPOSITORY_MIGRATIONS,
  createFeatureRepository,
} from "../lib/stores/feature-repository.ts";
import type { FeatureMember } from "../lib/domain/features.ts";
import { createFeatureService } from "../server/feature/service.ts";

const DATA_DIR = "/data";
const CONTAINER = `${DATA_DIR}/harbor-features`;
const FEATURE_ROOT = `${CONTAINER}/clean-up`;
const MEMBER = `${FEATURE_ROOT}/acme-app`;
const SIBLING = `${FEATURE_ROOT}/acme-app-intl`;
const BRANCH = { repositoryPath: "/code/acme-app", hostId: "host_1", branch: "feat/clean-up" };

function memberAt(path: string, directory: string): FeatureMember {
  return {
    featureId: "f_clean_up",
    directory,
    path,
    repository: directory,
    repositoryPath: `/code/${directory}`,
    branch: "feat/clean-up",
    hostId: "host_1",
  };
}

function serviceHarness(options: {
  readonly members: readonly FeatureMember[];
  readonly environments: readonly { id: string; path: string }[];
  readonly archiveFailures?: readonly string[];
  readonly removeWorktreeFailures?: readonly string[];
  readonly dataDir?: string;
  readonly scanFails?: boolean;
}) {
  const db = new Database(":memory:");
  for (const statement of FEATURE_REPOSITORY_MIGRATIONS) db.exec(statement);
  const store = createFeatureStore(db);
  const metaStore = createFeatureMetaStore(db);
  const repository = createFeatureRepository(db, metaStore);
  store.create({
    id: "f_clean_up",
    name: "Clean up",
    slug: "clean-up",
    rootPath: FEATURE_ROOT,
    hostId: "host_1",
  });
  store.recordBranch({ ...BRANCH, featureId: "f_clean_up" });

  const calls: { method: string; path?: string; environmentId?: string }[] = [];
  const warnings: string[] = [];
  const service = createFeatureService({
    store,
    metaStore,
    repository,
    projectSource: async () => null,
    host: {
      async call(method: unknown, input: unknown) {
        const path = "path" in (input as object)
          ? String((input as { path?: string }).path)
          : undefined;
        const featureDirectory = "featureDirectory" in (input as object)
          ? String((input as { featureDirectory?: string }).featureDirectory)
          : undefined;
        const paths = "paths" in (input as object)
          ? (input as { paths?: readonly string[] }).paths ?? []
          : [];
        if (method === "readDataDirectory") return { dataDir: options.dataDir ?? DATA_DIR };
        if (method === "readHomeDirectory") return { home: "/home/u" };
        if (method === "scanFeatureDirectories") {
          if (options.scanFails === true) throw new Error("host did not answer");
          return {
            results: [{ root: FEATURE_ROOT, exists: true, members: options.members }],
          };
        }
        if (method === "writeFeatureContext") return { status: "ok" };
        if (method === "inspectFeatureWorktrees") {
          return {
            worktrees: paths.map((candidate) => ({
              path: candidate,
              changedFiles: 0,
              untrackedFiles: 0,
              aheadCommits: 0,
              missing: false,
            })),
          };
        }
        if (method === "removeWorktree") {
          calls.push({ method, path });
          const failed = options.removeWorktreeFailures?.includes(path ?? "");
          return { status: failed ? "failed" : "removed" };
        }
        if (method === "removeFeatureDirectory") {
          calls.push({ method, path: featureDirectory });
          return { status: "removed" };
        }
        if (method === "deleteFeatureBranch") {
          calls.push({ method, path: paths[0] });
          return { status: "deleted" };
        }
        if (method === "ensureFeatureDirectory") return { status: "ok" };
        throw new Error(`unexpected host call: ${method}`);
      },
    } as never,
    bb: {
      log: {
        warn: (message: string) => warnings.push(message),
        error: (message: string) => warnings.push(message),
      },
      realtime: { publish: () => undefined },
      sdk: {
        hosts: { list: async () => [{ id: "host_1", status: "connected" }] },
        projects: {
          list: async () => [
            {
              id: "prj_features",
              sources: [{ hostId: "host_1", path: CONTAINER }],
            },
          ],
        },
        threads: { list: async () => [] },
        environments: {
          list: async () => options.environments,
          archiveThreads: async ({ environmentId }: { environmentId: string }) => {
            calls.push({ method: "archiveThreads", environmentId });
            if (options.archiveFailures?.includes(environmentId)) {
              throw new Error(`bb refused ${environmentId}`);
            }
            return { archivedThreadIds: [`thread_${environmentId}`] };
          },
        },
      },
    } as never,
  });
  return { calls, db, service, store, warnings };
}

describe("feature destruction keeps a retry handle", () => {
  it("keeps the row when removing a feature leaves a worktree behind", async () => {
    const harness = serviceHarness({
      members: [memberAt(MEMBER, "acme-app")],
      environments: [{ id: "env_member", path: MEMBER }],
      removeWorktreeFailures: [MEMBER],
    });
    try {
      const result = await harness.service.remove({
        featureId: "f_clean_up",
        acknowledged: true,
        deleteBranches: true,
      });
      assert.deepEqual(result.leftovers, [MEMBER]);
      assert.equal(result.deletedBranches, 0);
      assert.equal(result.removedFolder, false);
      assert.notEqual(harness.store.find("f_clean_up"), undefined);
      assert.deepEqual(harness.store.branches("f_clean_up"), [BRANCH]);
      assert.deepEqual(
        harness.calls.filter((call) => call.method === "removeFeatureDirectory"),
        [],
      );
      assert.deepEqual(
        harness.calls.filter((call) => call.method === "deleteFeatureBranch"),
        [],
      );
    } finally {
      harness.db.close();
    }
  });

  it("keeps the row, branch and folder when archive fails", async () => {
    const harness = serviceHarness({
      members: [memberAt(MEMBER, "acme-app")],
      environments: [
        { id: "env_root", path: FEATURE_ROOT },
        { id: "env_member", path: MEMBER },
      ],
      archiveFailures: ["env_root"],
    });
    try {
      await assert.rejects(
        harness.service.remove({
          featureId: "f_clean_up",
          acknowledged: true,
          deleteBranches: true,
        }),
        /Could not archive threads.*env_root.*Nothing was removed/u,
      );
      assert.notEqual(harness.store.find("f_clean_up"), undefined);
      assert.deepEqual(harness.store.branches("f_clean_up"), [BRANCH]);
      assert.deepEqual(
        harness.calls.filter((call) => call.method === "removeWorktree"),
        [],
      );
      assert.deepEqual(
        harness.calls.filter((call) => call.method === "removeFeatureDirectory"),
        [],
      );
      assert.deepEqual(
        harness.calls.filter((call) => call.method === "deleteFeatureBranch"),
        [],
      );
    } finally {
      harness.db.close();
    }
  });

  it("does not remove worktrees when finishing after an archive failure", async () => {
    const harness = serviceHarness({
      members: [memberAt(MEMBER, "acme-app")],
      environments: [{ id: "env_member", path: MEMBER }],
      archiveFailures: ["env_member"],
    });
    try {
      await assert.rejects(
        harness.service.finish("f_clean_up", true),
        /Could not archive threads.*env_member/u,
      );
      assert.deepEqual(
        harness.calls.filter((call) => call.method === "removeWorktree"),
        [],
      );
      assert.equal(harness.store.find("f_clean_up")?.state, "active");
    } finally {
      harness.db.close();
    }
  });

  it("archives only acme-app's environments when removing acme-app", async () => {
    const harness = serviceHarness({
      members: [memberAt(MEMBER, "acme-app"), memberAt(SIBLING, "acme-app-intl")],
      environments: [
        { id: "env_member", path: MEMBER },
        { id: "env_sibling", path: SIBLING },
      ],
    });
    try {
      await harness.service.refresh();
      const result = await harness.service.removeRepository({
        featureId: "f_clean_up",
        directory: "acme-app",
        force: false,
      });
      assert.equal(result.removed, true);
      const archived = harness.calls.filter(
        (call) => call.method === "archiveThreads" && call.environmentId !== undefined,
      );
      assert.deepEqual(archived, [{ method: "archiveThreads", environmentId: "env_member" }]);
      assert.deepEqual(
        harness.calls.filter((call) => call.method === "removeWorktree").map((call) => call.path),
        [MEMBER],
      );
      assert.deepEqual(
        harness.calls.filter((call) => call.method === "removeFeatureDirectory"),
        [],
      );
    } finally {
      harness.db.close();
    }
  });

  it("refuses to delete when the repository scan failed", async () => {
    const harness = serviceHarness({
      members: [memberAt(MEMBER, "acme-app")],
      environments: [{ id: "env_member", path: MEMBER }],
      scanFails: true,
    });
    try {
      await assert.rejects(
        harness.service.remove({
          featureId: "f_clean_up",
          acknowledged: true,
          deleteBranches: true,
        }),
        (error: unknown) => {
          assert.equal((error as { code?: string }).code, "unavailable");
          assert.match(String(error), /Could not read the repositories/u);
          return true;
        },
      );
      assert.notEqual(harness.store.find("f_clean_up"), undefined);
      assert.deepEqual(harness.store.branches("f_clean_up"), [BRANCH]);
      assert.deepEqual(
        harness.calls.filter((call) => call.method === "removeFeatureDirectory"),
        [],
      );
    } finally {
      harness.db.close();
    }
  });

  it("codes a missing feature as not-found", async () => {
    const harness = serviceHarness({ members: [], environments: [] });
    try {
      await assert.rejects(
        harness.service.remove({
          featureId: "f_missing",
          acknowledged: true,
          deleteBranches: false,
        }),
        (error: unknown) => {
          assert.equal((error as { code?: string }).code, "not-found");
          return true;
        },
      );
    } finally {
      harness.db.close();
    }
  });

  it("replaces a stored feature root inside plugin storage once it is empty", async () => {
    const pluginData = `${DATA_DIR}/plugins/harbor/host-data`;
    const badRoot = `${pluginData}/harbor-features`;
    const harness = serviceHarness({
      members: [],
      environments: [],
      dataDir: pluginData,
    });
    harness.store.setFeaturesRoot("host_1", badRoot, "bb-data-v1");
    try {
      await harness.service.refresh();
      assert.equal(
        harness.store.featuresRoot("host_1")?.rootPath,
        `${DATA_DIR}/harbor-features`,
      );
    } finally {
      harness.db.close();
    }
  });

  it("promotes adopted symlink as writable worktree, detaches cleanly on removeRepository, and coalesces writeContext", async () => {
    const db = new Database(":memory:");
    for (const statement of FEATURE_REPOSITORY_MIGRATIONS) db.exec(statement);
    const store = createFeatureStore(db);
    const metaStore = createFeatureMetaStore(db);
    const repository = createFeatureRepository(db, metaStore);
    store.create({
      id: "f_sym",
      name: "Symlink Promo",
      slug: "symlink-promo",
      rootPath: `${CONTAINER}/symlink-promo`,
      hostId: "host_1",
    });
    store.adopt("env_ext", "f_sym");
    const calls: string[] = [];
    const contextNames: string[] = [];
    let releaseFirstWrite!: () => void;
    let firstWriteLocked = false;
    const service = createFeatureService({
      store,
      metaStore,
      repository,
      projectSource: async () => null,
      host: {
        call: async (method: string, payload: unknown) => {
          calls.push(method);
          if (method === "scanFeatureDirectories") {
            return {
              results: [
                {
                  root: `${CONTAINER}/symlink-promo`,
                  members: [
                    {
                      directory: "acme-ext",
                      path: `${CONTAINER}/symlink-promo/acme-ext`,
                      repository: "acme-ext",
                      repositoryPath: "/ext/acme-ext",
                      branch: "feat/ext",
                      role: "ref",
                    },
                    {
                      directory: "acme-wt",
                      path: `${CONTAINER}/symlink-promo/acme-wt`,
                      repository: "acme-wt",
                      repositoryPath: "/repos/acme-wt",
                      branch: "feat/ext",
                      role: "worktree",
                    },
                  ],
                },
              ],
            };
          }
          if (method === "writeFeatureContext") {
            contextNames.push((payload as { name: string }).name);
            if (firstWriteLocked) {
              firstWriteLocked = false;
              await new Promise<void>((resolve) => {
                releaseFirstWrite = resolve;
              });
            }
            return { status: "ok" };
          }
          if (method === "inspectFeatureWorktrees") {
            return {
              worktrees: [
                {
                  path: `${CONTAINER}/symlink-promo/acme-wt`,
                  changedFiles: 0,
                  untrackedFiles: 0,
                  aheadCommits: 0,
                  missing: false,
                  error: "git status failed",
                },
              ],
            };
          }
          if (method === "unlinkFeatureReference") return { status: "removed" };
          return { status: "ok" };
        },
      } as never,
      bb: {
        log: { warn: () => {} },
        realtime: { publish: () => {} },
        storage: { pathFor: async () => DATA_DIR },
        sdk: {
          hosts: { list: async () => [{ id: "host_1", status: "connected" }] },
          projects: { list: async () => [] },
          threads: { list: async () => [] },
          environments: {
            list: async () => [{ id: "env_ext", path: "/ext/acme-ext" }],
            archiveThreads: async () => ({ archivedThreadIds: [] }),
          },
        },
      } as never,
    });
    try {
      const snap = await service.refresh();
      const symMember = snap.members.find((m) => m.directory === "acme-ext");
      assert.equal(symMember?.role, "worktree");

      // Latest writeContext wins while an earlier write is in flight.
      firstWriteLocked = true;
      const w1 = service.rename("f_sym", "Name 1");
      const w2 = service.rename("f_sym", "Name 2");
      const w3 = service.rename("f_sym", "Name 3");
      await new Promise((r) => setTimeout(r, 10));
      releaseFirstWrite();
      await Promise.all([w1, w2, w3]);
      assert.equal(contextNames.at(-1), "Name 3");

      // Removing a member fails closed when inspectFeatureWorktrees reports status error.
      await assert.rejects(
        service.removeRepository({
          featureId: "f_sym",
          directory: "acme-wt",
          force: false,
        }),
        /git status error/u,
      );

      // Removing the promoted external symlink detaches adoption without running removeWorktree.
      const detached = await service.removeRepository({
        featureId: "f_sym",
        directory: "acme-ext",
        force: false,
      });
      assert.equal(detached.removed, true);
      assert.equal(store.adoptions().env_ext, undefined);
      assert.equal(calls.includes("removeWorktree"), false);
      assert.equal(calls.includes("unlinkFeatureReference"), true);
    } finally {
      db.close();
    }
  });

  it("upgrades ref links to worktrees after preflight and rolls back if worktree creation fails", async () => {
    const db = new Database(":memory:");
    for (const statement of FEATURE_REPOSITORY_MIGRATIONS) db.exec(statement);
    const store = createFeatureStore(db);
    const metaStore = createFeatureMetaStore(db);
    const repository = createFeatureRepository(db, metaStore, undefined, store);
    store.create({
      id: "f_draft",
      name: "Draft · amber-anchor",
      slug: "draft-amber-anchor",
      rootPath: `${CONTAINER}/draft-amber-anchor`,
      hostId: "host_1",
    });
    repository.refLinks.add({
      featureId: "f_draft",
      directory: "acme-web",
      repository: "acme-web",
      sourcePath: "/code/acme-web",
      hostId: "host_1",
    });

    const calls: string[] = [];
    let branchHeldElsewhere = true;
    let createShouldFail = false;

    const service = createFeatureService({
      store,
      metaStore,
      repository,
      projectSource: async () => null,
      host: {
        call: async (method: string, payload: unknown) => {
          calls.push(method);
          if (method === "probeFeatureWorktree") {
            const target = (payload as { targetPath: string }).targetPath;
            return {
              status: "ok",
              repository: true,
              mainWorktree: true,
              mainRepoPath: "/code/acme-web",
              worktrees: branchHeldElsewhere
                ? [{ path: "/code/acme-web/.worktrees/other", branch: "feat/notify" }]
                : [],
              branchExists: false,
              targetExists: true,
              defaultBase: "main",
              ...(target ? {} : {}),
            };
          }
          if (method === "unlinkFeatureReference") return { status: "removed" };
          if (method === "linkFeatureReference") {
            return { status: "ok", path: `${CONTAINER}/draft-amber-anchor/acme-web` };
          }
          if (method === "createFeatureWorktree") {
            if (createShouldFail) {
              return { status: "failed", message: "git worktree add failed" };
            }
            return {
              status: "created",
              path: `${CONTAINER}/draft-amber-anchor/acme-web`,
              branch: (payload as { branch: string }).branch,
              base: "main",
              setup: [],
            };
          }
          if (method === "scanFeatureDirectories") {
            return { results: [{ root: `${CONTAINER}/draft-amber-anchor`, members: [] }] };
          }
          return { status: "ok" };
        },
      } as never,
      bb: {
        log: { warn: () => {} },
        realtime: { publish: () => {} },
        storage: { pathFor: async () => DATA_DIR },
        sdk: {
          hosts: { list: async () => [{ id: "host_1", status: "connected" }] },
          projects: { list: async () => [] },
          threads: { list: async () => [] },
          environments: { list: async () => [] },
        },
      } as never,
    });

    try {
      // 1. Preflight conflict keeps symlink untouched.
      const blocked = await service.upgradeReferenceRepo({
        featureId: "f_draft",
        directory: "acme-web",
        branch: "feat/notify",
      });
      assert.equal(blocked.outcome, "blocked");
      assert.match(blocked.reason ?? "", /checked out at/u);
      assert.equal(calls.includes("unlinkFeatureReference"), false);
      assert.equal(repository.refLinks.list("f_draft").length, 1);

      // 2. Failure during createFeatureWorktree rolls back symlink + refLinks DB row.
      branchHeldElsewhere = false;
      createShouldFail = true;
      const rolledBack = await service.upgradeReferenceRepo({
        featureId: "f_draft",
        directory: "acme-web",
        branch: "feat/notify",
      });
      assert.equal(rolledBack.outcome, "blocked");
      assert.match(rolledBack.reason ?? "", /git worktree add failed/u);
      assert.equal(calls.includes("linkFeatureReference"), true);
      assert.equal(repository.refLinks.list("f_draft").length, 1);

      // 3. Clean upgrade removes ref link, creates worktree, and records the new branch.
      createShouldFail = false;
      const upgraded = await service.upgradeReferenceRepo({
        featureId: "f_draft",
        directory: "acme-web",
        branch: "feat/notify",
      });
      assert.equal(upgraded.outcome, "created");
      assert.equal(upgraded.branch, "feat/notify");
      assert.equal(repository.refLinks.list("f_draft").length, 0);
      assert.deepEqual(
        store.branches("f_draft").map((b) => b.branch),
        ["feat/notify"],
      );
    } finally {
      db.close();
    }
  });
});
