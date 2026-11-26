import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import {
  GROUP_ASSIGNMENT_MIGRATION,
  GROUP_MIGRATION,
  createGroupStore,
} from "../lib/stores/group-store.ts";
import {
  MANUAL_ORDER_MIGRATION,
  ORDER_REVISION_MIGRATION,
  ORDER_REVISION_SEED,
  createOrderStore,
} from "../lib/stores/order-store.ts";
import { createProjectService, type ProjectService } from "../server/project-service.ts";
import { createHarborAgentActions } from "../server/agent-actions.ts";
import { projectHandlers } from "../server/rpc/workspaces.ts";
import { GROUP_CHANNEL, ORDER_CHANNEL } from "../lib/realtime-channels.ts";

const PROJECT_ID = "proj_work";

function storeFixture() {
  const db = new Database(":memory:");
  db.exec(GROUP_MIGRATION);
  db.exec(GROUP_ASSIGNMENT_MIGRATION);
  db.exec(MANUAL_ORDER_MIGRATION);
  db.exec(ORDER_REVISION_MIGRATION);
  db.prepare(ORDER_REVISION_SEED).run();
  return {
    db,
    groups: createGroupStore(db),
    orders: createOrderStore(db),
  };
}

function bbFixture(project: { id: string; name: string }) {
  const calls: string[] = [];
  const channels: string[] = [];
  let projectRecord = { ...project };
  let deleted = false;
  const bb = {
    log: { warn: (message: string) => calls.push(`warn:${message}`) },
    realtime: {
      publish: (channel: string) => channels.push(channel),
    },
    sdk: {
      projects: {
        get: async ({ projectId }: { projectId: string }) => {
          calls.push("get");
          if (projectId !== projectRecord.id) {
            throw new Error("Project not found.");
          }
          return projectRecord;
        },
        update: async ({
          projectId,
          name,
        }: {
          projectId: string;
          name: string;
        }) => {
          calls.push("update");
          if (projectId !== projectRecord.id) {
            throw new Error("Project not found.");
          }
          projectRecord = { ...projectRecord, name };
          return projectRecord;
        },
        delete: async ({ projectId }: { projectId: string }) => {
          calls.push("delete");
          if (projectId !== projectRecord.id) {
            throw new Error("Project not found.");
          }
          deleted = true;
        },
      },
    },
  } as unknown as BbPluginApi;

  return { bb, calls, channels, wasDeleted: () => deleted };
}

