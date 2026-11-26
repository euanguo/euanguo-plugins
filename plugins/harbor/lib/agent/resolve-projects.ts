/**
 * Shared bb project matching by id, exact case-insensitive name, or unique
 * substring match.
 */
import { quoteName } from "./instructions.ts";

export interface ResolvableProject {
  readonly id: string;
  readonly name: string;
}

export function resolveSingleProject(
  projects: readonly ResolvableProject[],
  asked: string,
): { project: ResolvableProject } | { problem: string } {
  const needle = asked.trim().toLowerCase();
  if (needle.length === 0) {
    return { problem: `${quoteName(asked)}: project name or id cannot be blank.` };
  }
  const exact = projects.filter(
    (project) => project.id === asked || project.name.toLowerCase() === needle,
  );
  const matches =
    exact.length > 0
      ? exact
      : projects.filter((project) => project.name.toLowerCase().includes(needle));
  const single = matches[0];
  if (matches.length === 1 && single !== undefined) {
    return { project: single };
  }
  if (matches.length === 0) {
    return { problem: `${quoteName(asked)}: no bb project by that name or id.` };
  }
  return {
    problem: `${quoteName(asked)}: matches ${matches.map((project) => quoteName(project.name)).join(", ")}; pass the exact name or id.`,
  };
}

export async function resolveProjects(
  loadProjects: () => Promise<readonly ResolvableProject[]>,
  requested: readonly string[],
): Promise<{
  resolved: { projectId: string; asked: string }[];
  problems: string[];
}> {
  const projects = await loadProjects();
  const resolved: { projectId: string; asked: string }[] = [];
  const problems: string[] = [];
  for (const asked of requested) {
    const match = resolveSingleProject(projects, asked);
    if ("project" in match) {
      resolved.push({ projectId: match.project.id, asked });
    } else {
      problems.push(match.problem);
    }
  }
  return { resolved, problems };
}
