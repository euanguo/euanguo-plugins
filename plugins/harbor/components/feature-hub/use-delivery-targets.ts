import { experimental_useSidebarThreads as useSidebarThreads } from "@get-bb/plugin-sdk/app";
import { useMemo } from "react";

import type { FeatureRepoGitStatus } from "@/lib/domain/feature-git";
import { normalizeFeaturePath } from "@/lib/domain/features";
import type { WorkspacePullRequest } from "@/lib/domain/pull-request";
import { useSharedWorkspaceIndex } from "@/lib/ui/workspace-index-store";
import { useWorkspacePullRequests } from "@/lib/ui/workspace-pull-requests";

export interface DeliveryRepoTarget {
  readonly environmentId: string | null;
  readonly threadId: string | null;
  readonly envIds: readonly string[];
  readonly pullRequest: WorkspacePullRequest | null;
}

export function useDeliveryRepoTargets(
  repos: readonly FeatureRepoGitStatus[],
): {
  readonly targets: ReadonlyMap<string, DeliveryRepoTarget>;
  readonly currentThreadInRepo: (directory: string, activeThreadId: string | null) => boolean;
} {
  const { threads } = useSidebarThreads();
  const sharedIndex = useSharedWorkspaceIndex();

  const rawTargets = useMemo(() => {
    const map = new Map<
      string,
      { environmentId: string | null; threadId: string | null; envIds: string[] }
    >();
    for (const repo of repos) {
      const norm = normalizeFeaturePath(repo.path);
      const indexed = sharedIndex?.byPath.get(norm);
      const envIds = new Set<string>(indexed?.records.map((r) => r.environmentId) ?? []);
      const repoThreads = threads.filter((t) => {
        if (t.isArchived || t.environment === null) return false;
        if (t.environment.id !== null && envIds.has(t.environment.id)) return true;
        return (
          typeof t.environment.path === "string" &&
          normalizeFeaturePath(t.environment.path) === norm
        );
      });
      for (const t of repoThreads) {
        if (t.environment?.id) envIds.add(t.environment.id);
      }
      const bestThread =
        [...repoThreads].sort(
          (a, b) =>
            Number(a.parentThreadId !== null) - Number(b.parentThreadId !== null) ||
            b.updatedAt - a.updatedAt,
        )[0] ?? null;
      map.set(repo.directory, {
        environmentId:
          indexed?.canonicalEnvironmentId ??
          bestThread?.environment?.id ??
          [...envIds][0] ??
          null,
        threadId: bestThread?.id ?? null,
        envIds: [...envIds],
      });
    }
    return map;
  }, [repos, sharedIndex, threads]);

  const allEnvIds = useMemo(
    () => [...new Set([...rawTargets.values()].flatMap((entry) => entry.envIds))],
    [rawTargets],
  );
  const pullRequests = useWorkspacePullRequests(allEnvIds);

  const targets = useMemo(() => {
    const resolved = new Map<string, DeliveryRepoTarget>();
    for (const [directory, entry] of rawTargets) {
      const pullRequest =
        entry.envIds.map((id) => pullRequests.get(id)).find(Boolean) ?? null;
      resolved.set(directory, { ...entry, pullRequest });
    }
    return resolved;
  }, [pullRequests, rawTargets]);

  const currentThreadInRepo = (directory: string, activeThreadId: string | null): boolean => {
    if (activeThreadId === null) return false;
    const target = targets.get(directory);
    if (!target || target.envIds.length === 0) return false;
    const active = threads.find((t) => t.id === activeThreadId);
    const activeEnvId = active?.environment?.id ?? null;
    return activeEnvId !== null && target.envIds.includes(activeEnvId);
  };

  return { targets, currentThreadInRepo };
}

export { useElementWidth } from "@/hooks/use-narrow-pane";
