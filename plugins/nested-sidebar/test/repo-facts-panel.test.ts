import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const panel = await readFile(
  new URL("../components/settings/repo-facts-panel.tsx", import.meta.url),
  "utf8",
);

describe("the repository report", () => {
  /**
   * A path is read from its end.
   *
   * `…/worktrees/tab-nest-3c0de-08b129d6` is what identifies a worktree, and it
   * is exactly what a leading `truncate` cuts off. The first draft truncated
   * from the front and every row read `…/Users/euanguo/…`.
   */
  it("keeps the end of a path, and shortens the home prefix", () => {
    assert.match(panel, /<TruncateStart/);
    assert.match(panel, /formatHomePathForDisplay\(worktree\.path\)/);
    // The full path stays reachable on hover, since the drawn one is shortened.
    assert.match(panel, /title=\{worktree\.path\}/);
  });

  /**
   * Seven of twelve repositories are clean on a normal machine. Giving each of
   * them a second line for its remote is what turned this panel into a scroll;
   * a clean repository is one row, name left and remote right.
   */
  it("draws a clean repository as one row", () => {
    assert.match(panel, /data-nest-repo-clean/);
    // The remote shares the row instead of taking one of its own.
    assert.match(
      panel,
      /if \(!findings\) \{[\s\S]*?<TruncateStart className="min-w-0 flex-1/,
    );
  });

  /**
   * `unseen-worktree` restates the list two lines above it. A diagnostic is
   * worth a line only when it says something the list cannot.
   */
  it("does not repeat the worktree list as a diagnostic", () => {
    assert.match(panel, /diagnostic\.code !== "unseen-worktree"/);
  });

  it("counts what it found instead of writing a paragraph about it", () => {
    for (const label of [
      "repositories",
      "unregistered worktrees",
      "ownership conflicts",
    ]) {
      assert.ok(panel.includes(label), `the summary counts ${label}`);
    }
  });
});
