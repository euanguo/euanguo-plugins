import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { branchHoldsThread, familyBranches } from "../lib/inbox.ts";
import type { ThreadFamily } from "../lib/inbox.ts";

type Thread = {
  id: string;
  parentThreadId: string | null;
  createdAt: number;
};

/** A family as the tree builds it: every descendant, flat, oldest first. */
function family(threads: Thread[], root = "root"): ThreadFamily {
  const asThread = (thread: Thread) => ({ ...thread }) as never;
  return {
    root: asThread({ id: root, parentThreadId: null, createdAt: 0 }),
    children: threads.map(asThread),
  };
}

function child(id: string, parent: string, createdAt: number): Thread {
  return { id, parentThreadId: parent, createdAt };
}

/** The shape as nested ids, for a readable assertion. */
function shape(
  branches: readonly { thread: unknown; children: unknown[] }[],
): unknown[] {
  return branches.map((branch) => [
    (branch.thread as Thread).id,
    shape(branch.children as never),
  ]);
}

describe("familyBranches", () => {
  it("nests a child under the thread that spawned it", () => {
    const branches = familyBranches(
      family([
        child("a", "root", 1),
        child("b", "root", 2),
        child("a1", "a", 3),
      ]),
    );

    assert.deepEqual(shape(branches), [
      ["a", [["a1", []]]],
      ["b", []],
    ]);
  });

  it("keeps each level in the order it arrived in", () => {
    // The family's flat list is oldest-first, so this is the order the tree
    // hands over: `a`, `b`, then `a`'s two children in their own order.
    const branches = familyBranches(
      family([
        child("a", "root", 1),
        child("b", "root", 2),
        child("a1", "a", 10),
        child("a2", "a", 11),
      ]),
    );

    assert.deepEqual(shape(branches), [
      ["a", [["a1", []], ["a2", []]]],
      ["b", []],
    ]);
  });

  it("nests regardless of where the parent sits in the flat list", () => {
    // A parent is not guaranteed to come before its child: the flat list is
    // ordered by creation time with an id tie-break. Linking as we walked would
    // have promoted `late`'s child to the top level.
    const branches = familyBranches(
      family([child("early", "late", 1), child("late", "root", 2)]),
    );

    assert.deepEqual(shape(branches), [["late", [["early", []]]]]);
  });

  it("promotes a child whose parent the filter dropped", () => {
    // Searching keeps the root and the match; the middle thread is gone, and
    // its child must still be drawn rather than lost.
    const branches = familyBranches(
      family([child("grandchild", "hidden", 5)]),
    );

    assert.deepEqual(shape(branches), [["grandchild", []]]);
  });

  it("draws a thread whose parent is the root at the top level", () => {
    const branches = familyBranches(family([child("only", "root", 1)]));
    assert.deepEqual(shape(branches), [["only", []]]);
  });

  it("has nothing to draw for a family with no children", () => {
    assert.deepEqual(familyBranches(family([])), []);
  });

  it("never hangs a row off itself", () => {
    // Belt and braces: a thread that names itself as its parent would hang the
    // host's own family builder long before it reached here. The guard is one
    // comparison, and without it the shape — a row inside itself — is one React
    // cannot draw.
    const branches = familyBranches(family([child("loop", "loop", 1)]));

    assert.deepEqual(shape(branches), [["loop", []]]);
  });
});

describe("branchHoldsThread", () => {
  it("answers for the thread itself and for anything under it", () => {
    const [branch] = familyBranches(
      family([child("a", "root", 1), child("a1", "a", 2)]),
    );
    assert.ok(branch !== undefined);

    assert.equal(branchHoldsThread(branch, "a"), true);
    assert.equal(branchHoldsThread(branch, "a1"), true);
    assert.equal(branchHoldsThread(branch, "b"), false);
    assert.equal(branchHoldsThread(branch, null), false);
  });
});
