import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [card, projectNode, chrome, threadInbox, model, pinned, featureNode, view] = await Promise.all([
  read("components/inbox/workspace-card.tsx"),
  read("components/inbox/project-node.tsx"),
  read("components/inbox/inbox-chrome.tsx"),
  read("components/inbox/thread-inbox.tsx"),
  read("hooks/use-inbox-tree-model.ts"),
  read("components/inbox/pinned-section.tsx"),
  read("components/inbox/feature-node.tsx"),
  read("lib/inbox-view.ts"),
]);

/**
 * The workspaces view stops at the workspace.
 *
 * Conversations are in the header's tabs, so a workspace row draws none, a
 * project draws no family rows under it, and the selection tool — which selects
 * thread families — is not offered at all.
 */
describe("the workspaces view's rows", () => {
  it("draws a workspace row with no conversation rows under it", () => {
    assert.doesNotMatch(card, /from "@\/components\/inbox\/family-row"/);
    assert.doesNotMatch(card, /FlatFamilies|<FamilyRow/);
    assert.doesNotMatch(card, /WorkspaceGroup/);
    // The compact row exists only for conversations that have no workspace.
    assert.match(card, /export function CompactThreadRow/);
    assert.match(card, /no children, because a\s+\*\s+child belongs to its root's workspace/);
  });

  it("leaves a project with workspace cards and the conversations that have none", () => {
    assert.match(projectNode, /const workspacesMode = handlers\.firstLevel === "workspaces"/);
    assert.match(projectNode, /const workspaceRows = workspacesMode \? projectWorkspaceRows\(node, handlers\.now\) : null/);
    assert.match(projectNode, /workspaceRows\.workspaces\.map\(\(workspace\) => \(\s*<WorkspaceCard/);
    assert.match(projectNode, /visibleLoose\.map\(\(family\) => \(\s*<CompactThreadRow/);
    // The thread view's own rows are in the other branch, untouched.
    assert.match(projectNode, /\) : node\.showWorkspaces \? \(/);
  });

  it("starts the personal project folded, and remembers opening it", () => {
    assert.match(projectNode, /const personal = workspacesMode && node\.project\.isPersonal;/);
    assert.match(projectNode, /viewState\.isPersonalProjectExpanded\(node\.project\.id\)/);
    assert.match(projectNode, /viewState\.setPersonalProjectExpanded\(node\.project\.id, open\)/);
  });

  it("draws a workspace row's facts: glyph, label, count, lines and unread", () => {
    assert.match(card, /workspaceGlyphKind\(/);
    assert.match(card, /workspaceRowLabel\(ref, handlers\.preferences\.worktreeLabel\)/);
    assert.match(card, /threadCount > 1 \? \(/);
    assert.match(card, /<ChangeCounts changes=\{changes\}/);
    assert.match(card, /<StatusDot status=\{familyStatusPresentation\("unread"\)\}/);
    assert.match(card, /const changes = changeCountFor\(handlers\.workspaceChanges, ref\.environmentIds\)/);
  });

  it("opens the conversation the click target names, or a new one bound here", () => {
    assert.match(card, /workspaceOpenTarget\(\{/);
    assert.match(card, /lastActiveThreadId: lastActiveFor\(ref\.key\)/);
    assert.match(card, /navigate\.toPluginPanel\(NEW_CHAT_PANEL_PATH, \{ subPath: ref\.canonicalEnvironmentId \}\)/);
    assert.match(card, /import \{ NEW_CHAT_PANEL_PATH \} from "@\/app\/new-chat\/route"/);
  });

  it("reuses the worktree row's menu and its reorder gesture", () => {
    assert.match(card, /<WorkspaceRowMenu/);
    assert.match(card, /application\/x-nest-workspace/);
    assert.match(card, /handlers\.onWorkspaceKeyboardMove\(/);
  });

  it("highlights the row of the workspace the open thread runs in", () => {
    assert.match(card, /handlers\.activeWorkspaceKey === ref\.key/);
    assert.match(model, /const activeWorkspaceKey = useMemo\(/);
    assert.match(model, /workspaceIndex\.workspaceOfThread\(thread\)\?\.key \?\? null/);
  });

  it("reads the uncommitted line counts once for the whole list", () => {
    assert.match(
      model,
      /useWorkspaceChangeCounts\(\s*viewPreferences\.sidebarMode === "workspaces" \? environmentIds : \[\],\s*\)/,
    );
    assert.match(threadInbox, /workspaceChanges: treeModel\.workspaceChanges/);
  });
});

describe("the workspaces view's other sections", () => {
  it("draws no Pinned section of its own: a pin never moves a workspace row", () => {
    assert.match(chrome, /\{threadsMode \? <PinnedSection \{\.\.\.pinned\} \/\> : null\}/);
    assert.doesNotMatch(chrome, /PinnedWorkspacesSection/);
    assert.doesNotMatch(pinned, /PinnedWorkspacesSection/);
    assert.match(view, /input\.sidebarMode === "threads"\s*\?\s*splitPinnedFamilies\(searchedGroups\)/);
  });

  it("offers no selection tool, which selects thread families", () => {
    assert.match(chrome, /const threadsMode = firstLevel === "threads"/);
    assert.match(chrome, /\{threadsMode \? \(\s*<button\s+type="button"\s+aria-label=\{\s*selection\.active \? "Thread selection active" : "Select threads"/);
    assert.match(threadInbox, /if \(viewPreferences\.sidebarMode === "workspaces"\) setSelectionMode\(false\)/);
  });

  it("draws a feature's workspaces as rows instead of thread groups", () => {
    assert.match(
      featureNode,
      /handlers\.firstLevel === "workspaces" \? \(\s*<WorkspaceCard/,
    );
    assert.match(featureNode, /\) : \(\s*<WorkspaceGroup/);
  });

  it("lets a feature open onto workspaces rather than conversations", () => {
    assert.match(featureNode, /handlers\.firstLevel === "workspaces"/);
    assert.match(featureNode, /: visibleRoots\.length === 0/);
  });
});

/**
 * Search, in this mode: a workspace whose label matches stays, and so does one
 * holding a conversation whose title matches. Nothing else does.
 */
describe("searching the workspaces view", () => {
  it("keeps the workspaces a query names, by label or by conversation", async () => {
    const { searchTree } = await import("../lib/tree.ts");
    const ref = (key: string, label: string) => ({
      kind: "git-worktree",
      key,
      label,
      alias: null,
      branch: null,
      environmentId: null,
      environmentIds: [],
      path: null,
      hostId: null,
      diagnostic: null,
    });
    const family = (id: string, title: string) => ({
      root: {
        id,
        title,
        titleFallback: null,
        isPinned: false,
        createdAt: 0,
        indicator: "none",
        activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0 },
        isUnread: false,
        hasPendingInteraction: false,
        latestAttentionAt: 0,
      },
      children: [],
    });
    const nodes = [
      {
        groupId: "grp_a",
        name: "Work",
        icon: "Layer",
        projects: [
          {
            project: { id: "proj_a", name: "a", isPersonal: false, href: "", settingsHref: "" },
            families: [family("fix", "fix login") as never],
            workspaces: [
              { ref: ref("ws:a", "alpha"), families: [], rollup: {} },
              {
                ref: ref("ws:b", "beta"),
                families: [family("fix", "fix login") as never],
                rollup: {},
              },
            ],
            showWorkspaces: true,
            rollup: {},
            repoKey: null,
            mergedProjectIds: ["proj_a"],
            foreignClaimProjectIds: [],
            inFeatures: null,
          },
        ],
        rollup: {},
      },
    ] as never;
    const labels = (query: string) =>
      searchTree(nodes, query)[0]?.projects[0]?.workspaces.map(
        (workspace) => workspace.ref.label,
      ) ?? [];
    assert.deepEqual(labels("alpha"), ["alpha"], "the workspace's own label matches");
    assert.deepEqual(labels("login"), ["beta"], "a conversation's title matches");
    assert.deepEqual(labels("zzz"), []);
  });
});
