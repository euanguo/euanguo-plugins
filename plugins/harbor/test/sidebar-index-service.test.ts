import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import {
  SIDEBAR_INDEX_MIGRATION,
  createSidebarIndexCache,
} from "../lib/agent/index-cache.ts";
import { createSidebarIndexService } from "../server/sidebar-index-service.ts";

const WORKSPACE_PATH_LIMIT = 500;

function serviceFor(count: number) {
  const environments = Array.from({ length: count }, (_, index) => ({
    id: `env_${index}`,
    projectId: "proj_main",
    hostId: "host_1",
    path: `/work/trees/${index}`,
    isGitRepo: true,
    isWorktree: true,
    branchName: null,
    name: null,
    environmentProviderId: "worktree",
    workspaceProvisionType: "unmanaged-worktree",
  }));
  const bb = {
    sdk: {
      environments: {
        async list({ limit }: { limit?: number }) {
          return environments.slice(0, limit);
        },
      },
      projects: {
        async list() {
          return [
            {
              id: "proj_main",
              name: "Main",
              sources: [{ path: "/work/repo", hostId: "host_1" }],
            },
          ];
        },
      },
    },
    log: {
      warn() {},
    },
  } as unknown as BbPluginApi;
  const db = new Database(":memory:");
  db.exec(SIDEBAR_INDEX_MIGRATION);
  const index = createSidebarIndexCache(db);
  const service = createSidebarIndexService({
    bb,
    groups: {
      list() {
        return [];
      },
      assignments() {
        return {};
      },
    } as never,
    repoFacts: {
      async read() {
        return {
          facts: [
            {
              hostId: "host_1",
              path: "/work/repo",
              realPath: "/work/repo",
              isDirectory: true,
              isMainWorktree: true,
              isLinkedWorktree: false,
              isNestedRepository: false,
              repositoryRoot: "/work/repo",
              commonDir: "/work/repo/.git",
              remoteUrl: null,
              worktrees: [],
            },
          ],
          unavailableHostIds: [],
        };
      },
    } as never,
    index,
  });
  return { service, db };
}

describe("sidebar index truncation", () => {
  it("marks an environment read that exceeds the path cap", async () => {
    const { service, db } = serviceFor(WORKSPACE_PATH_LIMIT + 1);
    try {
      const next = await service.refresh();
      assert.equal(next?.truncated, true);
      assert.equal(Object.keys(next?.environments ?? {}).length, 500);
      assert.ok(next?.environments.env_0);
      assert.equal(next?.environments.env_0?.path, "/work/trees/0");
    } finally {
      db.close();
    }
  });

  it("does not call an exact cap truncated", async () => {
    const { service, db } = serviceFor(WORKSPACE_PATH_LIMIT);
    try {
      const next = await service.refresh();
      assert.equal(next?.truncated, false);
      assert.equal(Object.keys(next?.environments ?? {}).length, 500);
    } finally {
      db.close();
    }
  });
});
