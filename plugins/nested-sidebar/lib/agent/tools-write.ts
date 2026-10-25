/**
 * The three writes an agent may make, when the user has turned them on.
 *
 * Every one of them changes something the user made, and every one of them is
 * reversible. That combination is the whole rule for what is allowed here: a
 * tool that removes a worktree, deletes a project, or reorders a group is
 * reachable from the sidebar by a person who can see what they are about to
 * lose, and is not reachable from a model that cannot.
 *
 * Three things each of them does, in this order and for these reasons:
 *
 * 1. **Checks the id against the current index.** A model holding a map from ten
 *    minutes ago will eventually pass an id that has gone. Saying so is a true
 *    answer it can act on; letting the store refuse silently is a tool that
 *    looks broken.
 * 2. **Goes through `NestAgentActions`.** The same seam the sidebar's own menus
 *    use, so an agent's write and a click cannot diverge — including the publish
 *    that makes the change appear without a reload.
 * 3. **Refreshes the index.** The next read is then what the user is looking at,
 *    rather than what was there before the agent changed it.
 *
 * The tools are registered one at a time rather than returned as a list. Their
 * parameter shapes differ, so a list of them has no honest element type, and the
 * only way to write one down is an erasure or a cast — which is a type error
 * traded for a lie about what is in the array.
 */

import { z } from "zod";
import type { AgentToolRegistry } from "./toolkit.ts";
import type { AgentToolDeps } from "./actions.ts";
import { quoteName } from "./instructions.ts";

export function registerWriteTools(registry: AgentToolRegistry, deps: AgentToolDeps): void {
  /** The project's name as the index currently has it, for a readable reply. */
  const projectName = (projectId: string): string =>
    deps.index()?.projects.find((project) => project.id === projectId)?.name ?? projectId;

  registry.register({
    name: "nest_project_set_group",
    feature: "grouping",
    description:
      "File a project into a group in the Nest sidebar, or pass group_id null to move it out to Ungrouped. Use the project id and group id from nest_sidebar_map. This changes only how the project is filed; it never touches a project, a thread or a directory. Call it when the user asks for a project to be filed somewhere, not on your own initiative.",
    parameters: z.object({
      project_id: z.string().min(1).describe("Project id from nest_sidebar_map."),
      group_id: z
        .string()
        .min(1)
        .nullable()
        .describe("Group id from nest_sidebar_map, or null for Ungrouped."),
    }),
    async execute({ project_id, group_id }) {
      const index = deps.index();
      if (index !== null) {
        if (!index.projects.some((project) => project.id === project_id)) {
          return `No project with id ${project_id}. Re-read the map; the sidebar has changed.`;
        }
        if (group_id !== null && !index.groups.some((group) => group.id === group_id)) {
          return `No group with id ${group_id}. Re-read the map; the sidebar has changed.`;
        }
      }

      const name = projectName(project_id);
      const changed = await deps.actions.assignProjectToGroup(project_id, group_id);
      await deps.refreshIndex();

      const where =
        group_id === null
          ? "Ungrouped"
          : quoteName(
              deps.index()?.groups.find((group) => group.id === group_id)?.name ?? group_id,
            );
      return changed
        ? `Filed ${quoteName(name)} under ${where}.`
        : `${quoteName(name)} was already under ${where}; nothing changed.`;
    },
  });

  registry.register({
    name: "nest_group_create",
    feature: "groups",
    description:
      "Create a group in the Nest sidebar. Groups are the level above projects. Pass the name the user wants to read in the tab strip. Use it when the user asks for a new group to file projects under; then use nest_project_set_group to file them. Returns the new group's id.",
    parameters: z.object({
      name: z.string().min(1).describe("Group name, as the user wants to read it."),
    }),
    async execute({ name }) {
      const created = await deps.actions.createGroup(name, undefined);
      if (created === null) {
        return `Could not create a group named ${quoteName(name)}. The name may be empty, or the group limit may be reached.`;
      }
      await deps.refreshIndex();
      return `Created group ${created.id} ${quoteName(created.name)}.`;
    },
  });

  registry.register({
    name: "nest_group_rename",
    feature: "groups",
    description:
      "Rename a group in the Nest sidebar. Use the group id from nest_sidebar_map. Only do this when the user asks for the rename; the group's name is something they read every day.",
    parameters: z.object({
      group_id: z.string().min(1).describe("Group id from nest_sidebar_map."),
      name: z.string().min(1).describe("The new name."),
    }),
    async execute({ group_id, name }) {
      const index = deps.index();
      const existing = index?.groups.find((group) => group.id === group_id);
      if (index !== null && existing === undefined) {
        return `No group with id ${group_id}. Re-read the map; the sidebar has changed.`;
      }
      const previous = existing?.name ?? group_id;

      const ok = await deps.actions.renameGroup(group_id, name);
      if (!ok) return `Could not rename group ${group_id}; it may have been deleted.`;
      await deps.refreshIndex();
      return `Renamed ${quoteName(previous)} to ${quoteName(name)}.`;
    },
  });

  registry.register({
    name: "nest_workspace_set_alias",
    feature: "aliases",
    description:
      "Set or clear the display name of a worktree in the Nest sidebar — the alias shown on the workspace row instead of its branch. Takes the environment_id from nest_sidebar_map, not the path. Pass alias null to clear it and go back to showing the branch.",
    parameters: z.object({
      environment_id: z.string().min(1).describe("environment_id from nest_sidebar_map."),
      alias: z.string().nullable().describe("The display name, or null to clear it."),
    }),
    async execute({ environment_id, alias }) {
      const index = deps.index();
      const known = index?.environments[environment_id];
      if (index !== null && known === undefined) {
        return `No environment with id ${environment_id}. Re-read the map; the sidebar has changed.`;
      }

      const stored = await deps.actions.setWorkspaceAlias(environment_id, alias);
      await deps.refreshIndex();
      const where = known?.path ?? environment_id;
      return stored === null
        ? `Cleared the alias for ${where}; the row shows its branch again.`
        : `Set the alias for ${where} to ${quoteName(stored)}.`;
    },
  });
}
