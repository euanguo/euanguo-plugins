/**
 * Project groups: the level above projects, and the strip's own two icons.
 *
 * Everything a group row draws — counts, worst status — is derived from its
 * threads at render time, so the wire carries only identity, name, order and
 * membership. Creating or renaming one goes through the project service rather
 * than directly to the store, so both callers get the same side effects.
 */
import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import type { nestRpcContract } from "../contract.ts";

/** This module's slice of the contract, with every other method omitted. */
type Handlers<Method extends keyof typeof nestRpcContract> = Pick<
  PluginRpcHandlers<typeof nestRpcContract>,
  Method
>;
import type { createGroupStore } from "../../lib/group-store.ts";
import type { createScopeIconStore } from "../../lib/scope-icon-store.ts";
import { GROUP_CHANNEL } from "../../lib/realtime-channels.ts";
import type { ProjectService } from "../project-service.ts";

export interface GroupHandlerDeps {
  readonly bb: BbPluginApi;
  readonly groups: ReturnType<typeof createGroupStore>;
  readonly scopeIcons: ReturnType<typeof createScopeIconStore>;
  readonly projects: ProjectService;
}

export function groupHandlers(
  deps: GroupHandlerDeps,
): Handlers<"listGroups" | "setScopeIcon" | "createGroup" | "renameGroup" | "deleteGroup" | "assignProjectToGroup" | "reorderGroups"> {
  const { bb, groups, scopeIcons, projects } = deps;

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
      const created = await projects.createGroup(name, icon);
      // The store's refusal, rethrown as the RPC's: the contract answers with a
      // group rather than with null, and the dialog already has a message for a
      // throw. The text is the store's own, kept in one place.
      if (created === null) throw new Error("Invalid group name.");
      return created;
    },

    async renameGroup({ groupId, name, icon }) {
      return { ok: await projects.renameGroup(groupId, name, icon) };
    },

    async deleteGroup({ groupId }) {
      return { ok: await projects.deleteGroup(groupId) };
    },

    async assignProjectToGroup({ projectId, groupId }) {
      return {
        ok: await projects.assignProjectToGroup(projectId, groupId),
      };
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
