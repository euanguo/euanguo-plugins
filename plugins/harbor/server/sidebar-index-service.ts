import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { MAX_FACTS_PATHS } from "../host/contract.ts";
import type {
  createSidebarIndexCache,
  SidebarIndex,
} from "../lib/agent/index-cache.ts";
import type { FeatureMember } from "../lib/domain/features.ts";
import {
  inferRepos,
  type FeatureOwnedPathInput,
  type WorkspaceFacts,
} from "../lib/domain/repo-identity.ts";
import { workspaceDisplayKindOf } from "../lib/domain/workspace.ts";
import { physicalWorkspaceKey } from "../lib/domain/workspace-key.ts";
import { inferWorkspaceOwnership } from "../lib/domain/workspace-ownership.ts";
import type {
  WorkspaceEnvironmentDescriptor,
  WorkspaceProjectDescriptor,
} from "../lib/domain/workspace.ts";
import type { FeatureStore } from "../lib/stores/feature-store.ts";
import type { createGroupStore } from "../lib/stores/group-store.ts";
import type {
  createRepoFactsCache,
  WorkspaceProbeTarget,
} from "../lib/stores/repo-facts.ts";

const WORKSPACE_PATH_LIMIT = 500;

function isDestroyedEnvironment(environment: {
  readonly status?: string | null;
  readonly lifecycle?: { readonly phase?: string | null } | null;
  readonly hostLifecycle?: string | null;
}): boolean {
  return (
    environment.status === "destroyed" ||
    environment.lifecycle?.phase === "destroyed" ||
    environment.hostLifecycle === "removed"
  );
}

