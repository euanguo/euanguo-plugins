/**
 * The destructive verbs, behind an explicit acknowledgement.
 *
 * Every tool here destroys something and none of them can be undone. They exist
 * because the user asked for them and because the same operations are one click
 * away in the sidebar — but a model's click is not watched the way a person's
 * is, so each one takes an `acknowledged` flag that the model has to set on a
 * second call, after showing the user what would go.
 *
 * Two of them go further than the flag:
 *
 * - deleting threads returns the preview and stops when `acknowledged` is
 *   missing, so the first call is a read the model can quote;
 * - deleting a project requires the project's current name, so a stale id
 *   cannot delete a project that was renamed since the map was read.
 *
 * The worktree removal is the sidebar's own removal, which surveys twice and
 * archives before it deletes; it refuses an `acknowledged` removal only when
 * the directory itself cannot be taken back.
 */

import { z } from "zod";

import type { AgentToolDeps } from "./actions.ts";
import { quoteName } from "./instructions.ts";
import type { AgentToolRegistry } from "./toolkit.ts";

const THREAD_IDS = z
  .array(z.string().min(1))
  .min(1)
  .max(20)
  .describe("Thread ids. Up to 20 at a time.");

function previewText(preview: {
  included: readonly { id: string; title: string; childCount: number }[];
  skipped: readonly { id: string; message: string }[];
  rootCount: number;
  childCount: number;
  totalThreadCount: number;
  token: string | null;
}): string {
  const lines = [
    `Deleting ${preview.rootCount} root thread${preview.rootCount === 1 ? "" : "s"} and ${preview.childCount} child thread${preview.childCount === 1 ? "" : "s"} (${preview.totalThreadCount} total, permanently):`,
    ...preview.included.map(
      (root) => `- ${quoteName(root.title)} (${root.id})${root.childCount === 0 ? "" : ` — ${root.childCount} child threads`}`,
    ),
  ];
  if (preview.skipped.length > 0) {
    lines.push(
      "Kept:",
      ...preview.skipped.map((root) => `- ${root.id}: ${root.message}`),
    );
  }
  lines.push(
    preview.token === null
      ? "Nothing in this selection can be deleted, for the reasons above."
      : "Nothing has been deleted yet. Call again with acknowledged true to delete.",
  );
  return lines.join("\n");
}

