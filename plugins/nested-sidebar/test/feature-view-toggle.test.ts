import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import {
  AGENT_TOOL_SETTING_DESCRIPTORS,
  PLUGIN_SETTING_DESCRIPTORS,
} from "../lib/agent/settings.ts";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [sources, inbox, organizationSwitch, server] = await Promise.all([
  read("hooks/use-inbox-sources.ts"),
  read("components/inbox/thread-inbox.tsx"),
  read("components/inbox/organization-switch.tsx"),
  read("server.ts"),
]);

/**
 * One switch takes the whole feature surface away.
 *
 * A person who does not work in features should not have to look at an empty
 * Feature tab, a feature pill on every worktree, or a menu that files worktrees
 * into something they never made. Turning the switch back on must restore all
 * of it — the features themselves are data, and the switch hides UI, it does
 * not delete anything.
 */
describe("the feature view has one switch", () => {
  it("is a plugin setting, on by default", () => {
    assert.equal(PLUGIN_SETTING_DESCRIPTORS.showFeatures.type, "boolean");
    assert.equal(PLUGIN_SETTING_DESCRIPTORS.showFeatures.default, true);
    assert.match(PLUGIN_SETTING_DESCRIPTORS.showFeatures.label, /feature view/i);
    // It is not an agent tool gate: those are counted against the tool table.
    assert.equal("showFeatures" in AGENT_TOOL_SETTING_DESCRIPTORS, false);
    assert.match(server, /\.\.\.PLUGIN_SETTING_DESCRIPTORS/);
  });

  it("is read by the sidebar, and off hides the axis", () => {
    assert.match(sources, /useSettings\(\)/);
    assert.match(sources, /values\?\.showFeatures !== false/);
    assert.match(sources, /useFeatures\(showFeatures\)/);
    assert.match(organizationSwitch, /showFeatures/);
    assert.match(organizationSwitch, /axis\.mode !== "feature" \|\| showFeatures/);
  });

  it("hides the worktree pill and its menus too", () => {
    assert.match(inbox, /showFeatures \? featureSurface\.workspaceHandlers : \{\}/);
    assert.match(inbox, /showFeatures=\{showFeatures\}/);
  });

  /** Turning it off while the feature view is in force leaves the sidebar usable. */
  it("falls back to the project view when it is turned off", () => {
    assert.match(inbox, /if \(showFeatures\) return;/);
    assert.match(inbox, /organizationMode === "feature"/);
    assert.match(inbox, /setOrganizationMode\("project"\)/);
  });

  /** Off means off: the read is what creates the Features project, so skip it. */
  it("does not read features while the view is off", () => {
    assert.match(sources, /useFeatures\(showFeatures\)/);
    const features = readFile(new URL("../hooks/use-features.ts", import.meta.url), "utf8");
    assert.doesNotReject(features);
  });
});
