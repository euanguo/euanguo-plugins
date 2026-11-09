import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  featureContainerProjectIds,
  featureRootParent,
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
