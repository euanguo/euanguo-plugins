/**
 * Server boot, append-only SQLite migrations, RPC wiring, event hooks, and CLI tests.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import plugin from "../server.ts";
import { harborRpcContract } from "../server/contract.ts";

function createFakeServerHarness() {
  const kvData = new Map<string, unknown>();
  const db = new Database(":memory:");
  const migratedBatches: string[][] = [];
  const disposeCallbacks: (() => void)[] = [];
  const registeredRpc: Record<string, (input: unknown) => Promise<unknown>> = {};
  const eventHandlers = new Map<string, ((payload: unknown) => void)[]>();
  const registeredProviders: { id?: string; name?: string }[] = [];
  const archivedCalls: string[] = [];
  let settingsDefined = false;
  let cliSpec: {
    name: string;
    run: (argv: string[]) => { exitCode: number; stdout: string; stderr: string };
  } | null = null;

  const bb = {
    storage: {
      kv: {
        async get<T>(key: string) {
          return kvData.get(key) as T | undefined;
        },
        async set(key: string, value: unknown) {
          kvData.set(key, value);
        },
        async delete(key: string) {
          kvData.delete(key);
        },
        async list() {
          return [...kvData.keys()];
        },
      },
      database: () => db,
      migrate(targetDb: Database.Database, statements: readonly string[]) {
        migratedBatches.push([...statements]);
        for (const sql of statements) targetDb.exec(sql);
      },
    },
    settings: {
      define() {
        settingsDefined = true;
        throw new Error("Harbor V3 must not call bb.settings.define");
      },
    },
    log: { warn() {}, info() {}, error() {} },
    realtime: { publish() {} },
    rpc: {
      experimental_invalidate() {},
      register(
        _contract: unknown,
        handlers: Record<string, (input: unknown) => Promise<unknown>>,
      ) {
        Object.assign(registeredRpc, handlers);
      },
    },
    hosts: {
      experimental_client: () => ({ call: async () => ({ facts: [] }) }),
    },
    sdk: {
      projects: { list: async () => [] },
      environments: { list: async () => [] },
      threads: {
        list: async () => [],
        on: () => () => {},
        archive: async ({ threadId }: { threadId: string }) => {
          archivedCalls.push(threadId);
          return { archivedThreadIds: [threadId] };
        },
        unarchive: async () => {},
      },
    },
    events: {
      on(event: string, handler: (payload: unknown) => void) {
        const list = eventHandlers.get(event) ?? [];
        list.push(handler);
        eventHandlers.set(event, list);
      },
    },
    schedules: { register() {} },
    onDispose(cb: () => void) {
      disposeCallbacks.push(cb);
    },
    experimental_environments: {
      register(provider: { id?: string; name?: string }) {
        registeredProviders.push(provider);
      },
    },
    agents: {
      registerTool() {},
      configure() {},
      contributeInstructions() {},
    },
    cli: {
      register(spec: {
        name: string;
        run: (argv: string[]) => { exitCode: number; stdout: string; stderr: string };
      }) {
        cliSpec = spec;
      },
    },
  } as unknown as BbPluginApi;

  return {
    bb,
    db,
    migratedBatches,
    disposeCallbacks,
    registeredRpc,
    eventHandlers,
    registeredProviders,
    archivedCalls,
    getSettingsDefined: () => settingsDefined,
    getCliSpec: () => cliSpec,
  };
}

describe("server plugin wiring, migrations, RPC surface, and lifecycle smoke", () => {
  it("runs all 27 append-only migrations idempotently without bb.settings.define", async () => {
    const harness = createFakeServerHarness();
    plugin(harness.bb);

    try {
      assert.equal(harness.getSettingsDefined(), false);
      assert.equal(harness.migratedBatches.length, 1);

      const statements = harness.migratedBatches[0] ?? [];
      assert.equal(statements.length, 27);
      assert.match(statements[0] ?? "", /CREATE TABLE IF NOT EXISTS thread_lifecycle/u);
      assert.match(statements[9] ?? "", /CREATE TABLE IF NOT EXISTS sidebar_index/u);
      assert.match(statements[10] ?? "", /CREATE TABLE IF NOT EXISTS features/u);
      assert.match(statements.at(-1) ?? "", /CREATE TABLE IF NOT EXISTS feature_presets/u);

      // All CREATE TABLE / CREATE INDEX statements remain safe to re-execute idempotently.
      for (const sql of statements) {
        if (/^CREATE\s+/iu.test(sql.trim())) {
          harness.db.exec(sql);
        }
      }
      const tableRows = harness.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as { name: string }[];
      const tables = new Set(tableRows.map((row) => row.name));

      for (const expected of [
        "thread_lifecycle",
        "project_badge_colors",
        "project_groups",
        "project_group_members",
        "manual_order",
        "view_preferences",
        "scope_icons",
        "project_icons",
        "manual_order_revision",
        "sidebar_index",
        "features",
        "feature_workspace_labels",
        "feature_branches",
        "feature_roots",
        "feature_containers",
        "feature_briefs",
        "feature_refs",
        "feature_decisions",
        "feature_ref_links",
        "feature_presets",
      ]) {
        assert.equal(tables.has(expected), true, `missing expected table ${expected}`);
      }

      const featureColumns = (
        harness.db.prepare("PRAGMA table_info(features)").all() as { name: string }[]
      ).map((col) => col.name);
      for (const parkCol of [
        "parked_at",
        "parked_reason",
        "parked_note",
        "wake_at",
        "wake_on_activity",
      ]) {
        assert.equal(featureColumns.includes(parkCol), true, `missing park column ${parkCol}`);
      }

      const revisionSeed = harness.db
        .prepare("SELECT revision FROM manual_order_revision WHERE id = 0")
        .get() as { revision: number } | undefined;
      assert.equal(revisionSeed?.revision, 0);
      assert.equal(harness.registeredProviders.length, 1);
      assert.equal(harness.registeredProviders[0]?.id, "harbor-multi-repo");
    } finally {
      for (const dispose of harness.disposeCallbacks) dispose();
      await new Promise((resolve) => setTimeout(resolve, 15));
      harness.db.close();
    }
  });

  it("registers every RPC contract handler and passes read/write smoke checks", async () => {
    const harness = createFakeServerHarness();
    plugin(harness.bb);

    try {
      const rpc = harness.registeredRpc;
      assert.deepEqual(
        Object.keys(rpc).sort(),
        Object.keys(harborRpcContract).sort(),
      );

      const appearance = (await rpc.getAppearance?.({})) as {
        palettePreset: string;
        rowDensity: string;
      };
      assert.equal(appearance.palettePreset, "Default");
      assert.equal(appearance.rowDensity, "detailed");

      const updatedAppearance = (await rpc.setAppearance?.({
        palettePreset: "High contrast",
        rowDensity: "compact",
      })) as { palettePreset: string; rowDensity: string };
      assert.equal(updatedAppearance.palettePreset, "High contrast");
      assert.equal(updatedAppearance.rowDensity, "compact");

      assert.deepEqual(await rpc.getAgentAccess?.({}), { tier: "read-only" });
      assert.deepEqual(await rpc.setAgentAccess?.({ tier: "full" }), { tier: "full" });

      const initialGroups = (await rpc.listGroups?.({})) as {
        groups: unknown[];
        assignment: Record<string, string>;
      };
      assert.deepEqual(initialGroups.groups, []);
      assert.deepEqual(initialGroups.assignment, {});

      const created = (await rpc.createGroup?.({ name: "Core" })) as {
        id: string;
        name: string;
      };
      assert.equal(created.name, "Core");

      const afterGroups = (await rpc.listGroups?.({})) as {
        groups: { id: string; name: string }[];
      };
      assert.equal(afterGroups.groups.length, 1);
      assert.equal(afterGroups.groups[0]?.name, "Core");

      const order = (await rpc.listManualOrder?.({})) as {
        revision: number;
        projects: Record<string, unknown>;
      };
      assert.equal(order.revision, 0);
      assert.deepEqual(order.projects, {});

      const prefs = (await rpc.getViewPreferences?.({})) as {
        projectSort: string;
        sidebarMode: string;
      };
      assert.equal(prefs.projectSort, "manual");
      assert.equal(prefs.sidebarMode, "threads");

      const paths = (await rpc.listWorkspacePaths?.({})) as {
        environments: Record<string, unknown>;
        projects: Record<string, unknown>;
      };
      assert.deepEqual(paths.environments, {});
      assert.deepEqual(paths.projects, {});

      const features = (await rpc.listFeatures?.({})) as { features: unknown[] };
      assert.deepEqual(features.features, []);

      // Settle + unsnooze preserves settled state; thread.deleted cleans up row.
      const settled = (await rpc.settle?.({ threadId: "thr_smoke_1" })) as {
        ok: boolean;
        archived: boolean;
      };
      assert.deepEqual(settled, { ok: true, archived: true });
      assert.deepEqual(harness.archivedCalls, ["thr_smoke_1"]);

      await rpc.unsnooze?.({ threadId: "thr_smoke_1" });
      const lifecycle = (await rpc.listLifecycle?.({})) as {
        rows: { threadId: string; settledAt: number | null }[];
      };
      assert.equal(lifecycle.rows.length, 1);
      assert.ok(lifecycle.rows[0]?.settledAt !== null);

      for (const onDeleted of harness.eventHandlers.get("thread.deleted") ?? []) {
        onDeleted({ thread: { id: "thr_smoke_1" } });
      }
      const afterDelete = (await rpc.listLifecycle?.({})) as { rows: unknown[] };
      assert.equal(afterDelete.rows.length, 0);

      const cli = harness.getCliSpec();
      assert.ok(cli);
      assert.equal(cli.name, "harbor");
      const status = cli.run(["status", "--json"]);
      assert.equal(status.exitCode, 0);
      const parsedCli = JSON.parse(status.stdout) as { tier: string; tools: string[] };
      assert.equal(parsedCli.tier, "full");
      assert.equal(parsedCli.tools.length, 10);
    } finally {
      for (const dispose of harness.disposeCallbacks) dispose();
      await new Promise((resolve) => setTimeout(resolve, 15));
      harness.db.close();
    }
  });
});
