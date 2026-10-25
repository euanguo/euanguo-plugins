import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const inbox = await readFile(
  new URL("../components/inbox/thread-inbox.tsx", import.meta.url),
  "utf8",
);
const status = await readFile(
  new URL("../components/inbox/thread-view-status.tsx", import.meta.url),
  "utf8",
);
const hook = await readFile(
  new URL("../hooks/use-thread-view.ts", import.meta.url),
  "utf8",
);
const server = await readFile(new URL("../server.ts", import.meta.url), "utf8");

/**
 * The recovery path is three pieces that only work together: the hook that
 * resolves the rows, the notice that admits a stale tree, and the failure state
 * that offers the retry. Each is easy to delete on its own and hard to notice
 * missing, so the wiring is pinned here.
 */
describe("thread view recovery wiring", () => {
  it("draws from the resolved view, not straight from the host hook", () => {
    assert.match(inbox, /const \{ view, status, recovering, recoveryError, recover \} = useThreadView\(\)/);
    assert.match(inbox, /const hostThreads = view\.threads/);
    assert.match(inbox, /const projects = view\.projects/);
    // The raw hook has no recovery and no retention, so a second call here
    // would quietly restore the behaviour this replaced.
    assert.doesNotMatch(inbox, /useSidebarThreads\(\)/);
  });

  it("shows the notice above the tree rather than in place of it", () => {
    assert.match(inbox, /const viewNotice = threadViewNotice\(view\.source\)/);
    // Before the branches that decide the body: a stale tree with nothing to
    // show still owes the user the reason.
    const notice = inbox.indexOf("<ThreadViewNotice text={viewNotice} />");
    const branch = inbox.indexOf('view.source === "none"');
    assert.ok(notice >= 0 && branch > notice);
  });

  it("offers the retry only where there is nothing to draw", () => {
    assert.match(
      inbox,
      /view\.source === "none" \? \(\s*status === "error" \? \(\s*<ThreadLoadFailure/,
    );
    assert.match(inbox, /onRetry=\{recover\}/);
  });

  it("renders a failed retry's own reason", () => {
    assert.match(status, /error: string \| null/);
    assert.match(status, /\{error\}/);
    // A spinner while the read is in flight, so a slow backend is not a dead
    // button.
    assert.match(status, /recovering \? \(/);
  });

  /**
   * A retry has to be a read, not a re-render. `experimental_useSidebarThreads`
   * has no refetch, so the only way back is the plugin's own backend reading
   * bb's SDK.
   */
  it("backs the retry with a real read of bb's thread table", () => {
    assert.match(hook, /rpc\s*\.call\("listThreadsForRecovery"/);
    assert.match(server, /listThreadsForRecovery: \{/);
    assert.match(server, /async listThreadsForRecovery\(\) \{/);
    assert.match(server, /bb\.sdk\.threads\.list\(/);
  });

  /**
   * Hidden threads are excluded. The host's sidebar view does not draw them, so
   * a recovery that resurrected them would show the user rows bb is keeping out
   * on purpose.
   */
  it("keeps hidden threads out of the recovery read", () => {
    assert.match(server, /row\.visibility === "visible"/);
    const read = server.slice(
      server.indexOf("const listVisibleThreadRows"),
      server.indexOf("const listVisibleThreadRows") + 900,
    );
    assert.doesNotMatch(read, /includeHidden/);
  });

  /**
   * A recovery is a fallback, not a second source of truth. Once the host is
   * answering again the recovered copy is an older duplicate of the same list,
   * and keeping it would let a later outage resurrect rows that have moved on.
   */
  it("forgets a recovery once the host answers again", () => {
    assert.match(hook, /if \(status !== "ready"\) return;\s*setRecovered\(null\)/);
  });

  /**
   * The retained answer is written during render. An effect would have to
   * compare the new answer with the retained one first, and the host hands out a
   * fresh array every render — so an identity check would set state on every
   * render and loop.
   */
  it("retains the last good answer without an effect", () => {
    assert.match(hook, /if \(status === "ready"\) \{\s*lastGoodHostRef\.current = \{ threads, projects \}/);
    assert.doesNotMatch(hook, /setLastGoodHost/);
  });
});