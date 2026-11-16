import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import Database from "better-sqlite3";
import {
  type Parked,
  parkedFromRow,
  resolveShelf,
  rowFromParked,
  type ThreadActivitySignals,
  type ThreadLifecycleRow,
} from "../lib/domain/lifecycle.ts";
import { decodeWarmStartRows } from "../lib/persistence/warm-start.ts";
import { createLifecycleService } from "../server/lifecycle-service.ts";

const quiet: ThreadActivitySignals = {
  hasPendingInteraction: false,
  isWorking: false,
  isUnread: false,
  latestAttentionAt: 0,
};

const row = (
  overrides: Partial<ThreadLifecycleRow> = {},
): ThreadLifecycleRow => ({
  threadId: "thr_1",
  settledAt: null,
  snoozedUntil: null,
  snoozedAt: null,
  ...overrides,
});

function serviceWithDb(): {
  lifecycle: ReturnType<typeof createLifecycleService>;
  db: Database.Database;
} {
  const bb = { realtime: { publish: () => undefined } } as unknown as BbPluginApi;
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE thread_lifecycle (
      thread_id TEXT PRIMARY KEY,
      settled_at INTEGER,
      snoozed_until INTEGER,
      snoozed_at INTEGER,
      archived_thread_ids TEXT
    )
  `);
  return { lifecycle: createLifecycleService({ bb, db }), db };
}

function service(): ReturnType<typeof createLifecycleService> {
  return serviceWithDb().lifecycle;
}

describe("parkedFromRow", () => {
  it("returns null when neither column is set", () => {
    assert.equal(parkedFromRow(row()), null);
  });

  it("returns settled when only the settled column is set", () => {
    assert.deepEqual(parkedFromRow(row({ settledAt: 500 })), {
      kind: "settled",
      at: 500,
      archivedThreadIds: [],
    });
  });

  it("returns snoozed when only the snooze columns are set", () => {
    assert.deepEqual(
      parkedFromRow(row({ snoozedUntil: 2_000, snoozedAt: 500 })),
      { kind: "snoozed", until: 2_000, setAt: 500 },
    );
  });

  it("lets snooze win when both columns are set", () => {
    const both = row({
      settledAt: 500,
      snoozedUntil: 2_000,
      snoozedAt: 400,
    });
    assert.deepEqual(parkedFromRow(both), {
      kind: "snoozed",
      until: 2_000,
      setAt: 400,
    });
  });
});

describe("rowFromParked", () => {
  const states: readonly Parked[] = [
    null,
    { kind: "settled", at: 500, archivedThreadIds: ["thr_1"] },
    { kind: "snoozed", until: 2_000, setAt: 400 },
  ];

  it("clears the losing park before writing the row", () => {
    for (const parked of states) {
      const written = rowFromParked(
        row({
          settledAt: 500,
          snoozedUntil: 2_000,
          snoozedAt: 400,
        }),
        parked,
      );
      assert.equal(written.settledAt === null || written.snoozedUntil === null, true);
    }
  });

  it("writes each park to exactly one side", () => {
    assert.deepEqual(
      rowFromParked(row(), states[1]),
      row({ settledAt: 500 }),
    );
    assert.deepEqual(
      rowFromParked(row(), states[2]),
      row({ snoozedUntil: 2_000, snoozedAt: 400 }),
    );
    assert.deepEqual(rowFromParked(row(), null), row());
  });
});

describe("resolveShelf with parked rows", () => {
  it("keeps a legal settled row on the settled shelf", () => {
    assert.equal(
      resolveShelf(row({ settledAt: 500 }), quiet, 1_000),
      "settled",
    );
  });

  it("keeps a legal snoozed row on the snoozed shelf", () => {
    assert.equal(
      resolveShelf(
        row({ snoozedUntil: 2_000, snoozedAt: 500 }),
        quiet,
        1_000,
      ),
      "snoozed",
    );
  });

  it("gives the illegal both-set row the snoozed shelf", () => {
    const both = row({
      settledAt: 500,
      snoozedUntil: 2_000,
      snoozedAt: 500,
    });
    assert.equal(resolveShelf(both, quiet, 1_000), "snoozed");
  });

  it("keeps the old no-activity-wake answer when snoozedAt is missing", () => {
    assert.equal(
      resolveShelf(
        row({ snoozedUntil: 2_000, snoozedAt: null }),
        { ...quiet, latestAttentionAt: Number.MAX_SAFE_INTEGER },
        1_000,
      ),
      "snoozed",
    );
  });
});

describe("the lifecycle service stores a legal parked state", () => {
  it("writes a settled row with null snooze columns", () => {
    const lifecycle = service();
    lifecycle.write({
      threadId: "thr_settled",
      settledAt: 500,
      snoozedUntil: null,
      snoozedAt: null,
      archivedThreadIds: ["thr_settled"],
    });
    const stored = lifecycle.readOne("thr_settled");
    assert.notEqual(stored, undefined);
    assert.equal(stored?.settledAt, 500);
    assert.equal(stored?.snoozedUntil, null);
    assert.equal(stored?.snoozedAt, null);
    assert.deepEqual(stored?.archivedThreadIds, ["thr_settled"]);
  });

  it("writes a snoozed row with null settled columns", () => {
    const lifecycle = service();
    lifecycle.write({
      threadId: "thr_snoozed",
      settledAt: null,
      snoozedUntil: 2_000,
      snoozedAt: 500,
      archivedThreadIds: [],
    });
    const stored = lifecycle.readOne("thr_snoozed");
    assert.notEqual(stored, undefined);
    assert.equal(stored?.settledAt, null);
    assert.equal(stored?.snoozedUntil, 2_000);
    assert.equal(stored?.snoozedAt, 500);
    assert.deepEqual(stored?.archivedThreadIds, []);
  });

  it("normalizes a both-set write to the snoozed side", () => {
    const lifecycle = service();
    lifecycle.write({
      threadId: "thr_both",
      settledAt: 500,
      snoozedUntil: 2_000,
      snoozedAt: 400,
      archivedThreadIds: ["thr_both"],
    });
    const stored = lifecycle.readOne("thr_both");
    assert.equal(stored?.settledAt, null);
    assert.equal(stored?.snoozedUntil, 2_000);
    assert.equal(stored?.snoozedAt, 400);
    assert.deepEqual(stored?.archivedThreadIds, []);
  });

  it("normalizes a both-set row already in the database", () => {
    const { lifecycle, db } = serviceWithDb();
    db.prepare(
      `INSERT INTO thread_lifecycle
         (thread_id, settled_at, snoozed_until, snoozed_at, archived_thread_ids)
       VALUES (?, ?, ?, ?, ?)`,
    ).run("thr_raw", 500, 2_000, 400, '["thr_raw"]');
    const stored = lifecycle.readOne("thr_raw");
    assert.equal(stored?.settledAt, null);
    assert.equal(stored?.snoozedUntil, 2_000);
    assert.equal(stored?.snoozedAt, 400);
    assert.deepEqual(stored?.archivedThreadIds, []);
    db.close();
  });
});

describe("warm start uses the same parked decoder", () => {
  it("repairs a corrupt row with both columns set", () => {
    const rows = decodeWarmStartRows(
      `[
        {
          "threadId": "thr_1",
          "settledAt": 500,
          "snoozedUntil": 2000,
          "snoozedAt": 400
        }
      ]`,
    );
    assert.deepEqual(rows, [
      row({ threadId: "thr_1", snoozedUntil: 2_000, snoozedAt: 400 }),
    ]);
  });
});
