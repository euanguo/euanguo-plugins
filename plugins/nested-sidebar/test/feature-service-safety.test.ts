import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";

import { createFeatureMetaStore } from "../lib/stores/feature-meta-store.ts";
import { createFeatureStore } from "../lib/stores/feature-store.ts";
import {
  FEATURE_REPOSITORY_MIGRATIONS,
  createFeatureRepository,
} from "../lib/stores/feature-repository.ts";
import type { FeatureMember } from "../lib/features.ts";
import { createFeatureService } from "../server/feature-service.ts";

const DATA_DIR = "/data";
const CONTAINER = `${DATA_DIR}/nested-sidebar-features`;
const FEATURE_ROOT = `${CONTAINER}/clean-up`;
const MEMBER = `${FEATURE_ROOT}/tea-app`;
const SIBLING = `${FEATURE_ROOT}/tea-app-intl`;
const BRANCH = { repositoryPath: "/code/tea-app", hostId: "host_1", branch: "feat/clean-up" };

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
      members: [memberAt(MEMBER, "tea-app")],
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
      members: [memberAt(MEMBER, "tea-app")],
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
      members: [memberAt(MEMBER, "tea-app")],
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

  it("archives only tea-app's environments when removing tea-app", async () => {
    const harness = serviceHarness({
      members: [memberAt(MEMBER, "tea-app"), memberAt(SIBLING, "tea-app-intl")],
      environments: [
        { id: "env_member", path: MEMBER },
        { id: "env_sibling", path: SIBLING },
      ],
    });
    try {
      await harness.service.refresh();
      const result = await harness.service.removeRepository({
        featureId: "f_clean_up",
        directory: "tea-app",
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
      members: [memberAt(MEMBER, "tea-app")],
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
        /Could not read the repositories/u,
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

  it("replaces a stored feature root inside plugin storage once it is empty", async () => {
    const pluginData = `${DATA_DIR}/plugins/nested-sidebar/host-data`;
    const badRoot = `${pluginData}/nested-sidebar-features`;
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
        `${DATA_DIR}/nested-sidebar-features`,
      );
    } finally {
      harness.db.close();
    }
  });
});