function deduplicateTargets(
  targets: readonly WorkspaceProbeTarget[],
): WorkspaceProbeTarget[] {
  const seen = new Set<string>();
  const unique: WorkspaceProbeTarget[] = [];
  for (const target of targets) {
    const key = `${target.hostId}\0${target.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(target);
  }
  return unique;
}

export function createSidebarIndexService(input: {
  readonly bb: BbPluginApi;
  readonly groups: ReturnType<typeof createGroupStore>;
  readonly repoFacts: ReturnType<typeof createRepoFactsCache>;
  readonly index: ReturnType<typeof createSidebarIndexCache>;
  readonly featureStore?: Pick<
    FeatureStore,
    "list" | "containers" | "featuresRoots"
  >;
  readonly featureMembers?: () => readonly FeatureMember[];
}) {
  const { bb, groups, repoFacts, index, featureStore, featureMembers } = input;
  const danglingByEnvironmentId = new Map<string, boolean>();

  const readWorkspaceDescriptors = async (): Promise<{
    environments: Readonly<
      Record<string, WorkspaceEnvironmentDescriptor>
    >;
    projects: Readonly<Record<string, WorkspaceProjectDescriptor>>;
    truncated: boolean;
  }> => {
    const [environments, projects] = await Promise.all([
      // One past the cap, so "exactly at the cap" is not reported as a
      // truncation. The extra row is dropped below.
      bb.sdk.environments.list({ limit: WORKSPACE_PATH_LIMIT + 1 }),
      bb.sdk.projects.list({}),
    ]);
    const kept = environments
      .filter((environment) => !isDestroyedEnvironment(environment))
      .slice(0, WORKSPACE_PATH_LIMIT);
    const environmentDescriptors: Record<
      string,
      WorkspaceEnvironmentDescriptor
    > = {};
    for (const environment of kept) {
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
        managed: environment.managed ?? false,
        createdAt: environment.createdAt ?? null,
        updatedAt: environment.updatedAt ?? null,
        providerInstanceKey: environment.environmentProviderInstanceKey ?? null,
        dangling: danglingByEnvironmentId.get(environment.id) ?? false,
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
      truncated: environments.length > WORKSPACE_PATH_LIMIT,
    };
  };

  const refresh = async (): Promise<SidebarIndex | null> => {
    try {
      const { environments, projects, truncated } =
        await readWorkspaceDescriptors();
      const workspaceTargets = deduplicateTargets([
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
      ]);
      const featureProbeTargets: WorkspaceProbeTarget[] = [];
      for (const feature of featureStore?.list() ?? []) {
        if (feature.rootPath !== null && feature.hostId !== null) {
          featureProbeTargets.push({
            hostId: feature.hostId,
            path: feature.rootPath,
          });
        }
      }
      for (const root of featureStore?.featuresRoots() ?? []) {
        featureProbeTargets.push({ hostId: root.hostId, path: root.rootPath });
      }
      for (const member of featureMembers?.() ?? []) {
        if (member.role === "ref") continue;
        featureProbeTargets.push({ hostId: member.hostId, path: member.path });
      }

      const targets = deduplicateTargets([
        ...workspaceTargets,
        ...featureProbeTargets,
      ]);
      const facts: WorkspaceFacts[] = [];
      const unavailableSet = new Set<string>();
      for (let start = 0; start < targets.length; start += MAX_FACTS_PATHS) {
        const chunk = targets.slice(start, start + MAX_FACTS_PATHS);
        const batch = await repoFacts.read(chunk);
        facts.push(...batch.facts);
        for (const hostId of batch.unavailableHostIds) {
          unavailableSet.add(hostId);
        }
      }
      const unavailableHostIds = [...unavailableSet];
      if (workspaceTargets.length > 0 && facts.length === 0) {
        return index.read();
      }

      const factByKey = new Map<string, WorkspaceFacts>();
      const factRealPathByKey = new Map<string, string | null>();
      for (const fact of facts) {
        const key = physicalWorkspaceKey(fact.hostId, fact.path);
        factByKey.set(key, fact);
        factRealPathByKey.set(key, fact.realPath);
        if (fact.realPath !== null) {
          const realKey = physicalWorkspaceKey(fact.hostId, fact.realPath);
          if (!factByKey.has(realKey)) factByKey.set(realKey, fact);
        }
      }

      const enrichedEnvironments: Record<
        string,
        WorkspaceEnvironmentDescriptor
      > = {};
      const nextDangling = new Map<string, boolean>();
      for (const [environmentId, descriptor] of Object.entries(environments)) {
        let dangling = descriptor.dangling ?? false;
        if (!unavailableSet.has(descriptor.hostId)) {
          if (descriptor.path === null) {
            dangling = false;
          } else {
            const fact = factByKey.get(
              physicalWorkspaceKey(descriptor.hostId, descriptor.path),
            );
            if (fact !== undefined) dangling = !fact.isDirectory;
          }
        }
        nextDangling.set(environmentId, dangling);
        enrichedEnvironments[environmentId] = { ...descriptor, dangling };
      }
      danglingByEnvironmentId.clear();
      for (const [environmentId, dangling] of nextDangling) {
        danglingByEnvironmentId.set(environmentId, dangling);
      }

      const featureOwnedPaths: FeatureOwnedPathInput[] = [];
      const pushFeaturePath = (
        hostId: string | null,
        rawPath: string | null,
      ) => {
        if (rawPath === null || rawPath.trim().length === 0) return;
        featureOwnedPaths.push(
          hostId === null ? rawPath : { hostId, path: rawPath },
        );
        if (hostId !== null) {
          const realPath = factRealPathByKey.get(
            physicalWorkspaceKey(hostId, rawPath),
          );
          if (
            realPath !== null &&
            realPath !== undefined &&
            realPath !== rawPath
          ) {
            featureOwnedPaths.push({ hostId, path: realPath });
          }
        }
      };
      for (const feature of featureStore?.list() ?? []) {
        pushFeaturePath(feature.hostId, feature.rootPath);
      }
      for (const root of featureStore?.featuresRoots() ?? []) {
        pushFeaturePath(root.hostId, root.rootPath);
      }
      for (const container of featureStore?.containers() ?? []) {
        pushFeaturePath(null, container);
      }
      for (const member of featureMembers?.() ?? []) {
        if (member.role === "ref") continue;
        pushFeaturePath(member.hostId, member.path);
      }

      const inferred = inferRepos({
        environments: Object.values(enrichedEnvironments),
        projects: new Map(Object.entries(projects)),
        facts,
        featureOwnedPaths,
      });
      const ownership = inferWorkspaceOwnership({
        environments: Object.values(enrichedEnvironments),
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
        environments: enrichedEnvironments,
        projectSources: projects,
        truncated,
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
