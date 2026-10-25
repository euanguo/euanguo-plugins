import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const read = (relative: string) =>
  readFile(new URL(relative, import.meta.url), "utf8");

const SITES = [
  ["group-section", await read("../components/inbox/group-section.tsx")],
  ["project-node", await read("../components/inbox/project-node.tsx")],
  ["tree-rows", await read("../components/inbox/tree-rows.tsx")],
  ["thread-card", await read("../components/inbox/thread-card.tsx")],
  ["thread-inbox", await read("../components/inbox/thread-inbox.tsx")],
] as const;

/**
 * The opening tag of the element carrying a ref.
 *
 * Every disclosure here works by keeping its list mounted and taking the rows
 * out of it, so the element auto-animate watches must never be inside the
 * conditional — if it were, it would unmount along with its children and there
 * would be nothing left to animate.
 */
function refTag(source: string, name: string): string {
  const at = source.indexOf(`ref={${name}}`);
  assert.notEqual(at, -1, `no ref={${name}}`);
  const open = source.lastIndexOf("<", at);
  assert.notEqual(open, -1, `no tag before ref={${name}}`);
  const close = source.indexOf(">", at);
  return source.slice(open, close + 1);
}

describe("the disclosure contract", () => {
  it("animates the rows, not a box around them", () => {
    // One mechanism, not two: the same auto-animate that plays a loaded page
    // plays a disclosure, so there is no second height animation to keep in
    // step with it and no `Collapse` component left behind.
    for (const [name, source] of SITES) {
      assert.doesNotMatch(
        source,
        /ui\/collapse/,
        `${name} still wraps its body in a Collapse`,
      );
      assert.match(
        source,
        /\{expanded\s*\n?\s*\? /,
        `${name} does not gate its rows on the disclosure`,
      );
    }
  });

  it("keeps every watched list mounted, so its rows have somewhere to leave from", () => {
    const watched: Array<[string, string]> = [
      ["group-section", "attachListAutoAnimateRef"],
      ["project-node", "attachListAutoAnimateRef"],
      ["tree-rows", "attachListAutoAnimateRef"],
      ["thread-card", "attachChildListAutoAnimateRef"],
    ];
    for (const [name, ref] of watched) {
      const source = SITES.find(([site]) => site === name)?.[1] ?? "";
      const tag = refTag(source, ref);
      assert.match(tag, /id=\{(listId|childListId)\}/, `${name}: keeps its id`);
      // The container is inside a branch of its own (a project chooses between
      // a workspace level and a flat list) but never behind the disclosure's
      // `{expanded ?` — if it were, it would unmount with its own children and
      // there would be nothing left to animate.
      const open = source.lastIndexOf("<", source.indexOf(`ref={${ref}}`));
      const before = source.slice(Math.max(0, open - 120), open);
      assert.doesNotMatch(
        before,
        /\{expanded\s*\n?\s*\?/,
        `${name}: the watched container must not be behind {expanded ?}`,
      );
    }
  });

  it("takes the connector line off a closed list instead of leaving a stub", () => {
    // A zero-height list with a left border and a padding-bottom paints a stub
    // of border under the row it hangs from.
    const rows = SITES.find(([site]) => site === "tree-rows")?.[1] ?? "";
    assert.match(rows, /expanded && "border-l border-sidebar-border pl-3",/);

    const card = SITES.find(([site]) => site === "thread-card")?.[1] ?? "";
    assert.match(card, /expanded && "border-l-\[1\.5px\] pb-0\.5 pl-3",/);
  });

  it("draws an empty placeholder only when it is open", () => {
    // A placeholder has no rows to animate, so it is simply here or not.
    const rows = SITES.find(([site]) => site === "tree-rows")?.[1] ?? "";
    assert.match(rows, /expanded \? \(\n\s+<p id=\{listId\} className=\{EMPTY_WORKSPACE_CLASS\}>/);

    const project = SITES.find(([site]) => site === "project-node")?.[1] ?? "";
    assert.match(project, /expanded \? \(\n\s+<p id=\{listId\} className=\{EMPTY_PROJECT_CLASS\}>/);
  });

  it("leaves no height animation behind", () => {
    // The box follows its rows, exactly as it does under Load more.
    for (const [name, source] of SITES) {
      assert.doesNotMatch(
        source,
        /transition-\[height\]|scrollHeight|requestAnimationFrame/,
        `${name} still animates a height`,
      );
    }
  });
});
