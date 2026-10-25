import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BULK_DELETE_TOKEN_TTL_MS,
  BulkDeleteTokenError,
  createBulkDeleteCoordinator,
  familyProtection,
  MAX_BULK_DELETE_ROOTS,
  type BulkDeleteFamilySnapshot,
  type BulkDeleteThreadSnapshot,
} from "../lib/bulk-delete.ts";

function thread(
  id: string,
  overrides: Partial<BulkDeleteThreadSnapshot> = {},
): BulkDeleteThreadSnapshot {
  return {
    id,
    title: id,
    parentThreadId: null,
    status: "idle",
    hasPendingInteraction: false,
    isPinned: false,
    isUnread: false,
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
    },
    ...overrides,
  };
}

function family(
  id: string,
  children: readonly BulkDeleteThreadSnapshot[] = [],
  rootOverrides: Partial<BulkDeleteThreadSnapshot> = {},
): BulkDeleteFamilySnapshot {
  return { root: thread(id, rootOverrides), descendants: children };
}

function harness(initial: readonly BulkDeleteFamilySnapshot[]) {
  let now = 10_000;
  let tokenIndex = 0;
  const rows = new Map(initial.map((entry) => [entry.root.id, entry]));
  const deleteCalls: Array<{
    id: string;
    childThreadsConfirmed: boolean;
  }> = [];
  const failures = new Set<string>();
  const failureReports: Array<{ id: string; error: unknown }> = [];
  const coordinator = createBulkDeleteCoordinator({
    async readFamily(rootId) {
      return rows.get(rootId) ?? null;
    },
    async deleteRoot(id, childThreadsConfirmed) {
      deleteCalls.push({ id, childThreadsConfirmed });
      if (failures.has(id)) throw new Error(`cannot delete ${id}`);
      rows.delete(id);
    },
    now: () => now,
    createToken: () => `token-${++tokenIndex}`,
    reportFailure(id, error) {
      failureReports.push({ id, error });
    },
  });
  return {
    coordinator,
    rows,
    deleteCalls,
    failures,
    failureReports,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe("familyProtection", () => {
  it("fails closed for current, live, waiting, unread, and pinned descendants", () => {
    assert.equal(familyProtection(family("a"), "a"), "current");
    assert.equal(
      familyProtection(family("a", [thread("c", { status: "active" })]), null),
      "working",
    );
    assert.equal(
      familyProtection(
        family("a", [thread("c", { hasPendingInteraction: true })]),
        null,
      ),
      "waiting",
    );
    assert.equal(
      familyProtection(family("a", [thread("c", { isUnread: true })]), null),
      "unread",
    );
    assert.equal(
      familyProtection(family("a", [thread("c", { isPinned: true })]), null),
      "pinned",
    );
    assert.equal(familyProtection(family("a"), null), null);
  });

  it("treats unknown statuses as live instead of guessing they are safe", () => {
    assert.equal(
      familyProtection(family("a", [], { status: "future-status" }), null),
      "working",
    );
  });

  it("rejects a child promoted into the visible root position", () => {
    assert.equal(
      familyProtection(
        family("child", [], { parentThreadId: "missing-parent" }),
        null,
      ),
      "overlap",
    );
  });
});

describe("bulk delete preview", () => {
  it("counts roots and recursive children and binds current-thread protection", async () => {
    const test = harness([
      family("a", [thread("a-child")]),
      family("b"),
      family("current"),
    ]);
    const preview = await test.coordinator.preview(
      ["a", "b", "current", "missing"],
      "current",
    );
    assert.equal(preview.token, "token-1");
    assert.equal(preview.rootCount, 2);
    assert.equal(preview.childCount, 1);
    assert.equal(preview.totalThreadCount, 3);
    assert.deepEqual(
      preview.included.map((entry) => entry.id),
      ["a", "b"],
    );
    assert.deepEqual(
      preview.skipped.map((entry) => [entry.id, entry.reason]),
      [
        ["current", "current"],
        ["missing", "missing"],
      ],
    );
  });

  it("rejects empty, duplicate, and oversized root sets", async () => {
    const test = harness([family("a")]);
    await assert.rejects(test.coordinator.preview([], null), RangeError);
    await assert.rejects(
      test.coordinator.preview(["a", "a"], null),
      /selected only once/,
    );
    await assert.rejects(
      test.coordinator.preview(
        Array.from({ length: MAX_BULK_DELETE_ROOTS + 1 }, (_, index) =>
          `root-${index}`,
        ),
        null,
      ),
      RangeError,
    );
  });

  it("rejects overlapping root and descendant selections", async () => {
    const test = harness([
      family("root", [thread("child")]),
      family("child"),
    ]);
    const preview = await test.coordinator.preview(["root", "child"], null);
    assert.deepEqual(
      preview.skipped.map((entry) => [entry.id, entry.reason]),
      [["root", "overlap"]],
    );
    assert.deepEqual(preview.included.map((entry) => entry.id), ["child"]);
  });
});

describe("bulk delete confirmation", () => {
  it("confirms child trees, consumes the token, and preserves stable order", async () => {
    const test = harness([
      family("a", [thread("a-child")]),
      family("b"),
    ]);
    const preview = await test.coordinator.preview(["a", "b"], null);
    assert.ok(preview.token);
    const result = await test.coordinator.confirm(preview.token);
    assert.deepEqual(result, { deleted: ["a", "b"], skipped: [], failed: [] });
    assert.deepEqual(test.deleteCalls, [
      { id: "a", childThreadsConfirmed: true },
      { id: "b", childThreadsConfirmed: false },
    ]);
    await assert.rejects(
      test.coordinator.confirm(preview.token),
      BulkDeleteTokenError,
    );
  });

  it("expires a preview without mutating anything", async () => {
    const test = harness([family("a")]);
    const preview = await test.coordinator.preview(["a"], null);
    assert.ok(preview.token);
    test.advance(BULK_DELETE_TOKEN_TTL_MS);
    await assert.rejects(
      test.coordinator.confirm(preview.token),
      BulkDeleteTokenError,
    );
    assert.deepEqual(test.deleteCalls, []);
  });

  it("revalidates, skips changed state, and continues after one failure", async () => {
    const test = harness([family("a"), family("b"), family("c")]);
    const preview = await test.coordinator.preview(["a", "b", "c"], null);
    assert.ok(preview.token);
    test.rows.set("a", family("a", [], { isUnread: true }));
    test.failures.add("b");
    const result = await test.coordinator.confirm(preview.token);
    assert.deepEqual(
      result.skipped.map((entry) => [entry.id, entry.reason]),
      [["a", "unread"]],
    );
    assert.deepEqual(result.failed, [
      {
        id: "b",
        message: "Deletion failed. Review the thread and try again.",
      },
    ]);
    assert.deepEqual(result.deleted, ["c"]);
    assert.equal(test.failureReports[0]?.id, "b");
    assert.match(String(test.failureReports[0]?.error), /cannot delete b/);
    assert.deepEqual(
      test.deleteCalls.map((call) => call.id),
      ["b", "c"],
    );
  });

  it("refuses a deletion when the descendant identity set grew after preview", async () => {
    const test = harness([family("a", [thread("child-1")])]);
    const preview = await test.coordinator.preview(["a"], null);
    assert.ok(preview.token);
    test.rows.set("a", family("a", [thread("child-1"), thread("child-2")]));

    const result = await test.coordinator.confirm(preview.token);

    assert.deepEqual(result.deleted, []);
    assert.deepEqual(result.failed, []);
    assert.deepEqual(
      result.skipped.map((entry) => [entry.id, entry.reason]),
      [["a", "scope-changed"]],
    );
    assert.deepEqual(test.deleteCalls, []);
  });

  it("refuses a deletion when a reviewed descendant disappeared", async () => {
    const test = harness([family("a", [thread("child-1")])]);
    const preview = await test.coordinator.preview(["a"], null);
    assert.ok(preview.token);
    test.rows.set("a", family("a"));

    const result = await test.coordinator.confirm(preview.token);

    assert.deepEqual(
      result.skipped.map((entry) => entry.reason),
      ["scope-changed"],
    );
    assert.deepEqual(test.deleteCalls, []);
  });
});
