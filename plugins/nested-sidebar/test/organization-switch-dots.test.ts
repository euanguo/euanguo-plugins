import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [switchFile, inboxView, rollup, featureView] = await Promise.all([
  read("components/inbox/organization-switch.tsx"),
  read("lib/inbox-view.ts"),
  read("lib/rollup.ts"),
  read("lib/feature-view.ts"),
]);

/**
 * The status dots on the bottom switch.
 *
 * Two options, each saying what the list behind it is doing: one dot per kind,
 * stacked when several kinds are present, and each kind only once however many
 * threads are in it. The count is in the dot's tooltip, not in its width.
 */
describe("the switch's status dots", () => {
  it("draws one dot per signal, keyed by kind", () => {
    assert.match(switchFile, /signals\.map\(\(signal, index\)/);
    assert.match(switchFile, /key=\{signal\.kind\}/);
    assert.match(switchFile, /<StatusDot/);
    assert.match(switchFile, /title=\{`\$\{presentation\.label\} · \$\{signal\.count\}`\}/);
  });

  it("stacks them in the corner without moving the label", () => {
    assert.match(switchFile, /absolute right-0\.5 top-0\.5 flex items-center/);
    assert.match(switchFile, /index > 0 && "-ml-\[3px\]"/);
    assert.match(switchFile, /shadow-\[0_0_0_2px_var\(--sidebar-accent\)\]/);
    assert.match(switchFile, /shadow-\[0_0_0_2px_var\(--sidebar\)\]/);
    assert.match(switchFile, /"relative flex h-6 flex-1/);
  });

  it("puts the project signals on Projects and feature signals on Features", () => {
    assert.match(switchFile, /axis\.mode === "project"\s*\?\s*projectSignals/);
    assert.match(switchFile, /axis\.mode === "feature"\s*\?\s*featureSignals/);
  });

  it("lists each kind once, in urgency order", () => {
    assert.match(rollup, /export interface StatusSignal/);
    assert.match(rollup, /kind: "failed"/);
    assert.match(rollup, /kind: "needs-you"/);
    assert.match(rollup, /kind: "working"/);
    assert.match(rollup, /kind: "unread"/);
    assert.match(rollup, /filter\(\(signal\) => signal\.count > 0\)/);
  });

  /** The switch reports the queue, not the tab, search or status filter. */
  it("reads the list before the tab scope and the search", () => {
    assert.match(inboxView, /projectUnfilteredGroups\.flatMap\(\(group\) => group\.families\)/);
    assert.match(inboxView, /unfilteredProjectGroups\.flatMap\(\(group\) => group\.families\)/);
    assert.match(inboxView, /rollupFeatureFamilies\(\{/);
    assert.match(featureView, /export function rollupFeatureFamilies/);
  });
});
