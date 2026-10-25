/**
 * The manual arrangement: what the user dragged, and the revision it was read at.
 *
 * A write carries the revision it was built on and is refused rather than merged
 * when someone else has moved something since — the caller can only act on an
 * arrangement it has actually seen. `orderOutcome` is what turns the store's
 * answer into the wire's.
 */
import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import type { nestRpcContract } from "../contract.ts";

/** This module's slice of the contract, with every other method omitted. */
type Handlers<Method extends keyof typeof nestRpcContract> = Pick<
  PluginRpcHandlers<typeof nestRpcContract>,
  Method
>;
import { ORDER_CHANNEL } from "../../lib/realtime-channels.ts";
import type { createOrderStore, OrderWrite } from "../../lib/order-store.ts";
import { UNGROUPED_ORDER_SCOPE } from "../../lib/manual-order.ts";
import type { createGroupStore } from "../../lib/group-store.ts";

export interface OrderHandlerDeps {
  readonly bb: BbPluginApi;
  readonly orders: ReturnType<typeof createOrderStore>;
  readonly groups: ReturnType<typeof createGroupStore>;
  /** The store's outcome in the shape the contract promises, plus the publish. */
  readonly orderOutcome: (result: OrderWrite) => {
    ok: boolean;
    stale: boolean;
    revision: number;
  };
}

export function orderHandlers(
  deps: OrderHandlerDeps,
): Handlers<"listManualOrder" | "reorderProjects" | "reorderFamilies" | "reorderWorkspaces" | "seedManualOrder"> {
  const { bb, orders, groups, orderOutcome } = deps;

  return {
    async listManualOrder() {
      return { ...orders.list(), revision: orders.revision() };
    },

    async reorderProjects({ groupId, projectIds, baseRevision }) {
      // A project order is scoped to a group; the ungrouped bucket is a real
      // scope, but a group id that no longer exists would write a row nothing
      // reads, so it is rejected rather than stored.
      if (groupId !== UNGROUPED_ORDER_SCOPE) {
        const known = new Set(groups.list().map((group) => group.id));
        if (!known.has(groupId)) {
          return { ok: false, stale: false, revision: orders.revision() };
        }
      }
      return orderOutcome(
        orders.setProjectOrder(groupId, projectIds, baseRevision),
      );
    },

    async reorderFamilies({ projectId, rootIds, baseRevision }) {
      return orderOutcome(
        orders.setFamilyOrder(projectId, rootIds, baseRevision),
      );
    },

    async reorderWorkspaces({ projectId, workspaceKeys, baseRevision }) {
      return orderOutcome(
        orders.setWorkspaceOrder(projectId, workspaceKeys, baseRevision),
      );
    },

    async seedManualOrder({ projectIds, families }) {
      const ok = orders.seed({ projectIds, families }, groups.assignments());
      if (ok) bb.realtime.publish(ORDER_CHANNEL, {});
      return { ok };
    },
  };
}
