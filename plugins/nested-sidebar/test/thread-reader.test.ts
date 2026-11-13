import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import {
  createThreadReader,
  toThreadWireRow,
} from "../server/thread-reader.ts";
import type { RecoverySdkThreadRow } from "../server/thread-rows.ts";

const ARCHIVED_PAGE_LIMIT = 50;
const ARCHIVED_PAGE_SIZE = 200;
const BULK_PAGE_LIMIT = 25;
const BULK_PAGE_SIZE = 200;

function threadRow(
  overrides: Partial<RecoverySdkThreadRow> = {},
): RecoverySdkThreadRow {
  return {
    id: "thr_main",
    projectId: "proj_main",
    title: "Main thread",
    titleFallback: null,
    parentThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "codex",
    status: "idle",
    hasPendingInteraction: false,
    pinnedAt: null,
    pinSortKey: null,
    archivedAt: null,
    deletedAt: null,
    runtime: { displayStatus: "idle" },
    visibility: "visible",
    environmentId: null,
    environmentName: null,
    environmentBranchName: null,
    environmentProviderId: null,
    environmentHostId: null,
    environmentWorkspaceDisplayKind: "other",
    lastReadAt: null,
    latestAttentionAt: 0,
    createdAt: 1,
    updatedAt: 2,
    activity: {
      activeWorkflowCount: 0,
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activePlanModeCount: 0,
    },
    ...overrides,
  };
}

describe("thread reader", () => {
  it("pages on the raw source and returns only visible rows", async () => {
    const calls: unknown[] = [];
    const firstPage = Array.from({ length: 200 }, (_, index) =>
      threadRow({
        id: `thr_${index}`,
        visibility: index === 0 ? "hidden" : "visible",
      }),
    );
    const bb = {
      sdk: {
        threads: {
          async list(args: unknown) {
            calls.push(args);
            const offset = (args as { offset?: number }).offset ?? 0;
            return offset === 0
              ? firstPage
              : [threadRow({ id: "thr_last" })];
          },
        },
        hosts: { async list() { return []; } },
      },
    } as unknown as BbPluginApi;

    const { rows } = await createThreadReader(bb).listVisibleThreadRows();

    assert.equal(rows.length, 200);
    assert.equal(rows.some((row) => row.visibility === "hidden"), false);
    assert.equal(rows.at(-1)?.id, "thr_last");
    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.equal(Object.hasOwn(call as object, "includeHidden"), false);
    }
  });

  it("deduplicates active and archived rows by id, with the archive winning", async () => {
    const bb = {
      sdk: {
        threads: {
          async list(args: { archived: boolean }) {
            return [
              threadRow({
                id: "thr_same",
                title: args.archived ? "Archived copy" : "Active copy",
                visibility: args.archived ? "hidden" : "visible",
              }),
            ];
          },
        },
        hosts: { async list() { return []; } },
      },
    } as unknown as BbPluginApi;

    const { rows } = await createThreadReader(bb).listBothArchiveStates({});

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.title, "Archived copy");
    assert.equal(rows[0]?.visibility, "hidden");
  });

  it("marks a thread read that stops at its page cap instead of throwing", async () => {
    const bb = {
      sdk: {
        threads: {
          async list(args: { offset?: number }) {
            const offset = args.offset ?? 0;
            if (offset >= BULK_PAGE_LIMIT * BULK_PAGE_SIZE) return [];
            return Array.from({ length: BULK_PAGE_SIZE }, (_, index) =>
              threadRow({ id: `thr_${offset + index}` }),
            );
          },
        },
        hosts: { async list() { return []; } },
      },
    } as unknown as BbPluginApi;

    const page = await createThreadReader(bb).listThreadRows({
      archived: false,
    });

    assert.equal(page.rows.length, BULK_PAGE_LIMIT * BULK_PAGE_SIZE);
    assert.equal(page.truncated, true);
    assert.equal(page.rows.at(0)?.id, "thr_0");
  });

  it("marks an archived read that stops at its safety cap", async () => {
    const bb = {
      sdk: {
        threads: {
          async list(args: { offset?: number }) {
            const offset = args.offset ?? 0;
            if (
              offset >= ARCHIVED_PAGE_LIMIT * ARCHIVED_PAGE_SIZE
            ) {
              return [];
            }
            return Array.from({ length: ARCHIVED_PAGE_SIZE }, (_, index) =>
              threadRow({ id: `thr_${offset + index}` }),
            );
          },
        },
        hosts: { async list() { return []; } },
      },
    } as unknown as BbPluginApi;

    const page = await createThreadReader(bb).listArchivedThreads();

    assert.equal(page.rows.length, ARCHIVED_PAGE_LIMIT * ARCHIVED_PAGE_SIZE);
    assert.equal(page.truncated, true);
  });

  it("reads one root by id for a targeted lookup", async () => {
    const root = threadRow({
      id: "thr_root",
      activity: {
        activeWorkflowCount: 0,
        activeBackgroundAgentCount: 0,
        activeBackgroundCommandCount: 1,
        activePlanModeCount: 0,
      },
    });
    const bb = {
      sdk: {
        threads: {
          async list(args: { threadIds?: readonly string[] }) {
            return args.threadIds?.includes(root.id) === true ? [root] : [];
          },
        },
        hosts: { async list() { return []; } },
      },
    } as unknown as BbPluginApi;

    const row = await createThreadReader(bb).readThreadRow("thr_root");

    assert.equal(row?.id, "thr_root");
    assert.equal(row?.deletedAt, null);
    assert.equal(row?.hasPendingInteraction, false);
    // The list row is the one read that carries the live counters; a root with
    // a running background command must not look deletable.
    assert.equal(row?.activity.activeBackgroundCommandCount, 1);
  });

  it("marks a visible read truncated when hidden rows fill the page budget", async () => {
    const bb = {
      sdk: {
        threads: {
          async list({ offset }: { offset?: number }) {
            const start = offset ?? 0;
            return Array.from({ length: BULK_PAGE_SIZE }, (_, index) => {
              const absolute = start + index;
              return threadRow({
                id: `thr_${absolute}`,
                visibility: absolute % 10 === 0 ? "hidden" : "visible",
              });
            });
          },
        },
        hosts: { async list() { return []; } },
      },
    } as unknown as BbPluginApi;

    const page = await createThreadReader(bb).listVisibleThreadRows();

    assert.equal(page.rows.length, 4_500);
    assert.equal(page.truncated, true);
  });

  it("maps a resolved host and environment onto the recovery wire row", () => {
    const row = toThreadWireRow(
      threadRow({
        environmentId: "env_1",
        environmentName: "feature",
        environmentBranchName: "bb/feature",
        environmentProviderId: "worktree",
        environmentHostId: "host_1",
        environmentWorkspaceDisplayKind: "managed-worktree",
      }),
      new Map([["host_1", "Studio"]]),
    );

    assert.deepEqual(row.environment, {
      id: "env_1",
      name: "feature",
      branchName: "bb/feature",
      providerId: "worktree",
      workspaceDisplayKind: "managed-worktree",
    });
    assert.deepEqual(row.host, { id: "host_1", name: "Studio" });
    assert.equal(row.id, "thr_main");
    assert.equal(row.providerId, "codex");
  });
});
