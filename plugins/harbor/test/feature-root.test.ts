import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  daemonDataRoot,
  featureContainerProjectIds,
  featureRootParent,
  featuresFolderIn,
  isWithinPath,
  reservedWorkspaceReason,
} from "../lib/domain/feature-root.ts";

describe("where a feature folder sits", () => {
  it("finds the folder a feature's own directory is in", () => {
    assert.equal(featureRootParent("/Users/u/.bb/plugins/harbor/features/ai"), "/Users/u/.bb/plugins/harbor/features");
  });

  it("normalizes before answering", () => {
    assert.equal(featureRootParent("/Users/u/features/ai/"), "/Users/u/features");
  });
});

describe("the daemon data root reported by a fresh host", () => {
  it("maps a plugin's host-data root back to bb's data directory", () => {
    assert.equal(
      daemonDataRoot("/Users/u/.bb/plugins/harbor/host-data"),
      "/Users/u/.bb",
    );
  });

  it("leaves a path that already is the daemon root unchanged", () => {
    assert.equal(daemonDataRoot("/Users/u/.bb"), "/Users/u/.bb");
  });

  it("puts a fresh feature root beside bb's reserved folders", () => {
    assert.equal(
      featuresFolderIn(
        daemonDataRoot("/Users/u/.bb/plugins/harbor/host-data") ?? "",
      ),
      "/Users/u/.bb/harbor-features",
    );
  });
});

describe("the projects the project view hides", () => {
  it("finds every container, including a root features were made under before", () => {
    const ids = featureContainerProjectIds({
      projects: [
        { id: "new", sources: [{ path: "/Users/u/Code/HarborFeatures" }] },
        { id: "old", sources: [{ path: "/Users/u/HarborFeatures/" }] },
        { id: "repo", sources: [{ path: "/Users/u/Code/acme-web" }] },
      ],
      containerPaths: ["/Users/u/Code/HarborFeatures", "/Users/u/HarborFeatures"],
    });
    assert.deepEqual(ids, ["new", "old"]);
  });

  it("answers nothing when nothing is a container", () => {
    assert.deepEqual(
      featureContainerProjectIds({
        projects: [{ id: "repo", sources: [{ path: "/Users/u/Code/acme-web" }] }],
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
      "/Users/u/.bb/harbor-features",
    );
  });

  it("refuses the roots bb reserves for its own workspaces", () => {
    for (const path of [
      "/Users/u/.bb/worktrees/thr_1/acme-web",
      "/Users/u/.bb/personal-workspaces/one",
    ]) {
      assert.notEqual(reservedWorkspaceReason({ dataDir, path }), null, path);
    }
  });

  it("refuses a plugin's private data directory", () => {
    assert.notEqual(
      reservedWorkspaceReason({
        dataDir,
        path: "/Users/u/.bb/plugins/harbor/host-data/features/ai",
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
        path: "/Users/u/.bb/harbor-features/ai-voice/acme-web",
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
