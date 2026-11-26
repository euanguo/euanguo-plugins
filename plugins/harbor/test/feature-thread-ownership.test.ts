import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { featureInstructions } from "../lib/agent/tools-features.ts";
import type { Feature } from "../lib/domain/features.ts";

const feature: Feature = {
  id: "f_1",
  name: "AI 助手",
  slug: "ai-voice",
  state: "active",
  position: 0,
  rootPath: "/home/u/HarborFeatures/ai-voice",
  hostId: "host_a",
};

describe("a thread in a feature", () => {
  it("is told which feature it is in and to read AGENTS.md", () => {
    const root = featureInstructions({ feature, members: [], inRoot: true });
    assert.match(root, /AI 助手/u);
    assert.match(root, /ai-voice\/AGENTS\.md/u);
    assert.match(root, /no repositories yet/u);
    const member = featureInstructions({
      feature,
      members: [
        {
          featureId: "f_1",
          directory: "acme-web",
          path: "/home/u/HarborFeatures/ai-voice/acme-web",
          repository: "acme-web",
          repositoryPath: "/code/acme-web",
          branch: "feat/ai-voice",
          hostId: "host_a",
        },
      ],
      inRoot: false,
    });
    assert.match(member, /inside one repository/u);
    assert.match(member, /acme-web\/ \(feat\/ai-voice\)/u);
    assert.ok(member.length < 4096);
  });
});
