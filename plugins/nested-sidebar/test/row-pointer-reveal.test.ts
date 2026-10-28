import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { readThreadCardModules } from "./_sources.ts";

const reveal = await readFile(
  new URL("../components/inbox/row-actions.tsx", import.meta.url),
  "utf8",
);
const animation = await readFile(
  new URL("../hooks/use-list-auto-animate.ts", import.meta.url),
  "utf8",
);
const card = await readThreadCardModules();

describe("row reveal after a list mutation", () => {
  it("publishes the initial layout and the position after the exit animation", () => {
    assert.match(animation, /publishRowLayoutChanged\(\)/);
    assert.match(animation, /EXIT_MS \+ 16/);
    assert.match(animation, /disableExitPointerTargets/);
    assert.match(animation, /row\.inert = true/);
  });

  it("rechecks the stationary pointer against the row's real hit area", () => {
    assert.match(reveal, /ROW_LAYOUT_CHANGED_EVENT/);
    assert.match(reveal, /document\.elementFromPoint/);
    assert.match(reveal, /node\.contains\(hit\)/);
    assert.match(reveal, /rememberRowPointer/);
  });

  it("attaches the same element the pointer check measures to the card", () => {
    assert.match(card, /const reveal = useRowReveal<HTMLDivElement>\(\)/);
    assert.match(card, /ref=\{reveal\.ref\}/);
    assert.match(card, /\{\.\.\.reveal\.handlers\}/);
  });
});
