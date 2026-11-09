import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  featureContainerProjectIds,
  featureRootParent,
  featuresFolderIn,
  isWithinPath,
  reservedWorkspaceReason,
} from "../lib/feature-root.ts";

describe("where a feature folder sits", () => {
  it("finds the folder a feature's own directory is in", () => {
    assert.equal(featureRootParent("/Users/u/.bb/plugins/nested-sidebar/features/ai"), "/Users/u/.bb/plugins/nested-sidebar/features");
  });

  it("normalizes before answering", () => {
    assert.equal(featureRootParent("/Users/u/features/ai/"), "/Users/u/features");
  });
});

describe("the projects the project view hides", () => {
  it("finds every container, including a root features were made under before", () => {
    const ids = featureContainerProjectIds({
      projects: [
        { id: "new", sources: [{ path: "/Users/u/Code/NestFeatures" }] },
        { id: "old", sources: [{ path: "/Users/u/NestFeatures/" }] },
        { id: "repo", sources: [{ path: "/Users/u/Code/tea-app-im" }] },
      ],
      containerPaths: ["/Users/u/Code/NestFeatures", "/Users/u/NestFeatures"],
    });
    assert.deepEqual(ids, ["new", "old"]);
  });

  it("answers nothing when nothing is a container", () => {
    assert.deepEqual(
      featureContainerProjectIds({
        projects: [{ id: "repo", sources: [{ path: "/Users/u/Code/tea-app-im" }] }],
        containerPaths: [],
      }),
      [],
    );
  });
});

describe("where a feature folder may live", () => {
  const dataDir = "/Users/u/.bb";

  it("sits in bb's data directory under this plugin's own name", () => {
    assert.equal(
      featuresFolderIn(dataDir),
      "/Users/u/.bb/nested-sidebar-features",
    );
  });

  it("refuses the roots bb reserves for its own workspaces", () => {
    for (const path of [
      "/Users/u/.bb/worktrees/thr_1/tea-app-im",
      "/Users/u/.bb/personal-workspaces/one",
    ]) {
      assert.notEqual(reservedWorkspaceReason({ dataDir, path }), null, path);
    }
  });

  it("refuses a plugin's private data directory", () => {
    assert.notEqual(
      reservedWorkspaceReason({
        dataDir,
        path: "/Users/u/.bb/plugins/nested-sidebar/host-data/features/ai",
      }),
      null,
    );
    assert.notEqual(
      reservedWorkspaceReason({
        dataDir,
        path: "/Users/u/.bb/plugins/other/bridge-data/x",
      }),
      null,
    );
  });

  it("allows a feature folder beside the reserved ones", () => {
    assert.equal(
      reservedWorkspaceReason({
        dataDir,
        path: "/Users/u/.bb/nested-sidebar-features/ai-voice/tea-app-im",
      }),
      null,
    );
    // The same folder shape is fine outside bb's data directory entirely.
    assert.equal(
      reservedWorkspaceReason({ dataDir, path: "/Users/u/Code/x/y" }),
      null,
    );
  });

  it("does not mistake a sibling for a child", () => {
    assert.equal(isWithinPath("/Users/u/.bb/plugins", "/Users/u/.bb/plugins-x"), false);
    assert.equal(isWithinPath("/Users/u/.bb/plugins", "/Users/u/.bb/plugins/a"), true);
  });
});

