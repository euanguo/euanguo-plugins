import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  chooseFeaturesRoot,
  featureContainerProjectIds,
  featureRootParent,
} from "../lib/feature-root.ts";

const HOME = "/Users/u";

describe("where feature folders live", () => {
  /**
   * The first design put them at `~/NestFeatures`, the top of the home folder,
   * where nobody keeps code. The root now follows the code: the folder most of
   * this machine's projects already sit in.
   */
  it("puts the root in the folder most projects live in", () => {
    assert.equal(
      chooseFeaturesRoot({
        home: HOME,
        projectPaths: [
          `${HOME}/Documents/Code/tea-app-im`,
          `${HOME}/Documents/Code/tke-tools-vue`,
          `${HOME}/Documents/Code/warren`,
          `${HOME}/Documents/my-code/saywhy`,
        ],
      }),
      `${HOME}/Documents/Code/NestFeatures`,
    );
  });

  it("ignores a project sitting directly in the home directory", () => {
    assert.equal(
      chooseFeaturesRoot({ home: HOME, projectPaths: [`${HOME}/loose-repo`] }),
      `${HOME}/NestFeatures`,
      "the home directory is the fallback, not a hint",
    );
  });

  it("never nests features inside features", () => {
    assert.equal(
      chooseFeaturesRoot({
        home: HOME,
        projectPaths: [
          `${HOME}/NestFeatures/some-feature`,
          `${HOME}/NestFeatures/another`,
          `${HOME}/Code/a`,
        ],
      }),
      `${HOME}/Code/NestFeatures`,
    );
  });

  it("falls back to the home directory when there is nothing to go on", () => {
    assert.equal(chooseFeaturesRoot({ home: HOME, projectPaths: [] }), `${HOME}/NestFeatures`);
  });

  it("breaks a tie by path, so the answer does not depend on project order", () => {
    const paths = [`${HOME}/b/repo`, `${HOME}/a/repo`];
    const first = chooseFeaturesRoot({ home: HOME, projectPaths: paths });
    const second = chooseFeaturesRoot({ home: HOME, projectPaths: [...paths].reverse() });
    assert.equal(first, second);
    assert.equal(first, `${HOME}/a/NestFeatures`);
  });

  it("finds the folder a feature's own directory is in", () => {
    assert.equal(featureRootParent("/Users/u/Code/NestFeatures/ai"), "/Users/u/Code/NestFeatures");
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
