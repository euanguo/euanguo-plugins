import type { BbPluginApi } from "@get-bb/plugin-sdk";

import type {
  createSidebarIndexCache,
  SidebarIndex,
} from "../lib/agent/index-cache.ts";
import type { createGroupStore } from "../lib/group-store.ts";
import type { createRepoFactsCache } from "../lib/repo-facts.ts";
import { inferRepos } from "../lib/repo-identity.ts";
import { workspaceDisplayKindOf } from "../lib/workspace.ts";
import { inferWorkspaceOwnership } from "../lib/workspace-ownership.ts";
import type {
  WorkspaceEnvironmentDescriptor,
  WorkspaceProjectDescriptor,
} from "../lib/workspace.ts";

const WORKSPACE_PATH_LIMIT = 500;

export function createSidebarIndexService(input: {
  readonly bb: BbPluginApi;
  readonly groups: ReturnType<typeof createGroupStore>;
  readonly repoFacts: ReturnType<typeof createRepoFactsCache>;
  readonly index: ReturnType<typeof createSidebarIndexCache>;
}) {
  const { bb, groups, repoFacts, index } = input;

  const readWorkspaceDescriptors = async (): Promise<{
    environments: Readonly<
      Record<string, WorkspaceEnvironmentDescriptor>
    >;
    projects: Readonly<Record<string, WorkspaceProjectDescriptor>>;
  }> => {
    const [environments, projects] = await Promise.all([
      bb.sdk.environments.list({ limit: WORKSPACE_PATH_LIMIT }),
      bb.sdk.projects.list({}),
    ]);
    const environmentDescriptors: Record<
      string,
      WorkspaceEnvironmentDescriptor
    > = {};
    for (const environment of environments) {
      environmentDescriptors[environment.id] = {
        id: environment.id,
        projectId: environment.projectId,
        hostId: environment.hostId,
        path: environment.path,
        isGitRepo: environment.isGitRepo,
        isWorktree: environment.isWorktree,
        branchName: environment.branchName,
        name: environment.name,
        providerId: environment.environmentProviderId,
        workspaceDisplayKind: workspaceDisplayKindOf(environment),
      };
    }
    const projectDescriptors: Record<
      string,
      WorkspaceProjectDescriptor
    > = {};
    for (const project of projects) {
      const source =
        project.sources.find((candidate) => candidate.isDefault) ??
        project.sources[0];
      projectDescriptors[project.id] = {
        projectId: project.id,
        sourcePath: source?.path ?? null,
        sourceHostId: source?.hostId ?? null,
      };
    }
    return {
      environments: environmentDescriptors,
      projects: projectDescriptors,
    };
  };

  const refresh = async (): Promise<SidebarIndex | null> => {
    try {
      const { environments, projects } = await readWorkspaceDescriptors();
      const targets = [
        ...Object.values(environments).flatMap((environment) =>
          environment.path === null
            ? []
            : [{ hostId: environment.hostId, path: environment.path }],
        ),
        ...Object.values(projects).flatMap((project) =>
          project.sourcePath === null || project.sourceHostId === null
            ? []
            : [{ hostId: project.sourceHostId, path: project.sourcePath }],
        ),
      ];
      const { facts, unavailableHostIds } = await repoFacts.read(targets);
      if (targets.length > 0 && facts.length === 0) return index.read();
      const inferred = inferRepos({
        environments: Object.values(environments),
        projects: new Map(Object.entries(projects)),
        facts,
      });
      const ownership = inferWorkspaceOwnership({
        environments: Object.values(environments),
        repos: inferred.repos,
        sourceByProject: inferred.sourceByProject,
        sourceRepoKeyByProject: inferred.sourceRepoKeyByProject,
      });
      const ownershipDiagnostics = ownership.diagnostics.map((diagnostic) => {
        const environmentId = diagnostic.environments[0];
        const ownershipRow =
          environmentId === undefined
            ? undefined
            : ownership.byEnvironmentId[environmentId];
        return {
          code: diagnostic.code,
          repoKey: ownershipRow?.repoKey ?? "",
          subjects: [...diagnostic.environments, ...diagnostic.projects],
          message: diagnostic.message,
        };
      });
      const list = await bb.sdk.projects.list({});
      const next: SidebarIndex = {
        projects: list.map((project) => ({
          id: project.id,
          name: project.name,
        })),
        groups: groups.list(),
        assignment: groups.assignments(),
        repoFacts: {
          repos: inferred.repos,
          diagnostics: [...inferred.diagnostics, ...ownershipDiagnostics],
          repoKeyByProject: Object.fromEntries(inferred.repoKeyByProject),
          sourceRepoKeyByProject: Object.fromEntries(
            inferred.sourceRepoKeyByProject,
          ),
          workspaceOwnership: ownership.byEnvironmentId,
          unseenWorkspaces: ownership.unseenByProject,
          unavailableHostIds,
        },
        environments,
        projectSources: projects,
        updatedAt: Date.now(),
      };
      index.write(next);
      return next;
    } catch (error) {
      bb.log.warn(
        `could not refresh the sidebar index: ${error instanceof Error ? error.message : String(error)}`,
      );
      return index.read();
    }
  };

  const prime = async (attempts: number): Promise<void> => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if ((await refresh()) !== null) return;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  };

  return { readWorkspaceDescriptors, refresh, prime };
}
