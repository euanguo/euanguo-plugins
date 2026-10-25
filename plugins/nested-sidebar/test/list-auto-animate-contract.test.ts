import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const hook = await readFile(
  new URL("../hooks/use-list-auto-animate.ts", import.meta.url),
  "utf8",
);
const inbox = await readFile(
  new URL("../components/inbox/thread-inbox.tsx", import.meta.url),
  "utf8",
);

/** The tree's list containers, and the ref each one attaches. */
const CONTAINERS: Array<[string, string]> = [
  ["../components/inbox/thread-inbox.tsx", "attachTreeAutoAnimateRef"],
  ["../components/inbox/thread-inbox.tsx", "attachListAutoAnimateRef"],
  ["../components/inbox/group-section.tsx", "attachListAutoAnimateRef"],
  ["../components/inbox/project-node.tsx", "attachListAutoAnimateRef"],
  ["../components/inbox/tree-rows.tsx", "attachListAutoAnimateRef"],
  ["../components/inbox/thread-card.tsx", "attachChildListAutoAnimateRef"],
];

const library = await readFile(
  new URL(
    "../node_modules/@formkit/auto-animate/index.mjs",
    import.meta.url,
  ),
  "utf8",
);

describe("the list transition contract", () => {
  it("ports upstream's options unchanged", () => {
    assert.match(hook, /autoAnimate\(node, \{/);
    assert.match(hook, /easing: "ease-out",/);
    // Named rather than inlined, because the sweep below has to wait out the
    // same duration to know an exit is not merely still running.
    assert.match(hook, /const EXIT_MS = 150;/);
    assert.match(hook, /duration: EXIT_MS,/);
  });

  it("bails outside a browser, so a test without matchMedia never animates", () => {
    assert.match(hook, /typeof window\.matchMedia !== "function"/);
  });

  it("destroys the controller, which is what releases its observers", () => {
    assert.match(hook, /animation\.destroy\?\.\(\);/);
  });

  it("drops the drag registry rather than porting it dead", () => {
    // Upstream holds every list still during a reorder drag because its drag
    // reads row geometry mid-gesture. Nest reorders with native HTML5
    // drag-and-drop, where nothing moves until the drop.
    assert.doesNotMatch(hook, /listAnimations|listAnimationHolds/);
    assert.doesNotMatch(hook, /suspendListAnimations|resumeListAnimations/);
    assert.doesNotMatch(hook, /animation\.(disable|enable)\(\)/);
  });

  it("sweeps a row auto-animate abandoned in its exit state", () => {
    // formkit/auto-animate#231, open: a removal whose `finish` never arrives
    // leaves the row in the document, floating over the list it left. The
    // overlap arrives when an expand lands on the heels of a collapse.
    assert.match(hook, /function sweepAbandonedExits\(node: HTMLElement\)/);
    assert.match(hook, /if \(!\(ABANDONED_MARKER in row\)\) continue;/);
    assert.match(
      hook,
      /row\.getAnimations\(\)\.some\(\(animation\) => animation\.playState === "running"\)/,
    );
    assert.match(hook, /row\.remove\(\);/);
    assert.match(hook, /const observer = new MutationObserver\(\(\) => \{/);
    assert.match(hook, /observer\.observe\(node, \{ childList: true \}\);|observer\.observe\(node, \{ childList: true \}\)/);
    assert.match(hook, /observer\.disconnect\(\);/);
    assert.match(hook, /formkit\/auto-animate\/issues\/231/);
  });

  it("reads the marker the installed library actually sets", () => {
    // The sweep keys off a private field. If a library upgrade renames it the
    // sweep would silently stop working, so this fails instead.
    assert.match(library, /const DEL = "__aa_del";/);
    assert.match(hook, /const ABANDONED_MARKER = "__aa_del";/);
    // And the three styles it looks for are the ones `remove` applies.
    assert.match(library, /position: "absolute",/);
    assert.match(library, /pointerEvents: "none",/);
    assert.match(library, /zIndex: "100",/);
    for (const style of ['position: "absolute"', 'zIndex: "100"', 'pointerEvents: "none"']) {
      assert.ok(
        hook.includes(style),
        `the sweep does not check ${style}`,
      );
    }
  });

  it("is declared once and attached to every row container", async () => {
    for (const [relative, name] of CONTAINERS) {
      const source = await readFile(new URL(relative, import.meta.url), "utf8");
      assert.match(
        source,
        /import \{ useListAutoAnimate \} from "@\/hooks\/use-list-auto-animate";/,
        `${relative} does not import the hook`,
      );
      assert.ok(
        source.includes(`const ${name} =`) && source.includes(`ref={${name}}`),
        `${relative} declares and uses ${name}`,
      );
    }
  });

  it("runs the parked shelf's hook above its empty return", () => {
    const declared = inbox.indexOf(
      "const attachListAutoAnimateRef = useListAutoAnimate<HTMLUListElement>();",
    );
    const earlyReturn = inbox.indexOf("if (count === 0) return null;");
    assert.notEqual(declared, -1);
    assert.notEqual(earlyReturn, -1);
    assert.ok(
      declared < earlyReturn,
      "a shelf that draws nothing still has to run its hooks",
    );
  });
});
