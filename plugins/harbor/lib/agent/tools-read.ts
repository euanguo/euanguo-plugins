/**
 * The one read for Harbor's sidebar map: groups, projects, workspaces, unseen
 * worktrees, and repository diagnostics.
 */

import { z } from "zod";
import { classifyWorkspace } from "../domain/workspace.ts";
import { ownedWorkspaces } from "../domain/workspace-ownership.ts";
import type { AgentToolDeps } from "./actions.ts";
import type { SidebarIndex } from "./index-cache.ts";
import { quoteName } from "./instructions.ts";
import type { AgentToolRegistry } from "./toolkit.ts";

export function registerReadTools(
  registry: AgentToolRegistry,
  deps: AgentToolDeps,
): void {
  registry.register({
    name: "harbor_sidebar_map",
    description:
      "Read how the user has organized projects in the Harbor sidebar: groups, which group each project is filed under, every workspace with its branch, display alias, and environment id, unseen worktrees on disk with no bb environment, and repository diagnostics.",
    parameters: z.object({}),
    async execute() {
      const index = deps.index();
      if (index === null) {
        return (
          "Harbor has not read the sidebar structure yet. This usually means the " +
          "plugin just started; try again in a moment."
        );
      }
      return renderSidebarMap(index);
    },
  });
}

/**
 * Pure text rendering of `SidebarIndex` so tests can exercise it directly.
 */
export function renderSidebarMap(index: SidebarIndex): string {
  const groupName = (id: string | null): string => {
    if (id === null) return "Ungrouped";
    return index.groups.find((group) => group.id === id)?.name ?? "Ungrouped";
  };

  const lines: string[] = ["# Harbor sidebar"];

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
      const count = counts.get(group.id) ?? 0;
      lines.push(
        `  ${group.id}  ${quoteName(group.name)}  icon ${group.icon}  ` +
          `${count} project${count === 1 ? "" : "s"}`,
      );
    }
    const ungrouped = counts.get("") ?? 0;
    if (ungrouped > 0) {
      lines.push(`  (ungrouped)  ${ungrouped} project${ungrouped === 1 ? "" : "s"}`);
    }
  }

  lines.push("", "## Projects");
  if (index.projects.length === 0) {
    lines.push("  (none)");
  }
  for (const project of index.projects) {
    const groupId = index.assignment[project.id] ?? null;
    const repoKey = index.repoFacts.repoKeyByProject[project.id] ?? null;
    const repo =
      repoKey === null
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
      const environment =
        environmentId === undefined
          ? undefined
          : index.environments[environmentId];
      lines.push(`    workspace ${workspace.workspace.path}`);
      const details: string[] = [];
      if (workspace.repo.key !== repo?.key) {
        details.push(`repository ${quoteName(workspace.repo.name)}`);
      }
      if (environment?.branchName != null) {
        details.push(`branch ${quoteName(environment.branchName)}`);
      }
      if (environment?.name != null) {
        details.push(`alias ${quoteName(environment.name)}`);
      }
      if (environmentId !== undefined) {
        details.push(`environment_id ${environmentId}`);
      }
      if (environment !== undefined) {
        details.push(
          `kind ${classifyWorkspace(environment, index.projectSources[project.id])}`,
        );
      }
      if (details.length > 0) lines.push(`      ${details.join("  ")}`);
      if (workspace.workspace.environmentIds.length > 1) {
        lines.push(
          `      (${workspace.workspace.environmentIds.length} environment records for this directory)`,
        );
      }
    }

    const unseen = repo?.unseenWorktrees ?? [];
    if (unseen.length > 0) {
      lines.push(
        "    worktrees on disk with no environment in bb (no thread can start here yet):",
      );
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

  return lines.join("\n");
}
