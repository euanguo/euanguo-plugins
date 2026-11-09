import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { buildFeatureView } from "../lib/feature-view.ts";
import type { Feature } from "../lib/features.ts";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [selector, state, context] = await Promise.all([
  read("components/inbox/feature-selector.tsx"),
  read("hooks/use-inbox-view-state.ts"),
  read("components/inbox/view-state-context.tsx"),
]);

const feature = (id: string): Feature => ({
  id,
  name: id,
  slug: id,
  state: "active",
  position: 0,
  rootPath: `/features/${id}`,
  hostId: "host_1",
});

/**
 * Choosing which features the view draws.
 *
 * The list starts with everything checked, and the unchecked ones are what is
 * remembered — a feature made later must not need ticking before it appears.
 * The surface is the sidebar's own popover and checkbox, not a second control
 * language for one menu.
 */
describe("the feature selector", () => {
  it("is built from the sidebar's own controls", () => {
    assert.match(selector, /from "@\/components\/ui\/popover"/);
    assert.match(selector, /from "@\/components\/ui\/checkbox"/);
    assert.match(selector, /from "@\/components\/ui\/icon"/);
    assert.doesNotMatch(selector, /<select\b|<option\b/);
  });

  it("has one select-all control and one row per feature", () => {
    assert.match(selector, /All features/);
    assert.match(selector, /onSetAllHidden\(ids, value !== true\)/);
    assert.match(selector, /features\.map\(\(feature\)/);
    assert.match(selector, /onSetHidden\(feature\.id, value !== true\)/);
  });

  it("remembers hidden ids, so a later feature is shown by default", () => {
    assert.match(context, /isFeatureHidden/);
    assert.match(context, /setAllFeaturesHidden/);
    assert.match(state, /hiddenFeatureIds: withId\(state\.hiddenFeatureIds/);
    assert.match(state, /hiddenFeatureIds: hidden \? \[\.\.\.new Set\(featureIds\)\] : \[\]/);
  });

  it("draws only checked features", () => {
    const view = buildFeatureView({
      families: [],
      features: [feature("a"), feature("b")],
      hiddenFeatureIds: ["b"],
      adoptions: {},
      members: [],
      showEmpty: true,
      searchQuery: "",
      environments: new Map(),
      projects: new Map(),
      projectNames: new Map(),
      workspaceOwnership: {},
      now: 1,
    });
    assert.deepEqual(view.features.map((node) => node.feature.id), ["a"]);
  });
});
