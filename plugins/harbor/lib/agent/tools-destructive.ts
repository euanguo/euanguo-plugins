/**
 * Consolidated destructive administration tool (`harbor_admin_delete`).
 *
 * Every destructive action (`thread_delete`, `project_delete`, `group_delete`,
 * `worktree_remove`) enforces a strict two-step confirmation gate: the first
 * call with `acknowledged: false` (default) only previews what would be
 * affected; only a follow-up call with `acknowledged: true` performs the removal.
 */

import { z } from "zod";
import type { AgentToolDeps } from "./actions.ts";
import { quoteName } from "./instructions.ts";
import type { AgentToolRegistry } from "./toolkit.ts";

const ADMIN_DELETE_ACTIONS = [
  "thread_delete",
  "project_delete",
  "group_delete",
  "worktree_remove",
] as const;

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
      (root) =>
        `- ${quoteName(root.title)} (${root.id})${root.childCount === 0 ? "" : ` — ${root.childCount} child threads`}`,
    ),
  ];
  if (preview.skipped.length > 0) {
    lines.push(
      "Kept:",
      ...preview.skipped.map((root) => `- ${root.id}: ${root.message}`),
    );
  }
  if (preview.token !== null) {
    lines.push(`Preview token: ${preview.token}`);
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
    name: "harbor_admin_delete",
    description:
      "Permanently delete threads (thread_ids), a project (project_id, expected_name), a group (group_id), or remove a worktree (environment_id, delete_directory). Every action requires two-step confirmation: call first with acknowledged false to preview, show the user, then call again with acknowledged true. Manual ordering cannot be changed here.",
    parameters: z.object({
      action: z
        .enum(ADMIN_DELETE_ACTIONS)
        .describe("The destructive action to run."),
      thread_ids: z
        .array(z.string().min(1))
        .min(1)
        .max(20)
        .optional()
        .describe("Root thread ids up to 20 (for thread_delete)."),
      project_id: z
        .string()
        .min(1)
        .optional()
        .describe("Project id from harbor_sidebar_map (for project_delete)."),
      expected_name: z
        .string()
        .min(1)
        .optional()
        .describe("The project's exact current name (for project_delete)."),
      group_id: z
        .string()
        .min(1)
        .optional()
        .describe("Group id from harbor_sidebar_map (for group_delete)."),
      environment_id: z
        .string()
        .min(1)
        .optional()
        .describe("Worktree environment id from harbor_sidebar_map (for worktree_remove)."),
      delete_directory: z
        .boolean()
        .default(false)
        .describe("For worktree_remove: the directory is kept unless delete_directory is true."),
      acknowledged: z
        .boolean()
        .default(false)
        .describe("Set true only on a second call after showing the user the preview."),
    }),
    async execute(params, context) {
      const { action, acknowledged } = params;
      switch (action) {
        case "thread_delete": {
          if (params.thread_ids === undefined) {
            return "thread_ids is required for thread_delete.";
          }
          const outcome = await deps.actions.deleteThreads({
            threadIds: params.thread_ids,
            protectedThreadId: context.threadId,
            acknowledged,
          });
          if (outcome.result === null) return previewText(outcome.preview);
          const { deleted, skipped, failed } = outcome.result;
          return [
            `Deleted ${deleted.length} root thread${deleted.length === 1 ? "" : "s"}: ${deleted.join(", ") || "(none)"}.`,
            ...(skipped.length === 0
              ? []
              : [
                  `Kept ${skipped.length}: ${skipped.map((root) => `${root.id} (${root.message})`).join("; ")}.`,
                ]),
            ...(failed.length === 0
              ? []
              : [
                  `Failed ${failed.length}: ${failed.map((root) => `${root.id} (${root.message})`).join("; ")}.`,
                ]),
          ].join("\n");
        }

        case "project_delete": {
          if (params.project_id === undefined || params.expected_name === undefined) {
            return "project_id and expected_name are required for project_delete.";
          }
          if (!acknowledged) {
            return `This would delete ${quoteName(params.expected_name)} (${params.project_id}) and every thread in it, permanently. Call again with acknowledged true and the same expected_name to proceed.`;
          }
          const removed = await deps.actions.removeProject(
            params.project_id,
            params.expected_name,
          );
          if (!removed) {
            return `Did not delete ${params.project_id}: its name is not ${quoteName(params.expected_name)} any more, or it is gone. Re-read harbor_sidebar_map.`;
          }
          return `Deleted ${quoteName(params.expected_name)} (${params.project_id}) and its threads.`;
        }

        case "group_delete": {
          if (params.group_id === undefined) {
            return "group_id is required for group_delete.";
          }
          if (!acknowledged) {
            return `This would delete the group ${params.group_id}; its projects fall back to Ungrouped. Call again with acknowledged true to proceed.`;
          }
          const removed = await deps.actions.deleteGroup(params.group_id);
          return removed
            ? `Deleted the group ${params.group_id}. Its projects are under Ungrouped now.`
            : `No group ${params.group_id}; the map may be stale.`;
        }

        case "worktree_remove": {
          if (params.environment_id === undefined) {
            return "environment_id is required for worktree_remove.";
          }
          if (!acknowledged) {
            return `This would archive the threads of ${params.environment_id} and release the environment${params.delete_directory ? " (and permanently delete its directory on disk)" : " (keeping its directory)"}. Call again with acknowledged true after confirming with the user.`;
          }
          const outcome = await deps.actions.removeWorkspace({
            environmentId: params.environment_id,
            deleteDirectory: params.delete_directory,
            acknowledged: true,
          });
          if (outcome.code === "acknowledgement") {
            return "The worktree still holds work (uncommitted files, live threads or terminals). Nothing was removed. Show the user what is there, then call again with acknowledged true if they agree.";
          }
          if (outcome.code === "unavailable") {
            return "This directory cannot be taken back automatically. Nothing was removed.";
          }
          if (outcome.code === "changed") {
            return "The worktree changed since it was inspected, so nothing was removed. Inspect it again and show the user the new counts before retrying.";
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
        }

        default: {
          const _exhaustive: never = action;
          return _exhaustive;
        }
      }
    },
  });
}
