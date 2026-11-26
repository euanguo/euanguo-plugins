import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildFeatureView } from "../lib/domain/feature-view.ts";
import { testWorkspaceIndex } from "./_workspace-index.ts";
import type { Feature } from "../lib/domain/features.ts";

const feature = (id: string): Feature => ({
  id,
  name: id,
  slug: id,
  state: "active",
  position: 0,
  rootPath: `/features/${id}`,
  hostId: "host_1",
});

describe("the feature selector", () => {
  it("draws only checked features", () => {
    const view = buildFeatureView({
      families: [],
      features: [feature("a"), feature("b")],
      hiddenFeatureIds: ["b"],
      members: [],
      showEmpty: true,
      searchQuery: "",
      projectNames: new Map(),
      workspaceIndex: testWorkspaceIndex(),
      scope: { kind: "all" },
      now: 1,
    });
    assert.deepEqual(view.features.map((node) => node.feature.id), ["a"]);
  });
});
