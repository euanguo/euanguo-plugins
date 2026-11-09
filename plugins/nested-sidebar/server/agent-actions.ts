/**
 * The writes Nest offers an agent, built once for the server.
 *
 * Each method here is the same operation the sidebar's own row menu performs,
 * through the same store or service — that is the point of the seam. A second
 * implementation would be a second place for the publish to be forgotten, and
 * the symptom is the one thing a user will not forgive: a sidebar that changes
 * without being asked, or a click that appears to do nothing.
 *
 * It lives beside the entry point rather than inside it so the entry point
 * stays a list of what is wired, and so the rules below — publish, refresh the
 * index, answer with what actually happened — are read in one place.
 */

import type { BbPluginApi } from "@get-bb/plugin-sdk";

import type { NestAgentActions, SpawnThreadInput } from "../lib/agent/actions.ts";
import type { createBulkDeleteService } from "./bulk-delete-service.ts";
import type { createGroupStore } from "../lib/group-store.ts";
import type { createOrderStore } from "../lib/order-store.ts";
import { GROUP_CHANNEL, ORDER_CHANNEL } from "../lib/realtime-channels.ts";
import type { createLifecycleService } from "./lifecycle-service.ts";
import type { createWorktreeRemovalService } from "./worktree-removal-service.ts";

export function createNestAgentActions(input: {
  readonly bb: BbPluginApi;
  readonly groups: ReturnType<typeof createGroupStore>;
  readonly orders: ReturnType<typeof createOrderStore>;
  readonly lifecycle: ReturnType<typeof createLifecycleService>;
  readonly bulkDelete: ReturnType<typeof createBulkDeleteService>;
  readonly removal: ReturnType<typeof createWorktreeRemovalService>;
  /** Recompute the index after a write, so the next read is not stale. */
  readonly refreshIndex: () => Promise<unknown>;
}): NestAgentActions {
  const { bb, groups, orders, lifecycle, bulkDelete, removal, refreshIndex } = input;

  return {
    async deleteThreads({ threadIds, protectedThreadId, acknowledged }) {
      const preview = await bulkDelete.preview(threadIds, protectedThreadId);
      if (preview.token === null || !acknowledged) return { preview, result: null };
      return { preview, result: await bulkDelete.confirm(preview.token) };
    },

    async removeProject(projectId, expectedName) {
      // Re-read before deleting: the caller confirmed against a name, and a
      // project renamed in the meantime is not the one they agreed to.
      const project = await bb.sdk.projects.get({ projectId });
      if (project.name !== expectedName) return false;
      await bb.sdk.projects.delete({ projectId });
      // A deleted project must not leave a member row pointing at nothing.
      groups.assign(projectId, null);
      orders.removeProject(projectId);
      bb.realtime.publish(GROUP_CHANNEL, {});
      void refreshIndex();
      return true;
    },

    async deleteGroup(groupId) {
      const ok = groups.remove(groupId);
      if (ok) {
        orders.removeGroup(groupId);
        bb.realtime.publish(GROUP_CHANNEL, {});
        bb.realtime.publish(ORDER_CHANNEL, {});
      }
      return ok;
    },

    async removeWorkspace({ environmentId, deleteDirectory, acknowledged }) {
      const outcome = await removal.remove({ environmentId, deleteDirectory, acknowledged });
      if (outcome.ok) void refreshIndex();
      return outcome;
    },

    async spawnThread(input: SpawnThreadInput) {
      const spawned = await bb.sdk.threads.spawn({
        projectId: input.projectId,
        prompt: input.prompt,
        origin: "plugin",
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.parentThreadId === undefined
          ? {}
          : { parentThreadId: input.parentThreadId }),
        ...(input.environment === undefined ? {} : { environment: input.environment }),
      } as Parameters<typeof bb.sdk.threads.spawn>[0]);
      return spawned.id ?? null;
    },

    async renameProject(projectId, name) {
      const project = await bb.sdk.projects.update({ projectId, name });
      bb.realtime.publish(GROUP_CHANNEL, {});
      void refreshIndex();
      return project.name;
    },

    async settleThread(threadId, settled) {
      if (settled) {
        const result = await lifecycle.settleThread(threadId);
        return { ok: result.ok, message: null };
      }
      return lifecycle.unsettleThread(threadId);
    },

    async snoozeThread(threadId, snoozedUntil) {
      return lifecycle.snoozeThread(threadId, snoozedUntil);
    },

    async setThreadPinned(threadId, pinned) {
      try {
        await (pinned
          ? bb.sdk.threads.pin({ threadId })
          : bb.sdk.threads.unpin({ threadId }));
        return true;
      } catch {
        return false;
      }
    },

    async renameThread(threadId, title) {
      try {
        await bb.sdk.threads.update({ threadId, title });
        return true;
      } catch {
        return false;
      }
    },

    async assignProjectToGroup(projectId, groupId) {
      // Confirm the project exists before recording a membership for it, so a
      // deleted project cannot leave a member row pointing at nothing.
      await bb.sdk.projects.get({ projectId });
      const ok = groups.assign(projectId, groupId);
      if (ok) {
        bb.realtime.publish(GROUP_CHANNEL, {});
        void refreshIndex();
      }
      return ok;
    },

    async createGroup(name, icon) {
      try {
        const created = groups.create(`grp_${globalThis.crypto.randomUUID()}`, name, icon);
        bb.realtime.publish(GROUP_CHANNEL, {});
        void refreshIndex();
        return created;
      } catch {
        return null;
      }
    },

    async renameGroup(groupId, name, icon) {
      // Renaming an id that is gone is not an error worth surfacing: the tree
      // the user was looking at is stale, and the publish refreshes it.
      const ok = groups.rename(groupId, name, icon) !== null;
      if (ok) {
        bb.realtime.publish(GROUP_CHANNEL, {});
        void refreshIndex();
      }
      return ok;
    },

    async setWorkspaceAlias(environmentId, alias) {
      // Routed through the environment area, which is where bb keeps a
      // worktree's display name. The publish is what makes every sidebar row
      // for that worktree pick the new name up.
      const environment = await bb.sdk.environments.update({ environmentId, name: alias });
      bb.realtime.publish(GROUP_CHANNEL, {});
      void refreshIndex();
      return environment.name;
    },
  };
}
