import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

const node = await source("components/inbox/feature-node.tsx");
const panel = await source("components/inbox/feature-tree-panel.tsx");
const manager = await source("components/inbox/feature-manager-dialog.tsx");
const materialize = await source("components/inbox/feature-materialize-dialog.tsx");
const remove = await source("components/inbox/remove-feature-dialog.tsx");
const featureFiles = [node, panel, manager, materialize, remove].join("\n");
const materializeSource = await source("lib/feature-materialize.ts");

describe("the feature surface speaks the sidebar's own language", () => {
  /**
   * One interaction vocabulary per list. A feature row that invented its own
   * chevron, its own trailing buttons or its own right-click surface would be a
   * second language inside one tree, and the two would drift.
   */
  it("draws every row affordance with the shared components", () => {
    assert.match(node, /RowDisclosure/);
    assert.match(node, /RowActions/);
    assert.match(node, /RowActionButton/);
    assert.match(node, /<RowMenu\b/);
    assert.match(node, /RollupJump/);
    assert.doesNotMatch(node, /<button[^>]*aria-label="Expand/);
  });

  /**
   * One copy language. The rest of the sidebar is English, so a new surface in
   * another language reads as bolted on even when every control works.
   */
  it("writes its user-facing copy in English", () => {
    const cjk = /[\u4e00-\u9fff]/u;
    assert.doesNotMatch(featureFiles, cjk);
  });

  /**
   * Destructive work is confirmed the way this sidebar already confirms it: a
   * count of what would be lost, then the row's own name typed out.
   */
  it("confirms a delete with the survey and the typed name", () => {
    assert.match(remove, /inspectFeatureRemoval/);
    assert.match(remove, /Type \$\{survey\.featureName\} to confirm/);
    assert.match(remove, /variant="destructive"/);
    assert.match(remove, /tone="destructive"/);
    assert.match(remove, /acknowledged: true/);
    assert.match(remove, /disabled=\{busy \|\| !confirmed\}/);
  });

  it("reuses the tree's empty state and group header", () => {
    assert.match(panel, /EMPTY_STATE_CLASS/);
    assert.match(panel, /GroupIcon/);
  });

  it("offers the axis switch with the shared labels", () => {
    assert.match(
      panel,
      /No features found|No features yet|No features match this filter/,
    );
  });

  /**
   * A native `<select>` opens the operating system's menu, which does not read
   * the theme, does not become a sheet on a phone, and does not match bb's own
   * pickers. The registry's `Select` does all three, and the settings page
   * already uses it, so a feature dialog using the native one reads as a
   * different application inside the same panel.
   */
  it("picks options with the registry's select, never a native one", () => {
    assert.doesNotMatch(featureFiles, /<select\b/u);
    assert.doesNotMatch(featureFiles, /<option\b/u);
    assert.match(materialize, /from "@\/components\/ui\/select"/u);
    assert.match(manager, /from "@\/components\/ui\/select"/u);
  });

  /**
   * Branch names travel through git, remotes, CI, and other terminals. CJK in a
   * branch is either rejected downstream or shown as escapes in a log, and one
   * shared name across repositories says nothing about which repository a
   * branch belongs to.
   */
  it("derives an ASCII branch per repository", () => {
    assert.doesNotMatch(
      materializeSource,
      /`feat\/\$\{featureId\}`/u,
    );
    assert.match(materializeSource, /asciiSlug/u);
    assert.match(materializeSource, /branchForMember/u);
  });
});
