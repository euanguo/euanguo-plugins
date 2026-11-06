import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { featureForPath, type Feature } from "../lib/features.ts";

const wiring = await readFile(
  new URL("../server/feature-wiring.ts", import.meta.url),
  "utf8",
);
const useNewThread = await readFile(
  new URL("../hooks/use-new-thread.ts", import.meta.url),
  "utf8",
);
const projects = await readFile(
  new URL("../server/rpc/projects.ts", import.meta.url),
  "utf8",
);

function feature(id: string, rootPath: string | null): Feature {
  return {
    id,
    name: id,
    state: "draft",
    groupId: null,
    position: 0,
    rootPath,
    hostId: null,
  };
}

describe("a thread created in a feature directory belongs to that feature", () => {
  it("finds the feature whose directory contains the path", () => {
    const found = featureForPath(
      [
        feature("feat_a", "/home/me/NestFeatures/feat_a"),
        feature("feat_b", "/home/me/NestFeatures/feat_b"),
      ],
      "/home/me/NestFeatures/feat_a",
    );
    assert.equal(found?.id, "feat_a");
  });

  it("finds the feature from a worktree inside it", () => {
    const found = featureForPath(
      [feature("feat_a", "/home/me/NestFeatures/feat_a")],
      "/home/me/NestFeatures/feat_a/tea-app-im",
    );
    assert.equal(found?.id, "feat_a");
  });

  it("prefers the closer feature when one is nested in another", () => {
    const found = featureForPath(
      [
        feature("outer", "/home/me/NestFeatures"),
        feature("inner", "/home/me/NestFeatures/inner"),
      ],
      "/home/me/NestFeatures/inner/repo",
    );
    assert.equal(found?.id, "inner");
  });

  it("does not claim a path that merely shares a prefix", () => {
    const found = featureForPath(
      [feature("feat_a", "/home/me/NestFeatures/feat_a")],
      "/home/me/NestFeatures/feat_a-other",
    );
    assert.equal(found, null);
  });

  it("answers null for a feature that has no directory yet", () => {
    assert.equal(featureForPath([feature("feat_a", null)], "/anywhere"), null);
  });

  /**
   * The label is written by the one handler every spawn goes through, so a
   * thread created from bb's composer lands in the feature view too, not only
   * one created from the feature row.
   */
  it("files the thread from the spawn handler, not from the row", () => {
    assert.match(projects, /onThreadSpawned\(spawned\.id/u);
    assert.match(wiring, /onThreadSpawned:/u);
    assert.match(wiring, /featureForPath\(features\.list\(\), path\)/u);
    assert.match(wiring, /features\.label\(resolvedEnvironmentId, feature\.id\)/u);
    assert.match(wiring, /publish\(FEATURE_CHANNEL/u);
  });

  /**
   * A new thread is just a thread. Sending a prompt would put words in the
   * user's mouth and start the agent before they had typed anything.
   */
  it("opens the compose dialog instead of sending a message", () => {
    assert.match(useNewThread, /seedFromFeature/u);
    assert.match(useNewThread, /workspace: \{ type: "unmanaged", path: input\.rootPath \}/u);
    assert.doesNotMatch(useNewThread, /prompt:/u);
  });
});
