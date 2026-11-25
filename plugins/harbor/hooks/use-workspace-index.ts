// Local modules are imported relatively rather than through `@/` so the test
// that pins the light derivation can load this module: `node --test` resolves
// only relative specifiers, never the TypeScript path alias.
import { useMemo } from "react";
import {
  experimental_useSidebarThreads as useSidebarThreads,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";

import {
  buildWorkspaceIndex,
  type PartialWorkspaceIndex,
  type WorkspaceIndex,
} from "../lib/domain/workspace-index.ts";
import { useSharedWorkspaceIndex } from "../lib/ui/workspace-index-store.ts";
import type { WorkspaceEnvironmentDescriptor } from "../lib/domain/workspace.ts";

const EMPTY_WORKSPACE_INDEX: PartialWorkspaceIndex = buildWorkspaceIndex({
  environments: {},
  projects: {},
});

/**
 * The workspace index a surface can build from the threads it already holds.
 *
 * bb puts no workspace paths, repository facts, or features on a thread row, so
 * this is the light derivation: every environment comes from the thread's own
 * `environment` record. Identity is still the physical key, so a workspace
 * derived here and the same one derived from the full read answer to the same
 * key, which is what lets the two paths stand in for each other.
 */
export function workspaceIndexFromThreads(
  threads: readonly PluginSidebarThread[],
): WorkspaceIndex {
  const environments: Record<string, WorkspaceEnvironmentDescriptor> = {};
  for (const thread of threads) {
    const environment = thread.environment;
    if (environment === null || environment.id === null) continue;
    const hostId = thread.host?.id;
    if (hostId === undefined) continue;
    // Every thread in one environment agrees about it; the first row is enough.
    if (environments[environment.id] !== undefined) continue;
    environments[environment.id] = {
      id: environment.id,
      projectId: thread.projectId,
      hostId,
      path: environment.path,
      // A thread row carries no `isGitRepo`. A path is the only evidence of a
      // checkout it has, and classification is presentation metadata: the key
      // is the path either way.
      isGitRepo: environment.path !== null,
      isWorktree: environment.isWorktree === true,
      branchName: environment.branchName,
      name: environment.name,
      providerId: environment.providerId,
      workspaceDisplayKind: environment.workspaceDisplayKind,
    };
  }
  return buildWorkspaceIndex({ environments, projects: {} });
}

/**
 * The workspace index, for a surface outside the sidebar tree.
 *
 * The sidebar builds the authoritative one and publishes it. When it is not
 * mounted — bb's own thread list chosen — a header still needs the workspace of
 * the pane it is drawing, and the threads this client already holds are enough
 * to derive it. Neither path reads the three RPCs per pane.
 *
 * The answer is typed as {@link PartialWorkspaceIndex}: a derivation from
 * threads can promise `environmentId -> key` and `workspaceOfThread`, but not
 * ownership, repository, or feature facts. A caller that needs neighbours or a
 * feature name must read the shared full index; it must not pretend this one
 * always carries them.
 */
export function useWorkspaceIndex(): PartialWorkspaceIndex {
  const shared = useSharedWorkspaceIndex();
  const { threads } = useSidebarThreads();
  const derived = useMemo(
    () => (shared === null ? workspaceIndexFromThreads(threads) : null),
    [shared, threads],
  );
  return shared ?? derived ?? EMPTY_WORKSPACE_INDEX;
}
