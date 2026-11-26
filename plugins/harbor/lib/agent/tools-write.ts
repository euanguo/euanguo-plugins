/**
 * Consolidated reversible sidebar and thread organization tool (`harbor_sidebar_organize`).
 *
 * Covers project filing, project renaming, group create/rename, workspace alias
 * edits, and reversible thread tidying (settle/snooze/pin/rename). Manual list
 * ordering is intentionally excluded.
 */

import { z } from "zod";
import type { AgentToolDeps } from "./actions.ts";
import { quoteName } from "./instructions.ts";
import type { AgentToolRegistry } from "./toolkit.ts";
import { executeThreadOrganizeAction } from "./tools-threads.ts";

const SIDEBAR_ORGANIZE_ACTIONS = [
  "project_rename",
  "project_set_group",
  "group_create",
  "group_rename",
  "workspace_set_alias",
  "thread_settle",
  "thread_snooze",
  "thread_pin",
  "thread_rename",
] as const;

export function registerWriteTools(
  registry: AgentToolRegistry,
  deps: AgentToolDeps,
): void {
  const projectName = (projectId: string): string =>
    deps.index()?.projects.find((project) => project.id === projectId)?.name ?? projectId;

  registry.register({
    name: "harbor_sidebar_organize",
    description:
      "Organize Harbor sidebar items or tidy threads when the user asks: rename a project (project_id, name), file a project into a group or null for Ungrouped (project_id, group_id), create a group (name), rename a group (group_id, name), set or clear a workspace alias (environment_id, alias), settle/unsettle threads (thread_ids, settled), snooze/unsnooze threads (thread_ids, until), pin/unpin threads (thread_ids, pinned), or rename a thread (thread_id, title). Manual ordering cannot be modified here.",
    parameters: z.object({
      action: z
        .enum(SIDEBAR_ORGANIZE_ACTIONS)
        .describe("The organization action to perform."),
      project_id: z
        .string()
        .min(1)
        .optional()
        .describe("Project id from harbor_sidebar_map (for project_rename, project_set_group)."),
      group_id: z
        .string()
        .min(1)
        .nullable()
        .optional()
        .describe("Group id from harbor_sidebar_map, or null for Ungrouped (for project_set_group, group_rename)."),
      environment_id: z
        .string()
        .min(1)
        .optional()
        .describe("Environment id from harbor_sidebar_map (for workspace_set_alias)."),
      name: z
        .string()
        .min(1)
        .max(120)
        .optional()
        .describe("Display name (for project_rename, group_create, group_rename)."),
      alias: z
        .string()
        .nullable()
        .optional()
        .describe("Workspace display alias, or null to clear it (for workspace_set_alias)."),
      thread_id: z
        .string()
        .min(1)
        .optional()
        .describe("Thread id to rename; omit for this thread (for thread_rename)."),
      thread_ids: z
        .array(z.string().min(1))
        .min(1)
        .max(20)
        .optional()
        .describe("Thread ids up to 20; omit for this thread (for thread_settle, thread_snooze, thread_pin)."),
      settled: z
        .boolean()
        .default(true)
        .describe("True to settle and archive; false to bring back (for thread_settle)."),
      until: z
        .string()
        .min(1)
        .nullable()
        .optional()
        .describe("ISO 8601 wake-up time, or null to unsnooze (for thread_snooze)."),
      pinned: z
        .boolean()
        .default(true)
        .describe("True to pin; false to unpin (for thread_pin)."),
      title: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe("New thread title (for thread_rename)."),
    }),
    async execute(params, context) {
      const { action } = params;
      switch (action) {
        case "project_rename": {
          if (params.project_id === undefined) {
            return "project_id is required for project_rename.";
          }
          const trimmed = params.name?.trim() ?? "";
          if (trimmed.length === 0) return "A project needs a name.";
          const stored = await deps.actions.renameProject(params.project_id, trimmed);
          if (stored === null) {
            return `bb would not rename ${params.project_id}. The project may be gone, or the name refused.`;
          }
          void deps.refreshIndex();
          return `Renamed ${params.project_id} to ${quoteName(stored)}.`;
        }

        case "project_set_group": {
          if (params.project_id === undefined) {
            return "project_id is required for project_set_group.";
          }
          if (params.group_id === undefined) {
            return "group_id is required for project_set_group (pass null to move to Ungrouped).";
          }
          const index = deps.index();
          if (index !== null) {
            if (!index.projects.some((project) => project.id === params.project_id)) {
              return `No project with id ${params.project_id}. Re-read the map; the sidebar has changed.`;
            }
            if (
              params.group_id !== null &&
              !index.groups.some((group) => group.id === params.group_id)
            ) {
              return `No group with id ${params.group_id}. Re-read the map; the sidebar has changed.`;
            }
          }
          const label = projectName(params.project_id);
          const changed = await deps.actions.assignProjectToGroup(
            params.project_id,
            params.group_id,
          );
          await deps.refreshIndex();
          const where =
            params.group_id === null
              ? "Ungrouped"
              : quoteName(
                  deps.index()?.groups.find((group) => group.id === params.group_id)
                    ?.name ?? params.group_id,
                );
          return changed
            ? `Filed ${quoteName(label)} under ${where}.`
            : `${quoteName(label)} was already under ${where}; nothing changed.`;
        }

        case "group_create": {
          const trimmed = params.name?.trim() ?? "";
          if (trimmed.length === 0) return "name is required for group_create.";
          const created = await deps.actions.createGroup(trimmed, undefined);
          if (created === null) {
            return `Could not create a group named ${quoteName(trimmed)}. The name may be empty, or the group limit may be reached.`;
          }
          await deps.refreshIndex();
          return `Created group ${created.id} ${quoteName(created.name)}.`;
        }

        case "group_rename": {
          if (typeof params.group_id !== "string" || params.group_id.length === 0) {
            return "group_id is required for group_rename.";
          }
          const groupId = params.group_id;
          const trimmed = params.name?.trim() ?? "";
          if (trimmed.length === 0) return "name is required for group_rename.";
          const index = deps.index();
          const existing = index?.groups.find((group) => group.id === groupId);
          if (index !== null && existing === undefined) {
            return `No group with id ${groupId}. Re-read the map; the sidebar has changed.`;
          }
          const previous = existing?.name ?? groupId;
          const ok = await deps.actions.renameGroup(groupId, trimmed);
          if (!ok) {
            return `Could not rename group ${groupId}; it may have been deleted.`;
          }
          await deps.refreshIndex();
          return `Renamed ${quoteName(previous)} to ${quoteName(trimmed)}.`;
        }

        case "workspace_set_alias": {
          if (params.environment_id === undefined) {
            return "environment_id is required for workspace_set_alias.";
          }
          if (params.alias === undefined) {
            return "alias is required for workspace_set_alias (pass null to clear it).";
          }
          const index = deps.index();
          const known = index?.environments[params.environment_id];
          if (index !== null && known === undefined) {
            return `No environment with id ${params.environment_id}. Re-read the map; the sidebar has changed.`;
          }
          const stored = await deps.actions.setWorkspaceAlias(
            params.environment_id,
            params.alias,
          );
          await deps.refreshIndex();
          const where = known?.path ?? params.environment_id;
          return stored === null
            ? `Cleared the alias for ${where}; the row shows its branch again.`
            : `Set the alias for ${where} to ${quoteName(stored)}.`;
        }

        case "thread_settle":
        case "thread_snooze":
        case "thread_pin":
        case "thread_rename":
          return executeThreadOrganizeAction(
            deps,
            {
              action,
              thread_id: params.thread_id,
              thread_ids: params.thread_ids,
              settled: params.settled,
              until: params.until,
              pinned: params.pinned,
              title: params.title,
            },
            context.threadId,
          );

        default: {
          const _exhaustive: never = action;
          return _exhaustive;
        }
      }
    },
  });
}
