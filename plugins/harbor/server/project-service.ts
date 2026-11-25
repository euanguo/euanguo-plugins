/**
 * The writes on projects and the level above them.
 *
 * A rename, a deletion and a group change each touch more than one store, and
 * the sidebar must be told to re-read after all of them. Keeping that sequence
 * here means the RPC and the agent tools cannot drift into one path that
 * publishes and another that forgets.
 */

import type { BbPluginApi } from "@get-bb/plugin-sdk";

import type { createGroupStore } from "../lib/stores/group-store.ts";
import type { createOrderStore } from "../lib/stores/order-store.ts";
import { GROUP_CHANNEL, ORDER_CHANNEL } from "../lib/realtime-channels.ts";

export function createProjectService(input: {
  readonly bb: BbPluginApi;
  readonly groups: ReturnType<typeof createGroupStore>;
  readonly orders: ReturnType<typeof createOrderStore>;
  /** Recompute the materialized index after a successful write. */
  readonly refreshIndex: () => Promise<unknown>;
}) {
  const { bb, groups, orders, refreshIndex } = input;

  const tellSidebar = (channels: readonly string[]) => {
    const tags: string[] = [];
    for (const channel of channels) {
      bb.realtime.publish(channel, {});
      if (channel === GROUP_CHANNEL) tags.push("groups");
      if (channel === ORDER_CHANNEL) tags.push("order");
    }
    if (tags.length > 0) bb.rpc?.experimental_invalidate?.(tags);
    void refreshIndex();
  };

  async function renameProject(projectId: string, name: string) {
    const project = await bb.sdk.projects.update({ projectId, name });
    tellSidebar([GROUP_CHANNEL]);
    return project.name;
  }

  async function removeProject(projectId: string, expectedName: string) {
    // Re-read before deleting: the caller confirmed against a name, and a
    // project renamed in the meantime is not the one they agreed to.
    const project = await bb.sdk.projects.get({ projectId });
    if (project.name !== expectedName) return false;

    await bb.sdk.projects.delete({ projectId });
    // A deleted project must not leave a member row pointing at nothing.
    groups.assign(projectId, null);
    orders.removeProject(projectId);
    tellSidebar([GROUP_CHANNEL]);
    return true;
  }

  async function createGroup(name: string, icon: string | undefined) {
    try {
      const created = groups.create(
        `grp_${globalThis.crypto.randomUUID()}`,
        name,
        icon,
      );
      tellSidebar([GROUP_CHANNEL]);
      return created;
    } catch (error) {
      bb.log.warn(`could not create group: ${String(error)}`);
      return null;
    }
  }

  async function renameGroup(
    groupId: string,
    name: string,
    icon?: string,
  ) {
    const ok = groups.rename(groupId, name, icon) !== null;
    if (ok) tellSidebar([GROUP_CHANNEL]);
    return ok;
  }

  async function deleteGroup(groupId: string) {
    const ok = groups.remove(groupId);
    if (ok) {
      orders.removeGroup(groupId);
      tellSidebar([GROUP_CHANNEL, ORDER_CHANNEL]);
    }
    return ok;
  }

  async function assignProjectToGroup(
    projectId: string,
    groupId: string | null,
  ) {
    // Confirm the project exists before recording a membership for it, so a
    // deleted project cannot leave a member row pointing at nothing.
    await bb.sdk.projects.get({ projectId });
    const ok = groups.assign(projectId, groupId);
    if (ok) tellSidebar([GROUP_CHANNEL]);
    return ok;
  }

  return {
    renameProject,
    removeProject,
    createGroup,
    renameGroup,
    deleteGroup,
    assignProjectToGroup,
  };
}

export type ProjectService = ReturnType<typeof createProjectService>;
