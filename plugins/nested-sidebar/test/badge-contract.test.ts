import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  rollupCounts,
  rollupSummary,
  type StatusRollup,
} from "../lib/rollup.ts";

const badge = await readFile(
  new URL("../components/inbox/rollup-badge.tsx", import.meta.url),
  "utf8",
);
const metadata = await readFile(
  new URL("../components/inbox/row-metadata.tsx", import.meta.url),
  "utf8",
);
const card = await readFile(
  new URL("../components/inbox/thread-card.tsx", import.meta.url),
  "utf8",
);

function rollup(overrides: Partial<StatusRollup> = {}): StatusRollup {
  return {
    kind: "working",
    total: 1,
    failed: 0,
    working: 1,
    needsYou: 0,
    unread: 0,
    discIds: [],
    leadThreadId: "thr_1",
    ...overrides,
  };
}

describe("rollupCounts", () => {
  /**
   * The order is the whole point of a rollup: a folded row is skimmed, and a
   * blocked thread is the one that must not hide behind a running one.
   */
  it("orders by urgency, not by count", () => {
    const counts = rollupCounts(
      rollup({ failed: 1, needsYou: 1, working: 9, unread: 1 }),
    );
    assert.deepEqual(
      counts.map((entry) => entry.kind),
      ["failed", "needs-you", "working", "unread"],
    );
  });

  it("leaves out every signal that is zero", () => {
    assert.deepEqual(rollupCounts(rollup({ working: 3 })), [
      { kind: "working", count: 3 },
    ]);
  });

  it("returns nothing for a quiet subtree", () => {
    assert.deepEqual(
      rollupCounts(rollup({ kind: "inactive", working: 0, total: 4 })),
      [],
    );
  });

  /**
   * One list, two renderings. The dots a row draws and the sentence a screen
   * reader reads come from the same call, so they cannot disagree about which
   * signal came first.
   */
  it("is the same list rollupSummary words", () => {
    const counts = rollup({ failed: 2, needsYou: 1, working: 3 });
    assert.equal(rollupSummary(counts), "2 failed · 1 needs you · 3 working");
    assert.equal(
      rollupSummary(counts),
      rollupCounts(counts)
        .map((entry) => `${entry.count} ${entry.kind.replace("-", " ")}`)
        .join(" · "),
    );
  });

  it("still says nothing for a rollup with no counts", () => {
    assert.equal(rollupSummary(rollup({ kind: "inactive", working: 0 })), "");
  });
});

/**
 * The badge used to be a single dot, on the argument that a narrow navigation
 * surface has no room for counts. That argument was wrong in the one place it
 * mattered — two working threads and one waiting on you are the same dot and
 * very different mornings — so the badge now draws the breakdown the README had
 * been promising all along.
 */
