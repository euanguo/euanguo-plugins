import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const read = (relative: string) =>
  readFile(new URL(`../${relative}`, import.meta.url), "utf8");

const inbox = await read("components/inbox/thread-inbox.tsx");
const viewStateHook = await read("hooks/use-inbox-view-state.ts");
const groupSection = await read("components/inbox/group-section.tsx");
const projectNode = await read("components/inbox/project-node.tsx");
const treeRows = await read("components/inbox/tree-rows.tsx");
const threadCard = await read("components/inbox/thread-card.tsx");
const threadMenu = await read("components/inbox/thread-menu-items.tsx");

/**
 * The tree's shape used to live in four `useState` calls, one per level, which
 * is exactly why a reload lost it. These pin the wiring that replaced them: one
 * store in the inbox, read by every level through the shared context.
 */
describe("remembered view state", () => {
  it("reads the store once and writes through one patch path", () => {
    // The store and its one write path live in the hook now; the inbox reaches
    // them through it rather than holding its own copy.
    assert.match(viewStateHook, /useState<NestViewState>\(readViewState\)/);
    assert.match(viewStateHook, /writeViewState\(/);
    // One place writes, and every accessor goes through it.
    assert.equal((viewStateHook.match(/writeViewState\(/g) ?? []).length, 2);
    assert.match(inbox, /const patchViewState = viewStateStore\.patch;/);
  });

  it("restores the scope, the filter, and the shelves", () => {
    assert.match(inbox, /resolveGroupScope\(/);
    assert.match(inbox, /activeKey={activeScopeKey}/);
    assert.match(inbox, /filter={filterPreset}/);
    assert.match(inbox, /patchViewState\(\{ snoozedOpen:/);
    assert.match(inbox, /patchViewState\(\{ settledOpen:/);
  });

  it("gives every level the shared context instead of local state", () => {
    for (const [level, source] of [
      ["group", groupSection],
      ["project", projectNode],
      ["worktree", treeRows],
      ["thread", threadCard],
    ] as const) {
      assert.match(
        source,
        /useNestViewState\(\)/,
        `${level} reads the shared view state`,
      );
    }
    assert.doesNotMatch(groupSection, /const \[expanded, setExpanded\] = useState/);
    assert.doesNotMatch(projectNode, /const \[expanded, setExpanded\] = useState/);
  });

  it("reopens the path back to the thread the route restored", () => {
    assert.match(inbox, /threadAncestors\(treeNodes, activeThreadId\)/);
    assert.match(inbox, /revealedThreadRef/);
    // The reveal must be keyed on the thread changing, not on every tree edit,
    // or it would undo the collapse the user just made.
    assert.match(inbox, /revealedThreadRef\.current === activeThreadId/);
  });

  it("offers copying at every level", () => {
    assert.match(threadCard, /<ThreadRowMenu/);
    assert.match(threadMenu, /Copy thread ID/);
    assert.match(groupSection, /Copy group ID/);
    assert.match(projectNode, /Copy project ID/);
    assert.match(treeRows, /Copy environment ID/);
  });
});
