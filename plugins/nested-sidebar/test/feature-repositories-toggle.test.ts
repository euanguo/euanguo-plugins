import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { defaultViewState } from "../lib/ui/view-state.ts";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [node, projectNode, workspaceRow] = await Promise.all([
  read("components/inbox/feature-node.tsx"),
  read("components/inbox/project-node.tsx"),
  read("components/inbox/workspace-row.tsx"),
]);

/**
 * The repositories under a feature are drawn there and only there.
 *
 * A member worktree used to be a detail a feature hid behind an eye, because
 * its project drew it too. Now the project leaves it out, so the feature's row
 * for it is the only way in: it is always drawn, and the project says where
 * its missing worktrees went.
 */
describe("the worktree rows under a feature", () => {
  it("draws every member, with no toggle and no stored choice behind it", () => {
    assert.equal("shownFeatureWorktrees" in defaultViewState(), false);
    assert.doesNotMatch(node, /areFeatureWorktreesShown|setFeatureWorktreesShown/);
    assert.match(node, /\{node\.workspaces\.map\(workspaceRow\)\}/);
  });

  it("names the repositories on one line only while no member has a row", () => {
    assert.match(node, /node\.workspaces\.length > 0 \? null : \(\s*<RepositoriesLine/);
  });

  it("leaves a link on the project to the feature holding its worktrees", () => {
    assert.match(projectNode, /<InFeaturesLine/);
    assert.match(projectNode, /handlers\.onRevealFeature\?\.\(inFeatures\.featureId\)/);
  });

  it("draws no feature pill on a worktree row, which is never under a project", () => {
    assert.doesNotMatch(workspaceRow, /FeaturePill/);
  });
});
