/**
 * The one read: everything Nest knows about how the sidebar is organized.
 *
 * One tool rather than six, because the questions come together — "which
 * projects are there, what are they grouped under, which worktrees do they have,
 * and does anything disagree" is one thought, and six calls to answer it is six
 * round trips and five chances to ask the wrong one. The whole map is well
 * inside the output cap for any real install, and the cap says so when it is not.
 *
 * Everything it prints is an id the write tools accept, or a name beside one.
 * That is the contract A1 in `PLAN-AGENT-TOOLS.md` names: a model that has to
 * guess an identifier will guess a name, and two projects can share one.
 */

import { z } from "zod";
import type { AgentToolRegistry } from "./toolkit.ts";
import type { AgentToolDeps } from "./actions.ts";
import type { SidebarIndex } from "./index-cache.ts";
import { quoteName } from "./instructions.ts";
import { classifyWorkspace } from "../workspace.ts";
import { ownedWorkspaces } from "../workspace-ownership.ts";

export function registerReadTools(registry: AgentToolRegistry, deps: AgentToolDeps): void {
  registry.register({
    name: "nest_sidebar_map",
    feature: "read",
    description:
      "Read how the user has organized projects in the Nest sidebar: the groups, which group each project is filed under, and every workspace a project has with its branch, its display alias and its environment id. Also reports worktrees that exist on disk but have no environment in bb, and any place bb's project records disagree with what is actually on disk. Call it before filing a project, naming a group, or starting work in a worktree, and use the ids it returns rather than the names.",
    parameters: z.object({}),
    async execute() {
      const index = deps.index();
      if (index === null) {
        return (
          "Nest has not read the sidebar structure yet. This usually means the " +
          "plugin just started; try again in a moment."
        );
      }
      return renderSidebarMap(index);
    },
  });
}

/**
 * The map as text.
 *
 * Exported because it is the tool's whole answer and worth testing without a
 * registry, an index cache or a host: given an index, the text is a pure
 * function of it.
 *
 * Ids are printed before names and never abbreviated. A reader scanning this for
 * an id needs it to be findable, and a truncated id is worse than a long line —
 * it looks usable and is not.
 */
export function renderSidebarMap(index: SidebarIndex): string {
  const groupName = (id: string | null): string => {
    if (id === null) return "Ungrouped";
    return index.groups.find((group) => group.id === id)?.name ?? "Ungrouped";
  };

  const lines: string[] = ["# Nest sidebar"];

  lines.push("", "## Groups");
  if (index.groups.length === 0) {
    lines.push("  (none — every project is Ungrouped)");
  } else {
    const counts = new Map<string, number>();
    for (const project of index.projects) {
      const groupId = index.assignment[project.id] ?? "";
      counts.set(groupId, (counts.get(groupId) ?? 0) + 1);
    }
    for (const group of index.groups) {
      lines.push(
        `  ${group.id}  ${quoteName(group.name)}  icon ${group.icon}  ` +
          `${counts.get(group.id) ?? 0} project${(counts.get(group.id) ?? 0) === 1 ? "" : "s"}`,
      );
    }
    const ungrouped = counts.get("") ?? 0;
    if (ungrouped > 0) lines.push(`  (ungrouped)  ${ungrouped} project${ungrouped === 1 ? "" : "s"}`);
  }

  lines.push("", "## Projects");
  if (index.projects.length === 0) {
    lines.push("  (none)");
  }
  for (const project of index.projects) {
    const groupId = index.assignment[project.id] ?? null;
    const repoKey = index.repoFacts.repoKeyByProject[project.id] ?? null;
    const repo = repoKey === null
      ? undefined
      : index.repoFacts.repos.find((candidate) => candidate.key === repoKey);
    lines.push(
      `  ${project.id}  ${quoteName(project.name)}  group ${quoteName(groupName(groupId))}` +
        (groupId === null ? "" : ` (${groupId})`),
    );
    if (repo !== undefined) {
      lines.push(
        `    repository: ${repo.name}  ${repo.kind}` +
          `${repo.remoteUrl === null ? "" : `  ${repo.remoteUrl}`}`,
      );
    }

    const workspaces = ownedWorkspaces(
      index.repoFacts.repos,
      index.repoFacts.workspaceOwnership,
      project.id,
    );
    for (const workspace of workspaces) {
      const environmentId = workspace.environmentId ?? undefined;
      const environment = environmentId === undefined
        ? undefined
        : index.environments[environmentId];
      lines.push(`    workspace ${workspace.workspace.path}`);
      const details: string[] = [];
      if (workspace.repo.key !== repo?.key) {
        details.push(`repository ${quoteName(workspace.repo.name)}`);
      }
      if (environment?.branchName != null) details.push(`branch ${quoteName(environment.branchName)}`);
      if (environment?.name != null) details.push(`alias ${quoteName(environment.name)}`);
      if (environmentId !== undefined) details.push(`environment_id ${environmentId}`);
      // The classified kind, not bb's raw provisioning kind: this is what the row
      // is labelled, and it is the difference between "the project lives here"
      // and "someone made a worktree here".
      if (environment !== undefined) {
        details.push(`kind ${classifyWorkspace(environment, index.projectSources[project.id])}`);
      }
      if (details.length > 0) lines.push(`      ${details.join("  ")}`);
      if (workspace.workspace.environmentIds.length > 1) {
        lines.push(`      (${workspace.workspace.environmentIds.length} environment records for this directory)`);
      }
    }

    const unseen = repo?.unseenWorktrees ?? [];
    if (unseen.length > 0) {
      lines.push("    worktrees on disk with no environment in bb (no thread can start here yet):");
      for (const worktree of unseen) {
        lines.push(
          `      ${worktree.path}` +
            `${worktree.branch === null ? "" : `  branch ${quoteName(worktree.branch)}`}` +
            `${worktree.detached ? "  detached" : ""}` +
            `${worktree.prunable ? "  (directory is gone)" : ""}`,
        );
      }
    }
  }

  lines.push("", "## Findings");
  if (index.repoFacts.diagnostics.length === 0) {
    lines.push("  Every workspace agrees with the project bb filed it under.");
  } else {
    for (const diagnostic of index.repoFacts.diagnostics) {
      lines.push(`  [${diagnostic.code}] ${diagnostic.message}`);
      if (diagnostic.subjects.length > 0) {
        lines.push(`    ${diagnostic.subjects.join(", ")}`);
      }
    }
  }
  if (index.repoFacts.unavailableHostIds.length > 0) {
    lines.push(
      `  ${index.repoFacts.unavailableHostIds.length} machine(s) did not answer, so their workspaces ` +
        `are shown from their paths alone: ${index.repoFacts.unavailableHostIds.join(", ")}`,
    );
  }

  lines.push(
    "",
    "## What can be changed",
    "  nest_project_set_group(project_id, group_id)  — file a project, or null to ungroup it",
    "  nest_group_create(name)                       — add a group",
    "  nest_group_rename(group_id, name)             — rename a group",
    "  nest_workspace_set_alias(environment_id, alias) — name a worktree, or null to clear it",
    "  Ordering within a group is the user's own arrangement and cannot be changed here.",
  );

  return lines.join("\n");
}
