import { useMemo } from "react";

import { useFeatures } from "@/hooks/use-features";
import { useRepoFacts } from "@/hooks/use-repo-facts";
import { useWorkspacePaths } from "@/hooks/use-workspace-paths";
import {
  buildWorkspaceIndex,
  type WorkspaceIndex,
} from "@/lib/workspace-index";

/**
 * The workspace index, for a surface outside the sidebar tree.
 *
 * The sidebar builds its own from the same sources. A header component mounts
 * once per thread pane and has no access to that render, so it reads the same
 * three inputs and builds the same table: one derivation, two callers.
 */
export function useWorkspaceIndex(): WorkspaceIndex {
  const paths = useWorkspacePaths();
  const repoFacts = useRepoFacts();
  const { features, adoptions } = useFeatures();
  return useMemo(
    () =>
      buildWorkspaceIndex({
        environments: paths.environments,
        projects: paths.projects,
        ownership: repoFacts.workspaceOwnership,
        repos: repoFacts.repos,
        unseenWorkspaces: repoFacts.unseenWorkspaces,
        features,
        adoptions,
      }),
    [adoptions, features, paths.environments, paths.projects, repoFacts],
  );
}
