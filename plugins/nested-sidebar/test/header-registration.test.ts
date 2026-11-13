import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const app = await readFile(new URL("../app.tsx", import.meta.url), "utf8");
const tabs = await readFile(
  new URL("../components/header/WorkspaceTabs.tsx", import.meta.url),
  "utf8",
);
const breadcrumb = await readFile(
  new URL("../components/header/WorkspaceBreadcrumb.tsx", import.meta.url),
  "utf8",
);
const index = await readFile(
  new URL("../hooks/use-workspace-index.ts", import.meta.url),
  "utf8",
);

describe("the workspace header", () => {
  it("registers one row and one title, and no retired header action", () => {
    assert.match(
      app,
      /experimental_threadHeaderRow\(\{\s*id: "workspace-tabs",\s*component: WorkspaceTabs,\s*\}\)/,
    );
    assert.match(
      app,
      /experimental_threadHeaderTitle\(\{\s*id: "workspace-breadcrumb",\s*component: WorkspaceBreadcrumb,\s*\}\)/,
    );
    assert.doesNotMatch(app, /experimental_threadHeaderAction/);
  });

  it("draws the workspace's chats and returns nothing outside one", () => {
    assert.match(tabs, /workspaceChats\(threads, workspace\.key, threadId, index\)/);
    assert.match(
      tabs,
      /if \(mode === "threads" \|\| workspace === undefined\) return null;/,
    );
    assert.match(tabs, /if \(chats\.length === 0\) return null;/);
  });

  it("leaves the header to bb in Threads mode", () => {
    assert.match(tabs, /useSidebarMode\(\)/);
    assert.match(breadcrumb, /useSidebarMode\(\)/);
    assert.match(
      breadcrumb,
      /if \(mode === "threads" \|\| workspace === undefined\) \{/,
    );
    assert.match(breadcrumb, /<ThreadTitle threadId=\{threadId\} \/>/);
  });

  it("records the open conversation in either mode", () => {
    assert.match(tabs, /recordLastActive\(workspaceKey, threadId\)/);
    assert.ok(
      tabs.indexOf("recordLastActive(workspaceKey, threadId)") <
        tabs.indexOf('mode === "threads"'),
      "the record runs before the mode decides whether to draw",
    );
  });

  it("moves to a neighbor before archiving the active tab", () => {
    assert.match(tabs, /navigate\.toThread\(next\.id\)/);
    assert.match(tabs, /window\.setTimeout\(\(\) => actions\.archive\(chat\.id\), 0\)/);
    assert.match(tabs, /actions\.archive\(chat\.id\);/);
  });

  it("does not watch the document or archive a workspace from the strip", () => {
    assert.doesNotMatch(tabs, /MutationObserver/);
    assert.doesNotMatch(tabs, /foreignStrip/);
    assert.doesNotMatch(tabs, /useArchiveEnvironmentThreads/);
    assert.doesNotMatch(tabs, /Archive every conversation in this workspace/);
  });

  it("reads the index without per-pane RPCs", () => {
    assert.doesNotMatch(index, /useWorkspacePaths/);
    assert.doesNotMatch(index, /useRepoFacts/);
    assert.doesNotMatch(index, /useFeatures/);
    assert.match(index, /experimental_useSidebarThreads/);
    assert.match(index, /useSharedWorkspaceIndex\(\)/);
  });

  it("names the project and the workspace in the title", () => {
    assert.match(breadcrumb, /workspace\.label/);
    assert.match(breadcrumb, /project\?\.isPersonal \? "Personal"/);
  });
});