describe("RollupBadge", () => {
  it("wears the same chip a thread with children wears", () => {
    // One shape for one question, at every level that has threads under it: the
    // threads named by colour, how many, on a ground tinted by the state. The
    // predecessor drew a dot and a count per signal instead, which made a
    // project's five threads and a thread's three children read as different
    // kinds of thing.
    assert.match(badge, /cn\(STATE_CHIP_CLASS, className\)/);
    assert.match(badge, /style=\{\{ color: familyStatusColor\(presentation\) \}\}/);
    assert.match(badge, /<DiscCluster/);
    assert.match(
      badge,
      /threads=\{rollup\.discIds\.map\(\(id\) => \(\{ id \}\)\)\}/,
    );
    // The number is the size of the reason to open the row, not the size of the
    // branch: a project with twenty-eight threads of which two are moving says 2.
    assert.match(badge, /const signals = rollupSignalCount\(rollup\);/);
    assert.match(badge, /<span className="tabular-nums">\{signals\}<\/span>/);
    assert.doesNotMatch(badge, /tabular-nums">\{rollup\.total\}/);
    // And no per-signal dots left over: the breakdown moved to the label.
    assert.doesNotMatch(badge, /StatusDot|rollupCounts/);
  });

  it("keeps the breakdown, in the label rather than on the row", () => {
    // The counts are what `●2 ●1` said at a glance; the chip's ground says the
    // dominant state and the title says the rest.
    assert.match(badge, /rollupSummary\(rollup\)/);
    assert.equal(
      badge.match(/title=\{label\}/g)?.length,
      1,
      "the summary is the title",
    );
  });

  it("still draws nothing for a quiet subtree", () => {
    assert.match(
      badge,
      /rollup\.total === 0 \|\|\s*rollup\.kind === "inactive" \|\|\s*rollup\.kind === "stale"/,
    );
  });

  // Nothing here is only a colour: the wording is on the title and the label.
  it("keeps the wording on the title and the accessible label", () => {
    assert.match(badge, /title=\{label\}/);
    assert.match(badge, /<span className="sr-only">\{label\}<\/span>/);
  });

  /**
   * Found in the running app: a folded row was read out as "Working · 1
   * working", because the title prefixed the dominant state's label to a summary
   * whose first entry already named it. The summary is complete on its own — its
   * first entry *is* the dominant state, in priority order — so the label
   * survives only as the fallback for a rollup with no counts to name.
   */
  it("does not say the dominant state twice", () => {
    // Both numbers and the breakdown, in one string: "2 of 9 threads: 1 working
    // · 1 unread". The summary's first entry *is* the dominant state, so the
    // label is never prefixed to it — that is what made a folded row read out as
    // "Working · 1 working" in the running app.
    assert.match(
      badge,
      /const label =\n\s+summary === ""\n\s+\? presentation\.label\n\s+: `\$\{signals\} of \$\{rollup\.total\} threads: \$\{summary\}`;/,
    );
    assert.doesNotMatch(badge, /title=\{`\$\{presentation\.label\}/);
  });
});

/**
 * Subagents and child threads are different things, and bb's own documentation
 * says so: a fork is a child thread, a subagent spawned inside a turn is
 * `activity.backgroundAgents` on its parent. One merged number would tell the
 * user a thread has four children when it has one child and three helpers.
 */
describe("SubagentBadge", () => {
  it("counts subagents, not children", () => {
    assert.match(metadata, /export function SubagentBadge/);
    assert.match(metadata, /`\$\{count\} subagent\$\{count === 1 \? "" : "s"\} running`/);
  });

  it("is drawn on the root row, apart from the child disclosure", () => {
    const subagent = card.indexOf("<SubagentBadge");
    // The child disclosure is the chip that controls the child list; the
    // subagent badge is a plain count before it, so the two cannot be read as
    // one figure.
    const disclosure = card.indexOf("controls={childListId}");
    assert.ok(subagent >= 0, "the badge is rendered");
    assert.ok(disclosure >= 0, "the child disclosure is still the chip");
    assert.ok(
      subagent < disclosure,
      "the subagent count is not the child disclosure",
    );
    assert.match(card, /<SubagentBadge count=\{thread\.activity\.backgroundAgents\} \/>/);
  });

  it("makes the row's metadata rail appear for a subagent count alone", () => {
    assert.match(
      card,
      /thread\.activity\.backgroundAgents > 0 \|\|\s*\(preferences\.showPullRequestMetadata/,
    );
  });

  // The chip that used to carry this was never registered anywhere — a leftover
  // from the fork, kept alive only by its own file. The capability is back, and
  // named for what it draws; this is what keeps it from going dead a second
  // time, which is the failure the old name stood for.
  it("leaves no dead subagent chip behind", async () => {
    const entries = await readdir(
      new URL("../components/inbox/", import.meta.url),
    );
    assert.ok(!entries.includes("subagents-chip.tsx"));
    assert.ok(entries.includes("children-chip.tsx"));
    const app = await readFile(new URL("../app.tsx", import.meta.url), "utf8");
    assert.match(app, /import \{ ChildrenChip \} from "@\/components\/inbox\/children-chip";/);
    assert.match(app, /component: ChildrenChip,/);
  });
});