import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TAB_CLASS,
  TAB_FLOOR_SIZER_CLASS,
  workspaceTabSizingClass,
} from "../components/header/workspace-tab-sizing.ts";
import { cn } from "../lib/ui/utils.ts";

describe("workspaceTabSizingClass", () => {
  it("uses content-bounded automatic min-width for multi-tab scrolling items without stretching short tabs", () => {
    const resolved = cn(
      TAB_CLASS,
      workspaceTabSizingClass({ isPinned: false, singleScrollingTab: false }),
    );
    const tokens = resolved.split(/\s+/u);

    assert.ok(tokens.includes("shrink"));
    assert.ok(tokens.includes("min-w-auto"));
    assert.ok(tokens.includes("max-w-56"));
    assert.equal(tokens.includes("min-w-0"), false);
    assert.equal(tokens.includes("min-w-40"), false);
    assert.equal(tokens.includes("shrink-0"), false);
  });

  it("keeps pinned tabs fixed at content width up to max-w-56", () => {
    const resolved = cn(
      TAB_CLASS,
      workspaceTabSizingClass({ isPinned: true, singleScrollingTab: false }),
    );
    const tokens = resolved.split(/\s+/u);

    assert.ok(tokens.includes("shrink-0"));
    assert.ok(tokens.includes("min-w-0"));
    assert.ok(tokens.includes("max-w-56"));
    assert.equal(tokens.includes("shrink"), false);
    assert.equal(tokens.includes("min-w-auto"), false);
  });

  it("allows a single scrolling tab to shrink freely without forcing a floor", () => {
    const resolved = cn(
      TAB_CLASS,
      workspaceTabSizingClass({ isPinned: false, singleScrollingTab: true }),
    );
    const tokens = resolved.split(/\s+/u);

    assert.ok(tokens.includes("shrink"));
    assert.ok(tokens.includes("min-w-0"));
    assert.ok(tokens.includes("max-w-56"));
    assert.equal(tokens.includes("shrink-0"), false);
    assert.equal(tokens.includes("min-w-auto"), false);
  });

  it("configures the invisible floor sizer without scroll-container clipping or hard grid column zeroing", () => {
    const tokens = TAB_FLOOR_SIZER_CLASS.split(/\s+/u);

    assert.ok(tokens.includes("max-w-26"));
    assert.ok(tokens.includes("overflow-clip"));
    assert.ok(tokens.includes("whitespace-nowrap"));
    assert.ok(tokens.includes("col-start-1"));
    assert.ok(tokens.includes("row-start-1"));
    assert.equal(tokens.includes("overflow-hidden"), false);
    assert.equal(tokens.includes("grid-cols-1"), false);
  });
});
