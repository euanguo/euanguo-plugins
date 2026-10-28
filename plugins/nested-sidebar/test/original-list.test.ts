import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { readInboxModules } from "./_sources.ts";

const app = await readFile(new URL("../app.tsx", import.meta.url), "utf8");
const inbox = await readInboxModules();
const status = await readFile(
  new URL("../components/inbox/thread-view-status.tsx", import.meta.url),
  "utf8",
);

/**
 * bb's own thread list, offered where a user needs it.
 *
 * The host hands its list over for exactly this: a user whose sidebar is not
 * behaving gets a working one, and a replaced list cannot take the list away from
 * them. It is offered **at the failure** rather than behind a setting, because a
 * sidebar that is not working is the worst possible moment to send someone into
 * Settings to fix it.
 */
describe("the flat recovery list", () => {
  it("is drawn when the user asks for it", () => {
    assert.match(inbox, /<FlatThreadFallback/);
    assert.match(inbox, /if \(showFlatFallback\) \{/);
  });

  it("is offered from the failure, beside the retry", () => {
    assert.match(status, /onUseOriginal: \(\) => void/);
    assert.match(status, /Show flat list/);
    assert.match(
      inbox,
      /onUseOriginal: \(\) => setShowFlatFallback\(true\),/,
    );
  });

  /**
   * Both occupants of the scroll box, so the fallback cannot arrive without the
   * reserved scrollbar lane and the horizontal clip the tree is documented to
   * have. Found by the scroll-geometry test when the fallback had its own literal
   * — which is how it lost the gutter in the first place.
   */
  it("uses the same scroll box as the tree", () => {
    assert.match(inbox, /const TREE_SCROLL_CLASS =/);
    assert.equal(
      (inbox.match(/className=\{TREE_SCROLL_CLASS\}/g) ?? []).length,
      2,
    );
  });

  /**
   * The navigation row above the list is **not** replaced.
   *
   * It was, briefly, and this test is what keeps that from coming back by
   * accident. The destinations are shared chrome — every other plugin's panel is
   * one of them — and the host arranges them already. A plugin that compresses
   * them to icons trades other plugins' discoverability for its own room, and
   * the reason to do it was never anything but "the slot exists".
   */
  it("leaves the host's navigation row alone", () => {
    assert.doesNotMatch(app, /experimental_sidebarNavigation/);
    assert.doesNotMatch(app, /NestSidebarNavigation/);
  });
});
