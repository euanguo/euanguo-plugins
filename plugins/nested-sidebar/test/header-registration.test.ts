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
    assert.match(tabs, /if \(workspace === undefined\) return null;/);
    assert.match(tabs, /if \(chats\.length === 0\) return null;/);
  });

  it("moves to a neighbor before archiving the active tab", () => {
    assert.match(tabs, /navigate\.toThread\(next\.id\)/);
    assert.match(tabs, /window\.setTimeout\(\(\) => actions\.archive\(chat\.id\), 0\)/);
    assert.match(tabs, /actions\.archive\(chat\.id\);/);
  });

  it("names the project and the workspace in the title", () => {
    assert.match(breadcrumb, /workspace\.label/);
    assert.match(breadcrumb, /project\?\.isPersonal \? "Personal"/);
    assert.match(breadcrumb, /<ThreadTitle threadId=\{threadId\} \/>/);
  });
});
