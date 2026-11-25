/**
 * Workspaces: where they are, which repository they are in, and how one goes away.
 *
 * Four calls that are one subject. The paths are a read the frontend cannot make
 * for itself (neither bb DTO carries one); the repository facts are a physical
 * probe of each machine; and the removal pair is the one operation in this
 * plugin that can destroy a directory, so it surveys twice — once to describe,
 * once to re-check what the user actually agreed to.
 */
import type { HarborRpcHandlers } from "../contract.ts";
import { worktreePlanWire } from "../contract-schemas.ts";
import type {
  WorkspaceRemovalOutcome,
  WorktreeRemovalPlan,
  WorktreeSurvey,
} from "../../lib/domain/worktree-removal.ts";
import type { SidebarIndex } from "../../lib/agent/index-cache.ts";
import type {
  WorkspaceEnvironmentDescriptor,
  WorkspaceProjectDescriptor,
} from "../../lib/domain/workspace.ts";

export interface WorkspaceHandlerDeps {
  readonly readWorkspaceDescriptors: () => Promise<{
    environments: Readonly<Record<string, WorkspaceEnvironmentDescriptor>>;
    projects: Readonly<Record<string, WorkspaceProjectDescriptor>>;
    truncated: boolean;
  }>;
  readonly refreshSidebarIndex: () => Promise<SidebarIndex | null>;
  /** The one removal implementation, shared with the agent tools. */
  readonly removal: {
    inspect: (environmentId: string) => Promise<{
      survey: WorktreeSurvey;
      plan: WorktreeRemovalPlan;
      digest: string;
    }>;
    remove: (request: {
      environmentId: string;
      deleteDirectory: boolean;
      acknowledged: boolean;
      expectedDigest: string | null;
    }) => Promise<WorkspaceRemovalOutcome>;
  };
}

export function workspaceHandlers(
  deps: WorkspaceHandlerDeps,
): HarborRpcHandlers<"listWorkspacePaths" | "listRepoFacts" | "inspectWorktree" | "removeWorktree"> {
  const { readWorkspaceDescriptors, refreshSidebarIndex, removal } = deps;

  return {
    async listWorkspacePaths() {
      return readWorkspaceDescriptors();
    },

    /**
     * The physical axis: which repository each workspace really belongs to.
     *
     * Every path bb knows about is probed on the machine that owns it, so a
     * worktree another tool created is found rather than assumed absent. The
     * project's own source is probed too, because "is this workspace in the
     * repository this project points at" is the question that separates a
     * worktree from a mistake.
     */
    async listRepoFacts() {
      // The same read that feeds the materialized index, so the map an agent
      // reads and the summary a thread is told are one answer rather than two
      // computed a second apart. It also means a sidebar load refreshes what the
      // agent callbacks will see.
      const index = await refreshSidebarIndex();
      if (index === null) {
        return {
          repos: [],
          diagnostics: [],
          repoKeyByProject: {},
          sourceRepoKeyByProject: {},
          workspaceOwnership: {},
          unseenWorkspaces: {},
          unavailableHostIds: [],
        };
      }
      return {
        ...(index.truncated ? { truncated: true } : {}),
        repos: index.repoFacts.repos,
        diagnostics: index.repoFacts.diagnostics,
        repoKeyByProject: index.repoFacts.repoKeyByProject,
        sourceRepoKeyByProject: index.repoFacts.sourceRepoKeyByProject,
        workspaceOwnership: index.repoFacts.workspaceOwnership,
        unseenWorkspaces: index.repoFacts.unseenWorkspaces,
        unavailableHostIds: [...index.repoFacts.unavailableHostIds],
      };
    },

    async inspectWorktree({ environmentId }) {
      const { survey, plan, digest } = await removal.inspect(environmentId);
      return { survey, plan: worktreePlanWire(plan), digest };
    },

    async removeWorktree({ environmentId, deleteDirectory, acknowledged, expectedDigest }) {
      return removal.remove({
        environmentId,
        deleteDirectory,
        acknowledged,
        expectedDigest,
      });
    },
  };
}
