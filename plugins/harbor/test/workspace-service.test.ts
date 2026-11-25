import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { createWorkspaceService } from "../server/workspace-service.ts";

describe("workspace directory removal", () => {
  it("never falls back to a plain delete when git refuses", async () => {
    let plainDeletes = 0;
    const bb = {
      sdk: {
        files: {
          remove: async () => {
            plainDeletes += 1;
          },
        },
      },
    } as unknown as BbPluginApi;
    const workspace = createWorkspaceService({
      bb,
      removeViaGit: async () => ({
        status: "refused",
        reason: "fatal: '/repo' is a main working tree",
      }),
    });

    const result = await workspace.removeWorktreeDirectory({
      path: "/repo",
      hostId: "host_fixture",
      mainRepoPath: "/repo",
    });

    assert.deepEqual(result, {
      directory: "failed",
      message: "fatal: '/repo' is a main working tree",
    });
    assert.equal(plainDeletes, 0);
  });
});
