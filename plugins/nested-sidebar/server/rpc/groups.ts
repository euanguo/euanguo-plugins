/**
 * Project groups: the level above projects, and the strip's own two icons.
 *
 * Everything a group row draws — counts, worst status — is derived from its
 * threads at render time, so the wire carries only identity, name, order and
 * membership. Creating or renaming one goes through `nestActions` rather than
 * the store, because an agent may be the caller and the action layer is where
 * that is attributed.
 */
import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import type { nestRpcContract } from "../contract.ts";

/** This module's slice of the contract, with every other method omitted. */
type Handlers<Method extends keyof typeof nestRpcContract> = Pick<
  PluginRpcHandlers<typeof nestRpcContract>,
  Method
>;
import { GROUP_CHANNEL, ORDER_CHANNEL } from "../../lib/realtime-channels.ts";
import type { createGroupStore } from "../../lib/group-store.ts";
import type { createScopeIconStore } from "../../lib/scope-icon-store.ts";
import type { createOrderStore } from "../../lib/order-store.ts";
import type { NestAgentActions } from "../../lib/agent/actions.ts";

export interface GroupHandlerDeps {
  readonly bb: BbPluginApi;
  readonly groups: ReturnType<typeof createGroupStore>;
  readonly scopeIcons: ReturnType<typeof createScopeIconStore>;
  readonly nestActions: NestAgentActions;
  readonly orders: ReturnType<typeof createOrderStore>;
}

export function groupHandlers(
  deps: GroupHandlerDeps,
): Handlers<"listGroups" | "setScopeIcon" | "createGroup" | "renameGroup" | "deleteGroup" | "assignProjectToGroup" | "reorderGroups"> {
  const { bb, groups, scopeIcons, nestActions, orders } = deps;

  return {
    async listGroups() {
      return {
        groups: groups.list(),
        assignment: groups.assignments(),
        icons: scopeIcons.list(),
      };
    },

    async setScopeIcon({ scope, icon }) {
      const ok = scopeIcons.set(scope, icon);
      if (ok) bb.realtime.publish(GROUP_CHANNEL, {});
      return { ok };
    },

    async createGroup({ name, icon }) {
      const created = await nestActions.createGroup(name, icon);
      // The store's refusal, rethrown as the RPC's: the contract answers with a
      // group rather than with null, and the dialog already has a message for a
      // throw. The text is the store's own, kept in one place.
      if (created === null) throw new Error("Invalid group name.");
      return created;
    },

    async renameGroup({ groupId, name, icon }) {
      return { ok: await nestActions.renameGroup(groupId, name, icon) };
    },

    async deleteGroup({ groupId }) {
      const ok = groups.remove(groupId);
      if (ok) {
        // The group's project order dies with it; its projects fall back to
        // Ungrouped and are ordered there from scratch.
        orders.removeGroup(groupId);
        bb.realtime.publish(GROUP_CHANNEL, {});
        bb.realtime.publish(ORDER_CHANNEL, {});
      }
      return { ok };
    },

    async assignProjectToGroup({ projectId, groupId }) {
      return { ok: await nestActions.assignProjectToGroup(projectId, groupId) };
    },

    async reorderGroups({ groupIds }) {
      // Only ids that already exist are honoured; the store rewrites positions
      // from the array index, so unknown ids must not shift real ones.
      const known = new Set(groups.list().map((group) => group.id));
      if (!groupIds.every((id) => known.has(id))) return { ok: false };
      const ok = groups.reorder(groupIds);
      if (ok) bb.realtime.publish(GROUP_CHANNEL, {});
      return { ok };
    },
  };
}
