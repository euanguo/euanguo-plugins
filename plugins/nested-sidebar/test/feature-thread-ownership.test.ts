import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { featureInstructions } from "../lib/agent/tools-features.ts";
import type { Feature } from "../lib/features.ts";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [projects, wire, compose, dialog, newThread] = await Promise.all([
  read("server/rpc/projects.ts"),
  read("lib/agent/wire.ts"),
  read("hooks/use-feature-compose.ts"),
  read("components/inbox/new-thread-dialog.tsx"),
  read("hooks/use-new-thread.ts"),
]);

const feature: Feature = {
  id: "f_1",
  name: "AI 语音",
  slug: "ai-voice",
  state: "active",
  groupId: null,
  position: 0,
  rootPath: "/home/u/NestFeatures/ai-voice",
  hostId: "host_a",
};

/**
 * Where a thread belongs, and what it is told.
 *
 * The earlier build wrote a label when its own `spawnThread` ran, so a thread
 * started from bb's composer, the CLI or an agent never showed up under its
 * feature. These pin the replacement: membership is read from the path, and
 * the agent learns where it is from its working directory, not from a message
 * the sidebar sent on the user's behalf.
 */
describe("a thread in a feature", () => {
  it("is not labelled at spawn time", () => {
    assert.doesNotMatch(projects, /onThreadSpawned|feature/iu);
  });

  it("is configured from its environment's path, for every way of starting it", () => {
    assert.match(wire, /features\.locate\(context\.environment\.path\)/u);
    assert.match(wire, /skills: located === null \? \[\] : \[FEATURE_SKILL\]/u);
  });

  it("starts empty: the compose dialog opens and nothing is sent", () => {
    assert.match(compose, /seedFromFeature\(/u);
    assert.doesNotMatch(compose, /prompt/u);
    assert.doesNotMatch(newThread, /seedFromFeature[\s\S]{0,600}prompt:/u);
  });

  it("lands in the feature folder of the Features project, whatever the pickers say", () => {
    assert.match(newThread, /locked: true/u);
    assert.match(dialog, /seed\.locked === true/u);
  });

  it("is told which feature it is in and to read AGENTS.md", () => {
    const root = featureInstructions({ feature, members: [], inRoot: true });
    assert.match(root, /AI 语音/u);
    assert.match(root, /ai-voice\/AGENTS\.md/u);
    assert.match(root, /no repositories yet/u);
    const member = featureInstructions({
      feature,
      members: [
        {
          featureId: "f_1",
          directory: "tea-app-im",
          path: "/home/u/NestFeatures/ai-voice/tea-app-im",
          repository: "tea-app-im",
          repositoryPath: "/code/tea-app-im",
          branch: "feat/ai-voice",
          hostId: "host_a",
        },
      ],
      inRoot: false,
    });
    assert.match(member, /inside one repository/u);
    assert.match(member, /tea-app-im\/ \(feat\/ai-voice\)/u);
    assert.ok(member.length < 4096);
  });
});
