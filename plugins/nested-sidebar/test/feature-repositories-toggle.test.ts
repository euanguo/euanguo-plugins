import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { defaultViewState } from "../lib/view-state.ts";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [node, viewState, workspaceRow] = await Promise.all([
  read("components/inbox/feature-node.tsx"),
  read("lib/view-state.ts"),
  read("components/inbox/workspace-row.tsx"),
]);

/**
 * The repositories under a feature are a detail, not the list.
 *
 * A feature's rows are its conversations, and what the user is doing there is
 * talking to the work. Which folders sit behind it is something you look at on
 * purpose, so it starts hidden and one eye on the row brings it back.
 */
describe("the repository line under a feature", () => {
  it("starts hidden and is remembered per feature", () => {
    assert.deepEqual(defaultViewState().shownFeatureRepositories, []);
    assert.match(viewState, /shownFeatureRepositories: readIds\(parsed\.shownFeatureRepositories\)/);
    assert.match(node, /areFeatureRepositoriesShown/);
    assert.match(node, /showRepositories \? \(\s*<RepositoriesLine/);
  });

  it("has one eye on the feature row, beside the plus", () => {
    assert.match(node, /icon=\{showRepositories \? "Eye" : "EyeOff"\}/);
    assert.match(node, /setFeatureRepositoriesShown\(feature\.id, !showRepositories\)/);
    assert.match(node, /Hide repositories in \$\{feature\.name\}/);
  });

  it("keeps the pill vertically centered on a worktree row", () => {
    assert.match(workspaceRow, /inline-flex min-w-0 max-w-\[8rem\] shrink-0 items-center self-center/);
    assert.match(workspaceRow, /h-4 max-w-full items-center text-2xs leading-none/);
  });
});
