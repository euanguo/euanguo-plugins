import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { readBackend, readInboxModules } from "./_sources.ts";

const server = await readBackend();
const rpc = (
  await Promise.all([
    readFile(new URL("../server/contract.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../server/contract-schemas.ts", import.meta.url),
      "utf8",
    ),
  ])
).join("\n");
const hook = await readFile(
  new URL("../hooks/use-nest-order.ts", import.meta.url),
  "utf8",
);
const inbox = await readInboxModules();
const status = await readFile(
  new URL("../components/inbox/thread-view-status.tsx", import.meta.url),
  "utf8",
);

/**
 * The arrangement is shared and two clients hold it at once, so a write carries
 * the revision its order was read at and a stale one is refused rather than
 * merged. This pins the three ends of that: the server's answer, the client's
 * bookkeeping, and the notice the user gets.
 */
describe("order revision wiring", () => {
  it("answers every write with the revision and whether it was stale", () => {
    assert.match(rpc, /(?:export )?const orderWriteSchema = z\.object\(\{/);
    assert.match(rpc, /stale: z\.boolean\(\)/);
    assert.match(rpc, /revision: z\.number\(\)\.int\(\)\.nonnegative\(\)/);
    // All three scopes, or one of them would be the hole this exists to close.
    assert.equal((rpc.match(/output: orderWriteSchema,/g) ?? []).length, 3);
    assert.equal(
      (rpc.match(/baseRevision: z\.number\(\)\.int\(\)\.nonnegative\(\),/g) ?? [])
        .length,
      3,
    );
  });

  it("reads the revision out with the arrangement", () => {
    assert.match(server, /return \{ \.\.\.orders\.list\(\), revision: orders\.revision\(\) \}/);
  });

  // A stale refusal changed nothing, so telling every client to re-read would be
  // a round trip per refused drag.
  it("publishes only when the write landed", () => {
    assert.match(
      server,
      /const orderOutcome = \(result: OrderWrite\) => \{\s*if \(result\.ok\) bb\.realtime\.publish\(ORDER_CHANNEL, \{\}\);/,
    );
  });

  it("sends the revision it read at, from a ref rather than a closure", () => {
    // Read at send time, not at render time: a value closed over by the handler
    // would be the revision of the render that created it.
    assert.match(hook, /const result = await send\(revisionRef\.current\)/);
    assert.match(hook, /const revisionRef = useRef\(0\)/);
    assert.match(hook, /revisionRef\.current = result\.revision/);
    // All three scopes carry it, or one of them is the hole this exists to close.
    assert.match(
      hook,
      /rpc\.call\("reorderProjects", \{ groupId, projectIds: next, baseRevision \}\)/,
    );
    assert.match(
      hook,
      /rpc\.call\("reorderFamilies", \{ projectId, rootIds: next, baseRevision \}\)/,
    );
    assert.match(
      hook,
      /rpc\.call\("reorderWorkspaces", \{\s*projectId,\s*workspaceKeys: next,\s*baseRevision,/,
    );
  });

  /**
   * A read follows a refused write as well as a reload, so clearing the notice
   * on a read would hide the refusal that had just raised it.
   */
  it("clears the stale state only on a reload or a write that landed", () => {
    assert.match(hook, /if \(result\.ok\) setChangedElsewhere\(false\);/);
    assert.match(hook, /else if \(result\.stale\) setChangedElsewhere\(true\);/);
    assert.match(hook, /const reload = useCallback\(\(\) => \{\s*setChangedElsewhere\(false\);/);
    // Not in the read path.
    const read = hook.slice(hook.indexOf("listManualOrder"), hook.indexOf("useCoalescedRealtime"));
    assert.doesNotMatch(read, /setChangedElsewhere/);
  });

  // The echo of a drag is taken back when the write did not land, because the
  // echoed order is then not the one the server holds.
  it("refreshes on a refusal, so the echo is taken back", () => {
    assert.match(hook, /if \(!result\.ok\) refresh\(\);/);
  });

  it("tells the user, with the one button that fixes it", () => {
    assert.match(status, /export function OrderChangedNotice/);
    assert.match(status, /The order changed in another window/);
    assert.match(status, /onReload/);
    assert.match(inbox, /<OrderChangedNotice onReload=\{ordering\.reload\} \/>/);
    assert.match(inbox, /ordering\.changedElsewhere \? \(/);
  });

  /**
   * Appended, never inserted. bb checks the migration journal by index, so a
   * statement added in the middle rewrites the history of every database that
   * already ran it.
   *
   * Expressed as an order rather than as "the array ends with this one", which
   * is what this used to assert: that check fails the first time a migration is
   * legitimately appended, which is the one thing the rule asks for. What has to
   * hold is that every statement appears once, and that the ones added later
   * come after the ones that shipped before them.
   */
  it("appends the migration journal rather than inserting into it", () => {
    const migrations = server.slice(
      server.indexOf("const migrations"),
      server.indexOf("export interface StoredLifecycleRow"),
    );
    const order = [
      "PROJECT_COLOR_MIGRATION",
      "GROUP_MIGRATION",
      "GROUP_ASSIGNMENT_MIGRATION",
      "MANUAL_ORDER_MIGRATION",
      "VIEW_PREFERENCE_MIGRATION",
      "SCOPE_ICON_MIGRATION",
      "PROJECT_ICON_MIGRATION",
      "ORDER_REVISION_MIGRATION",
      "SIDEBAR_INDEX_MIGRATION",
    ];
    let cursor = -1;
    for (const name of order) {
      const at = migrations.indexOf(name);
      assert.ok(at > cursor, `${name} comes after the statement before it`);
      cursor = at;
    }
    assert.match(migrations, /ORDER_REVISION_MIGRATION,\n\s*SIDEBAR_INDEX_MIGRATION,\n\];/);
  });
});
