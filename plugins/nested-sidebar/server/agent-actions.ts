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
import { GROUP_CHANNEL } from "../lib/realtime-channels.ts";
import type { createBulkDeleteService } from "./bulk-delete-service.ts";
import type { createLifecycleService } from "./lifecycle-service.ts";
import type { createWorktreeRemovalService } from "./worktree-removal-service.ts";
import type { ProjectService } from "./project-service.ts";

export function createNestAgentActions(input: {
  readonly bb: BbPluginApi;
  readonly projects: ProjectService;
  readonly lifecycle: ReturnType<typeof createLifecycleService>;
  readonly bulkDelete: ReturnType<typeof createBulkDeleteService>;
  readonly removal: ReturnType<typeof createWorktreeRemovalService>;
  /** Recompute the index after a write, so the next read is not stale. */
  readonly refreshIndex: () => Promise<unknown>;
}): NestAgentActions {
  const { bb, projects, lifecycle, bulkDelete, removal, refreshIndex } = input;

  return {
    async deleteThreads({ threadIds, protectedThreadId, acknowledged }) {
      const preview = await bulkDelete.preview(threadIds, protectedThreadId);
      if (preview.token === null || !acknowledged) return { preview, result: null };
      return { preview, result: await bulkDelete.confirm(preview.token) };
    },

    async removeProject(projectId, expectedName) {
      return projects.removeProject(projectId, expectedName);
    },

    async deleteGroup(groupId) {
      return projects.deleteGroup(groupId);
    },

    async removeWorkspace({ environmentId, deleteDirectory, acknowledged }) {
      // The agent reads the same survey the dialog reads, then sends that
      // digest back: an agent that inspected a clean directory cannot delete
      // one that gained files while its request was in flight.
      const { digest } = await removal.inspect(environmentId);
      const outcome = await removal.remove({
        environmentId,
        deleteDirectory,
        acknowledged,
        expectedDigest: digest,
      });
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
      return projects.renameProject(projectId, name);
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
      return projects.assignProjectToGroup(projectId, groupId);
    },

    async createGroup(name, icon) {
      return projects.createGroup(name, icon);
    },

    async renameGroup(groupId, name, icon) {
      return projects.renameGroup(groupId, name, icon);
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
