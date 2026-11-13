import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const app = await readFile(new URL("../app.tsx", import.meta.url), "utf8");
const tabs = await readFile(
  new URL("../components/header/WorkspaceTabs.tsx", import.meta.url),
  "utf8",
);
const strip = await readFile(
  new URL("../components/header/WorkspaceTabStrip.tsx", import.meta.url),
  "utf8",
);
const allMenu = await readFile(
  new URL("../components/header/AllConversationsMenu.tsx", import.meta.url),
  "utf8",
);
const workspaceMenu = await readFile(
  new URL("../components/header/WorkspaceMenu.tsx", import.meta.url),
  "utf8",
);
const park = await readFile(
  new URL("../components/header/use-park-conversation.ts", import.meta.url),
  "utf8",
);
const breadcrumb = await readFile(
  new URL("../components/header/WorkspaceBreadcrumb.tsx", import.meta.url),
  "utf8",
);
const newChat = await readFile(
  new URL("../app/new-chat/NewChatPage.tsx", import.meta.url),
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

  it("draws the workspace's tabs and returns nothing outside one", () => {
    assert.match(
      tabs,
      /workspaceTabs\(threads, workspaceKey, threadId, index, now\)/,
    );
    assert.match(
      tabs,
      /if \(mode === "threads" \|\| workspace === undefined\) return null;/,
    );
    assert.match(tabs, /if \(tabs\.length === 0\) return null;/);
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

  it("closes a tab by settling it, never by archiving it", () => {
    assert.match(park, /\.call\("settle", \{ threadId \}\)/);
    assert.match(park, /\.call\("snooze", \{ threadId, snoozedUntil:/);
    assert.doesNotMatch(tabs, /actions\.archive/);
  });

  it("opens the neighbor before the settle fires", () => {
    assert.match(
      tabs,
      /deferSettleUntilOpen\(tab\.thread\.id, next\.id\);\s*navigate\.toThread\(next\.id\);/,
    );
    assert.match(tabs, /takePendingSettle\(tab\.thread\.id, threadId\)/);
  });

  it("draws a family state and a child count on each tab", () => {
    assert.match(strip, /showsTabStatus\(tab\.status\.kind\)/);
    assert.match(strip, /<StatusDot status=\{tab\.status\}/);
    assert.match(strip, /tab\.childCount === 0 \? null :/);
  });

  it("marks each tab with its agent, and pins from the strip and the menu", () => {
    assert.match(strip, /<ProviderGlyph/);
    assert.match(strip, /providerInfoById\.get\(tab\.thread\.providerId\)/);
    // The pin takes the agent's slot on hover, so the tab gains no second box.
    assert.match(strip, /const SLOT_CLASS = "relative flex size-4 shrink-0/);
    assert.match(strip, /group-hover\/tab:opacity-0/);
    assert.match(strip, /group-hover\/tab:opacity-100/);
    assert.match(
      strip,
      /aria-label={`\$\{tab\.thread\.isPinned \? "Unpin" : "Pin"\} \$\{tab\.thread\.displayTitle\}`}/,
    );
    assert.match(tabs, /actions\.setPinned\(tab\.thread\.id, !tab\.thread\.isPinned\)/);
    assert.match(allMenu, /name=\{tab\.thread\.isPinned \? "PinOff" : "Pin"\}/);
  });

  it("scrolls the strip sideways on a vertical wheel, like the group tabs", () => {
    // `ScrollStrip` translates the wheel, but only a scroll container can be
    // scrolled: without `overflow-x-auto` the handler has nothing to move.
    assert.match(strip, /<ScrollStrip[\s\S]*?overflow-x-auto/);
  });

  it("scrolls the active tab into view when the pane changes", () => {
    assert.match(
      strip,
      /scrollIntoView\(\{ block: "nearest", inline: "nearest" \}\)/,
    );
    assert.match(strip, /\}, \[activeThreadId\]\);/);
  });

  it("offers every conversation, with search past eight rows", () => {
    assert.match(tabs, /<AllConversationsMenu/);
    assert.match(allMenu, /All \(\{tabs\.length\}\)/);
    assert.match(allMenu, /shouldShowWorkspaceSearch\(tabs\.length\)/);
    assert.match(tabs, /onSnooze=\{snoozeUntilTomorrow\}/);
  });

  it("puts the workspace-level actions in the menu", () => {
    assert.match(workspaceMenu, /Archive all conversations/);
    assert.match(workspaceMenu, /Remove worktree…/);
    assert.match(workspaceMenu, /Copy path/);
    assert.match(workspaceMenu, /workspace\.kind === "git-worktree"/);
    assert.match(tabs, /<RemoveWorktreeDialog/);
  });

  it("does not watch the document or draw a second tab strip", () => {
    assert.doesNotMatch(tabs, /MutationObserver/);
    assert.doesNotMatch(tabs, /foreignStrip/);
  });

  it("reads the index without per-pane RPCs", () => {
    assert.doesNotMatch(index, /useWorkspacePaths/);
    assert.doesNotMatch(index, /useRepoFacts/);
    assert.doesNotMatch(index, /useFeatures/);
    assert.match(index, /experimental_useSidebarThreads/);
    assert.match(index, /useSharedWorkspaceIndex\(\)/);
  });

  it("names the feature, project, and workspace in the title", () => {
    assert.match(breadcrumb, /workspace\.label/);
    assert.match(breadcrumb, /project\?\.isPersonal \? "Personal"/);
    assert.match(breadcrumb, /featureTitle\(workspace, index\)/);
  });

  it("switches to a sibling workspace through the breadcrumb", () => {
    assert.match(breadcrumb, /siblingWorkspaces\(workspace, index\)/);
    assert.match(breadcrumb, /workspaceSwitchTarget\(/);
    assert.match(breadcrumb, /lastActiveFor\(sibling\.key\)/);
  });

  it("keeps double-click rename on the plugin title", () => {
    assert.match(breadcrumb, /onDoubleClick=\{startRename\}/);
    assert.match(breadcrumb, /<ThreadRenameDialog/);
  });

  it("draws the same strip with an Untitled tab on the new-chat page", () => {
    assert.match(newChat, /<WorkspaceTabStrip/);
    assert.match(newChat, /untitled\n/);
    assert.match(newChat, /onCloseUntitled=\{closeUntitled\}/);
    assert.match(newChat, /untitledCloseTarget\(/);
  });
});
