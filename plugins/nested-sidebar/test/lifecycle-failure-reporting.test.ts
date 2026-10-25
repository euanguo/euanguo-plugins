/**
 * The lifecycle paths that can fail without the row showing it.
 *
 * Each of these three used to answer `{ ok: true }` no matter what the host
 * said, so a failure was indistinguishable from a success on the surface the
 * user was looking at. Measured against the running plugin before the fix:
 * `unsettle` and `snooze` both answered `{"ok":true}` for a thread id that does
 * not exist, and `settle` wrote a row for it.
 *
 * The snooze path is the one that loses data rather than merely misleading:
 * bb's sidebar view is built from `archived: false`, and `listSettledThreads`
 * only reports settled rows, so a thread whose unarchive failed while a snooze
 * row was written is drawn by neither — it is gone until bb is asked for its
 * archive by hand.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { readBackend } from "./_sources.ts";

const server = await readBackend();
const rpc = await readFile(new URL("../server/contract.ts", import.meta.url), "utf8");
const lifecycle = await readFile(
  new URL("../hooks/use-lifecycle.ts", import.meta.url),
  "utf8",
);

const body = (name: string, nextName: string): string => {
  const start = server.indexOf(`async ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const end = server.indexOf(`async ${nextName}(`, start);
  assert.notEqual(end, -1);
  return server.slice(start, end);
};

describe("the lifecycle RPCs report what the host actually did", () => {
  it("settle says whether bb's archive landed", () => {
    assert.match(
      rpc,
      /settle: \{\s*input: threadIdSchema,\s*output: z\.object\(\{ ok: z\.boolean\(\), archived: z\.boolean\(\) \}\),\s*\}/,
    );
    assert.match(body("settle", "unsettle"), /archived: archivedThreadIds\.length > 0/);
  });

  it("snooze refuses instead of losing the thread", () => {
    const snooze = body("snooze", "unsnooze");
    // The archive is taken back FIRST, and a failure stops the row write. The
    // order matters: a row written before the unarchive is the lost-thread case.
    const unarchiveAt = snooze.indexOf("unarchiveThreads(archivedIdsFor(threadId))");
    const writeAt = snooze.indexOf("write({");
    assert.notEqual(unarchiveAt, -1, "snooze takes the archive back");
    assert.notEqual(writeAt, -1, "snooze writes a row");
    assert.ok(
      unarchiveAt < writeAt,
      "the unarchive has to be attempted before the row says it succeeded",
    );
    assert.match(snooze, /if \(failure !== null\) return \{ ok: false, message: failure \};/);
    assert.match(snooze, /return \{ ok: true, message: null \};/);
  });

  it("unsettle carries the failure out to the caller", () => {
    assert.match(body("unsettle", "snooze"), /return \{ ok: true, message: failure \};/);
  });
});

describe("the frontend says the failure out loud", () => {
  it("announces a settle whose archive did not land", () => {
    assert.match(lifecycle, /if \(!result\.archived\) \{/);
    assert.match(lifecycle, /Settled, but bb could not archive this thread/);
  });

  it("announces a snooze the backend refused", () => {
    assert.match(lifecycle, /if \(!result\.ok\) \{/);
    assert.match(lifecycle, /Could not snooze this thread/);
  });

  it("announces an un-settle that could not take the archive back", () => {
    assert.match(lifecycle, /result\.message !== null/);
    assert.match(lifecycle, /still in bb's archived view/);
  });

  it("does not fall back to a silent catch", () => {
    // The old shape was `void rpc.call(...)`, whose rejection had nowhere to
    // go. Every one of these three now has a catch that speaks.
    for (const method of ["settle", "unsettle", "snooze"]) {
      assert.match(
        lifecycle,
        new RegExp(`const ${method} = async`),
        `${method} owns its outcome`,
      );
    }
  });
});
