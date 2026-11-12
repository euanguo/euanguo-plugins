import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

const node = await source("components/inbox/feature-node.tsx");
const tree = await source("components/inbox/feature-tree-panel.tsx");
const panel = await source("components/inbox/inbox-tree-panel.tsx");
const create = await source("components/inbox/feature-create-dialog.tsx");
const brief = await source("components/inbox/feature-brief-dialog.tsx");
const repositories = await source("components/inbox/feature-repositories-dialog.tsx");
const end = await source("components/inbox/feature-end-dialog.tsx");
const picker = await source("components/inbox/repository-picker.tsx");
const workspaceRow = await source("components/inbox/workspace-row.tsx");
const workspaceMenu = await source("components/inbox/workspace-row-menu.tsx");
const inbox = await source("components/inbox/thread-inbox.tsx");
const viewMenu = await source("components/inbox/view-menu.tsx");
const featureFiles = [node, tree, create, brief, repositories, end, picker].join("\n");
const ui = [featureFiles, workspaceRow, workspaceMenu].join("\n");

describe("the feature surface speaks the sidebar's own language", () => {
  /**
   * One interaction vocabulary per list. A feature row that invented its own
   * chevron, trailing buttons or right-click surface would be a second language
   * inside one tree, and the two would drift.
   */
  it("draws the feature row with the project row's own parts", () => {
    for (const part of ["RowDisclosure", "RowActions", "RowActionButton", "<RowMenu", "RollupJump", "ProjectBadge", "InfoCard"]) {
      assert.ok(node.includes(part), part);
    }
    assert.match(node, /group\/project relative flex h-7 w-full items-center gap-1\.5 rounded-md px-1\.5/u);
  });

  /** Clicking the row opens and closes it, and `+` always starts a conversation. */
  it("gives the row one meaning and `+` one meaning", () => {
    assert.match(node, /onClick=\{\(\) => setExpanded\(!expanded\)\}/u);
    assert.match(node, /icon="Plus"[\s\S]{0,120}onClick=\{\(\) => rowActions\.onNewThread\(feature\.id\)\}/u);
    assert.doesNotMatch(node, /onAddRepository|hasDirectory/u);
  });

  /**
   * The feature view is the same panel as the project view — same scroll box,
   * notices, empty state and shelves — with features where projects would be.
   * Features are a flat list: no group headings above them, and no scope strip,
   * because the only axis is the one the bottom switch already chose.
   */
  it("lives inside the tree panel as one flat list", () => {
    assert.match(panel, /<FeatureTree \{\.\.\.features\}/u);
    assert.doesNotMatch(tree, /GroupShell|GroupSection/u);
    assert.doesNotMatch(inbox, /<FeatureTreePanel/u);
    assert.match(inbox, /machines=\{/u);
  });

  /** Member worktrees are the project view's own worktree rows. */
  it("draws a member worktree with the project view's row", () => {
    assert.match(node, /<WorkspaceGroup/u);
    assert.match(node, /RepositoriesLine/u);
  });

  it("writes its user-facing copy in English", () => {
    assert.doesNotMatch(ui, /[一-鿿]/u);
  });

  /** No pixel sizes typed by hand: the scale is the sidebar's. */
  it("uses the sidebar's type scale, not ad hoc sizes", () => {
    assert.doesNotMatch(ui, /text-\[\d/u);
    assert.doesNotMatch(featureFiles, /rounded-full border border-primary/u);
  });

  it("marks a worktree's feature with the shared Pill", () => {
    assert.match(workspaceRow, /<Pill variant="secondary" size="sm"/u);
    assert.match(workspaceRow, /onRevealFeature/u);
  });

  /** A worktree in a feature folder is in that feature; only an outside one can be adopted. */
  it("offers adoption only where the path does not decide", () => {
    assert.match(workspaceMenu, /feature !== null && feature\.byPath/u);
    assert.match(workspaceMenu, /onAdoptWorkspace/u);
  });

  it("picks options with the registry's controls, never native ones", () => {
    assert.doesNotMatch(featureFiles, /<select\b|<option\b|window\.(prompt|confirm)/u);
    assert.match(picker, /from "@\/components\/ui\/checkbox"/u);
    // A feature has no group to pick: it is filed by the bottom switch, not by
    // a bucket of its own.
    assert.doesNotMatch(create, /Group|groupId/u);
  });

  /**
   * Destructive work is confirmed the way this sidebar already confirms it: a
   * count of what would be lost, then the name typed out when work would go.
   */
  it("confirms finishing and deleting with a survey and the typed name", () => {
    assert.match(end, /inspectFeatureRemoval/u);
    assert.match(end, /Type \$\{feature\.name\} to confirm/u);
    assert.match(end, /tone=\{finishing \? "default" : "destructive"\}/u);
    assert.match(end, /acknowledged: true/u);
    assert.match(repositories, /Remove anyway/u);
  });

  /** The axis is chosen in one place: the switch at the bottom. */
  it("keeps the organization switch out of the view menu", () => {
    assert.doesNotMatch(viewMenu, /label="Organize"/u);
    assert.match(inbox, /<OrganizationSwitch/u);
  });

  /**
   * Requirement, decisions and references are one destination. A decision an
   * agent recorded is visibly a draft with one act that turns it into a
   * decision, because confirmation is the person's, not the model's.
   */
  it("keeps the requirement and the decision log in one dialog", () => {
    assert.match(node, /onRequirement/u);
    assert.match(node, /Requirement & decisions/u);
    assert.match(brief, /TabsTrigger value="requirement"/u);
    assert.match(brief, /TabsTrigger value="decisions"/u);
    assert.match(brief, /TabsTrigger value="references"/u);
    assert.match(brief, /api\.addDecision/u);
    assert.match(brief, /api\.confirmDecision/u);
    assert.match(brief, /api\.saveBrief/u);
    assert.match(brief, /Confirm/u);
    assert.match(brief, /Supersede/u);
  });
});
