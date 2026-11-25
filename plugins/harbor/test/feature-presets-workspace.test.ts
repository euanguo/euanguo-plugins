import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import {
  parseCodeWorkspaceJson,
  renderCodeWorkspace,
} from "../lib/domain/feature-presets.ts";
import { createFeaturePresetStore } from "../lib/stores/feature-preset-store.ts";
import { FEATURE_REPOSITORY_MIGRATIONS } from "../lib/stores/feature-repository.ts";
import { createFeatureStore } from "../lib/stores/feature-store.ts";
import { createFeatureGitOps } from "../server/feature/git-ops.ts";

describe("feature presets and .code-workspace interoperability", () => {
  it("stores, updates, deduplicates, and deletes feature presets", () => {
    const db = new Database(":memory:");
    for (const sql of FEATURE_REPOSITORY_MIGRATIONS) db.exec(sql);
    const presets = createFeaturePresetStore(db);

    const saved = presets.save({
      name: "  Core   Checkout Stack  ",
      baseBranch: "main",
      repos: [
        { projectId: "prj_web", role: "worktree", branchTemplate: "feat/{slug}" },
        { projectId: "prj_web", role: "ref", branchTemplate: null },
        { projectId: "prj_sdk", role: "ref", branchTemplate: null },
      ],
    });
    assert.ok(saved);
    assert.equal(saved.name, "Core Checkout Stack");
    assert.equal(saved.baseBranch, "main");
    assert.equal(saved.repos.length, 2);
    assert.equal(saved.repos[0]?.role, "worktree");
    assert.equal(saved.repos[1]?.role, "ref");

    const updated = presets.save({
      id: saved.id,
      name: "Core Checkout v2",
      baseBranch: "release/next",
      repos: saved.repos,
    });
    assert.ok(updated);
    assert.equal(updated.id, saved.id);
    assert.equal(presets.list().length, 1);

    assert.equal(presets.remove(saved.id), true);
    assert.equal(presets.list().length, 0);
  });

  it("renders valid .code-workspace and parses JSONC with URLs and trailing commas", () => {
    const rendered = renderCodeWorkspace({
      name: "Order Sync",
      members: [
        { directory: "acme-web", repository: "acme-web", role: "worktree" },
        { directory: "acme-sdk", repository: "acme-sdk", role: "ref" },
      ],
      adoptedPaths: [{ name: "acme-legacy", path: "/repos/acme-legacy" }],
    });
    const parsedRendered = JSON.parse(rendered) as {
      folders: { path: string; name: string }[];
      settings: Record<string, string>;
    };
    assert.equal(parsedRendered.folders.length, 3);
    assert.equal(parsedRendered.folders[1]?.name, "acme-sdk (Ref · Read-only)");
    assert.equal(parsedRendered.settings["harbor.featureName"], "Order Sync");

    const jsonc = `{
      // Header comment; URLs in strings must survive: https://example.com//v1
      "folders": [
        { "path": "./acme-web", "name": "acme-web" },
        { "path": "../shared/acme-sdk", "name": "SDK // Docs" },
        { "path": "https://example.com//ignored-test", },
      ],
      /* Block comment */
      "settings": { "editor.tabSize": 2, }
    }`;
    const folders = parseCodeWorkspaceJson(jsonc, "/repos/work/order-sync");
    assert.equal(folders.length, 3);
    assert.equal(folders[0]?.path, "/repos/work/order-sync/acme-web");
    assert.equal(folders[1]?.path, "/repos/work/shared/acme-sdk");
    assert.equal(folders[1]?.name, "SDK // Docs");
  });

  it("matches .code-workspace folders to known BB projects and separates unmatched paths", async () => {
    const db = new Database(":memory:");
    for (const sql of FEATURE_REPOSITORY_MIGRATIONS) db.exec(sql);
    const store = createFeatureStore(db);

    const gitOps = createFeatureGitOps({
      bb: {
        sdk: {
          projects: {
            list: async () => [
              {
                id: "prj_web",
                name: "acme-web",
                sources: [{ hostId: "host_a", path: "/repos/acme-web" }],
              },
              {
                id: "prj_api",
                name: "acme-api",
                sources: [{ hostId: "host_a", path: "/repos/acme-api" }],
              },
            ],
          },
        },
      } as never,
      store,
      refLinks: { list: () => [], add: () => null, remove: () => false, deleteForFeature: () => {} },
      call: async () => ({
        status: "ok",
        content: JSON.stringify({
          folders: [
            { path: "./acme-web", name: "Web" },
            { path: "/repos/acme-api", name: "API" },
            { path: "/repos/unregistered-lib" },
          ],
        }),
      }) as never,
      getCached: () => ({
        features: [],
        adoptions: {},
        members: [],
        refLinks: [],
        homeProjects: {},
        featureProjectIds: [],
        memberScanFailures: [],
        meta: {},
      }),
      requireFeature: (id) => {
        throw new Error(id);
      },
      membersOf: () => [],
      createdBranchCount: () => 0,
      invalidate: () => {},
    });

    const imported = await gitOps.importCodeWorkspace({
      hostId: "host_a",
      filePath: "/repos/checkout.code-workspace",
    });
    assert.equal(imported.name, "checkout");
    assert.deepEqual(
      imported.matched.map((entry) => entry.projectId),
      ["prj_web", "prj_api"],
    );
    assert.deepEqual(imported.unmatchedPaths, ["/repos/unregistered-lib"]);
  });
});
