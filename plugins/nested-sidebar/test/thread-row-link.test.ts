import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  threadRowAriaCurrent,
  threadRowSplitClick,
} from "../lib/thread-row-link.ts";

describe("thread row link", () => {
  it("marks only the active row as the current page", () => {
    assert.equal(threadRowAriaCurrent(true), "page");
    assert.equal(threadRowAriaCurrent(false), undefined);
  });

  it("splits on meta or ctrl, and not on other modifiers", () => {
    assert.equal(threadRowSplitClick({ metaKey: true, ctrlKey: false }), true);
    assert.equal(threadRowSplitClick({ metaKey: false, ctrlKey: true }), true);
    assert.equal(threadRowSplitClick({ metaKey: true, ctrlKey: true }), true);
    assert.equal(threadRowSplitClick({ metaKey: false, ctrlKey: false }), false);
  });
});