describe("the shared project and group write service", () => {
  it("renames through bb once and then publishes and refreshes once", async () => {
    const fakeBb = bbFixture({ id: PROJECT_ID, name: "Before" });
    const { groups, orders } = storeFixture();
    let refreshes = 0;
    const service = createProjectService({
      bb: fakeBb.bb,
      groups,
      orders,
      refreshIndex: async () => {
        refreshes += 1;
      },
    });

    const name = await service.renameProject(PROJECT_ID, "After");

    assert.equal(name, "After");
    assert.deepEqual(fakeBb.calls, ["update"]);
    assert.deepEqual(fakeBb.channels, [GROUP_CHANNEL]);
    assert.equal(refreshes, 1);
  });

  it("removes a project with one publish and one refresh after the delete", async () => {
    const fakeBb = bbFixture({ id: PROJECT_ID, name: "Project" });
    const { db, groups, orders } = storeFixture();
    let refreshes = 0;
    const service = createProjectService({
      bb: fakeBb.bb,
      groups,
      orders,
      refreshIndex: async () => {
        refreshes += 1;
      },
    });
    const created = await service.createGroup("Work", undefined);
    assert.ok(created);
    await service.assignProjectToGroup(PROJECT_ID, created.id);
    orders.setFamilyOrder(PROJECT_ID, ["thr_1"], orders.revision());
    fakeBb.channels.length = 0;
    refreshes = 0;

    const ok = await service.removeProject(PROJECT_ID, "Project");

    assert.equal(ok, true);
    assert.equal(fakeBb.wasDeleted(), true);
    assert.deepEqual(fakeBb.channels, [GROUP_CHANNEL, ORDER_CHANNEL]);
    assert.equal(refreshes, 1);
    assert.deepEqual(groups.assignments(), {});
    assert.deepEqual(orders.list().families, {});
    db.close();
  });

  it("refuses a project removal whose name has changed without side effects", async () => {
    const fakeBb = bbFixture({
      id: PROJECT_ID,
      name: "Actual",
    });
    const { db, groups, orders } = storeFixture();
    let refreshes = 0;
    const service = createProjectService({
      bb: fakeBb.bb,
      groups,
      orders,
      refreshIndex: async () => {
        refreshes += 1;
      },
    });
    orders.setFamilyOrder(PROJECT_ID, ["thr_1"], orders.revision());

    const ok = await service.removeProject(PROJECT_ID, "Stale");

    assert.equal(ok, false);
    assert.equal(fakeBb.wasDeleted(), false);
    assert.deepEqual(orders.list().families, { [PROJECT_ID]: ["thr_1"] });
    assert.deepEqual(groups.assignments(), {});
    assert.deepEqual(fakeBb.channels, []);
    assert.equal(refreshes, 0);
    db.close();
  });

  it("deletes a group and its order, publishes both channels, and refreshes once", async () => {
    const fakeBb = bbFixture({ id: PROJECT_ID, name: "Project" });
    const { db, groups, orders } = storeFixture();
    let refreshes = 0;
    const service = createProjectService({
      bb: fakeBb.bb,
      groups,
      orders,
      refreshIndex: async () => {
        refreshes += 1;
      },
    });
    const created = await service.createGroup("Work", undefined);
    assert.ok(created);
    orders.setProjectOrder(created.id, [PROJECT_ID], orders.revision());
    refreshes = 0;
    fakeBb.channels.length = 0;

    const ok = await service.deleteGroup(created.id);

    assert.equal(ok, true);
    assert.deepEqual(groups.list(), []);
    assert.deepEqual(orders.list().projects, {});
    assert.deepEqual(fakeBb.channels, [GROUP_CHANNEL, ORDER_CHANNEL]);
    assert.equal(refreshes, 1);
    db.close();
  });

  it("assigns a confirmed project through the group store and refreshes once", async () => {
    const fakeBb = bbFixture({ id: PROJECT_ID, name: "Project" });
    const { db, groups, orders } = storeFixture();
    let refreshes = 0;
    const service = createProjectService({
      bb: fakeBb.bb,
      groups,
      orders,
      refreshIndex: async () => {
        refreshes += 1;
      },
    });
    const created = await service.createGroup("Work", undefined);
    assert.ok(created);
    refreshes = 0;

    const ok = await service.assignProjectToGroup(PROJECT_ID, created.id);

    assert.equal(ok, true);
    assert.deepEqual(groups.assignments(), { [PROJECT_ID]: created.id });
    assert.equal(refreshes, 1);
    db.close();
  });

  it("is the only write side effect for both the RPC and the agent action", async () => {
    const { service: spy, calls: spyCalls } = spyService();
    const { bb } = bbFixture({ id: PROJECT_ID, name: "Project" });
    const refreshIndex = async () => undefined;
    const handlers = projectHandlers({
      bb,
      projects: spy,
      harborAgentActions: new Proxy({}, { get: () => () => undefined }) as never,
      refreshSidebarIndex: async () => null,
    });
    const actions = createHarborAgentActions({
      bb,
      projects: spy,
      lifecycle: new Proxy({}, { get: () => async () => undefined }) as never,
      bulkDelete: new Proxy({}, { get: () => async () => undefined }) as never,
      removal: new Proxy({}, { get: () => async () => undefined }) as never,
      refreshIndex,
    });

    const rpcRemove = await handlers.removeProject({
      projectId: PROJECT_ID,
      expectedName: "Project",
    });
    assert.deepEqual(rpcRemove, { ok: true });
    assert.deepEqual(spyCalls, ["removeProject"]);

    spyCalls.length = 0;
    const actionRemove = await actions.removeProject(PROJECT_ID, "Project");
    assert.equal(actionRemove, true);
    assert.deepEqual(spyCalls, ["removeProject"]);
  });
});

function spyService(): { service: ProjectService; calls: string[] } {
  const calls: string[] = [];
  const record = (name: string) => {
    calls.push(name);
  };
  const service: ProjectService = {
    async renameProject(_projectId, name) {
      record("renameProject");
      return name;
    },
    async removeProject() {
      record("removeProject");
      return true;
    },
    async createGroup(name, icon) {
      record("createGroup");
      return { id: "grp_new", name, icon: icon ?? "Layer", position: 0 };
    },
    async renameGroup() {
      record("renameGroup");
      return true;
    },
    async deleteGroup() {
      record("deleteGroup");
      return true;
    },
    async assignProjectToGroup() {
      record("assignProjectToGroup");
      return true;
    },
  };
  return { service, calls };
}