export function registerDestructiveTools(
  registry: AgentToolRegistry,
  deps: AgentToolDeps,
): void {
  registry.register({
    name: "nest_thread_delete",
    feature: "destructive",
    description:
      "Permanently delete the root thread ids given and every child thread under them (a child thread cannot be deleted on its own; it goes with its root family). Without acknowledged it only previews what would go and what is protected; call it again with acknowledged true to delete. The calling thread can never be deleted this way. This cannot be undone — show the user the preview before acknowledging.",
    parameters: z.object({
      thread_ids: THREAD_IDS,
      acknowledged: z
        .boolean()
        .default(false)
        .describe("Set true only after the user has seen what would be deleted."),
    }),
    async execute({ thread_ids, acknowledged }, context) {
      const outcome = await deps.actions.deleteThreads({
        threadIds: thread_ids,
        protectedThreadId: context.threadId,
        acknowledged,
      });
      if (outcome.result === null) return previewText(outcome.preview);
      const { deleted, skipped, failed } = outcome.result;
      return [
        `Deleted ${deleted.length} root thread${deleted.length === 1 ? "" : "s"}: ${deleted.join(", ") || "(none)"}.`,
        ...(skipped.length === 0 ? [] : [`Kept ${skipped.length}: ${skipped.map((root) => `${root.id} (${root.message})`).join("; ")}.`]),
        ...(failed.length === 0 ? [] : [`Failed ${failed.length}: ${failed.map((root) => `${root.id} (${root.message})`).join("; ")}.`]),
      ].join("\n");
    },
  });

  registry.register({
    name: "nest_project_delete",
    feature: "destructive",
    description:
      "Delete the project with this project id and all of its threads. Requires the exact expected name as well as acknowledged true, so a stale id cannot delete a project that was renamed. This cannot be undone.",
    parameters: z.object({
      project_id: z.string().min(1).describe("Project id from nest_sidebar_map."),
      expected_name: z
        .string()
        .min(1)
        .describe("The project's current name, exactly as the user sees it."),
      acknowledged: z
        .boolean()
        .default(false)
        .describe("Set true only after the user confirms the deletion."),
    }),
    async execute({ project_id, expected_name, acknowledged }) {
      if (!acknowledged) {
        return `This would delete ${quoteName(expected_name)} and every thread in it, permanently. Call again with acknowledged true and the same expected_name to proceed.`;
      }
      const removed = await deps.actions.removeProject(project_id, expected_name);
      if (!removed) {
        return `Did not delete ${project_id}: its name is not ${quoteName(expected_name)} any more, or it is gone. Re-read nest_sidebar_map.`;
      }
      void deps.refreshIndex();
      return `Deleted ${quoteName(expected_name)} (${project_id}) and its threads.`;
    },
  });

  registry.register({
    name: "nest_group_delete",
    feature: "destructive",
    description:
      "Delete the group with this group id from the sidebar. Its projects are not deleted; they fall back to Ungrouped. Requires acknowledged true.",
    parameters: z.object({
      group_id: z.string().min(1).describe("Group id from nest_sidebar_map."),
      acknowledged: z
        .boolean()
        .default(false)
        .describe("Set true only after the user confirms."),
    }),
    async execute({ group_id, acknowledged }) {
      if (!acknowledged) {
        return `This would delete the group ${group_id}; its projects fall back to Ungrouped. Call again with acknowledged true to proceed.`;
      }
      const removed = await deps.actions.deleteGroup(group_id);
      if (removed) void deps.refreshIndex();
      return removed
        ? `Deleted the group ${group_id}. Its projects are under Ungrouped now.`
        : `No group ${group_id}; the map may be stale.`;
    },
  });

  registry.register({
    name: "nest_worktree_remove",
    feature: "destructive",
    description:
      "Remove a worktree by environment id: archive its threads, release the environment, and delete the directory when delete directory (delete_directory) is true. The sidebar's own removal runs, so it surveys the directory again and refuses anything that still holds live work or uncommitted changes until you pass acknowledged true. This cannot be undone on disk.",
    parameters: z.object({
      environment_id: z.string().min(1).describe("The worktree's environment id."),
      delete_directory: z
        .boolean()
        .default(true)
        .describe("True deletes the folder; false only releases the environment and keeps it."),
      acknowledged: z
        .boolean()
        .default(false)
        .describe("Set true only after the user has seen what the survey says would be lost."),
    }),
    async execute({ environment_id, delete_directory, acknowledged }) {
      const outcome = await deps.actions.removeWorkspace({
        environmentId: environment_id,
        deleteDirectory: delete_directory,
        acknowledged,
      });
      if (outcome.blocker === "acknowledgement") {
        return `The worktree still holds work (uncommitted files, live threads or terminals). Nothing was removed. Show the user what is there, then call again with acknowledged true if they agree.`;
      }
      if (outcome.blocker === "unavailable") {
        return `This directory cannot be taken back automatically. Nothing was removed.`;
      }
      if (!outcome.ok) {
        return `Removal stopped: ${outcome.message ?? "bb refused."}. Threads archived: ${outcome.archivedThreads ? "yes" : "no"}.`;
      }
      return [
        `Released the environment${outcome.archivedThreads ? " and archived its threads" : ""}.`,
        outcome.directory === "removed"
          ? "The directory was removed."
          : outcome.directory === "failed"
            ? `The directory could not be removed${outcome.message === null ? "" : `: ${outcome.message}`}.`
            : "The directory was kept.",
      ].join(" ");
    },
  });
}
