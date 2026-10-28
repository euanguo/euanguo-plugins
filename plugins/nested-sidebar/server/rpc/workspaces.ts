/**
 * Workspaces: where they are, which repository they are in, and how one goes away.
 *
 * Four calls that are one subject. The paths are a read the frontend cannot make
 * for itself (neither bb DTO carries one); the repository facts are a physical
 * probe of each machine; and the removal pair is the one operation in this
 * plugin that can destroy a directory, so it surveys twice — once to describe,
 * once to re-check what the user actually agreed to.
 */
import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import type { nestRpcContract } from "../contract.ts";
import { worktreePlanWire } from "../contract.ts";

/** This module's slice of the contract, with every other method omitted. */
type Handlers<Method extends keyof typeof nestRpcContract> = Pick<
  PluginRpcHandlers<typeof nestRpcContract>,
  Method
>;
import type { planWorktreeRemoval, removalSubmissionBlocker, WorktreeSurvey } from "../../lib/worktree-removal.ts";
import type { SidebarIndex } from "../../lib/agent/index-cache.ts";
import type {
  WorkspaceEnvironmentDescriptor,
  WorkspaceProjectDescriptor,
} from "../../lib/workspace.ts";

export interface WorkspaceHandlerDeps {
  readonly bb: BbPluginApi;
  readonly readWorkspaceDescriptors: () => Promise<{
    environments: Readonly<Record<string, WorkspaceEnvironmentDescriptor>>;
    projects: Readonly<Record<string, WorkspaceProjectDescriptor>>;
  }>;
  readonly refreshSidebarIndex: () => Promise<SidebarIndex | null>;
  readonly repoFacts: { read(targets: readonly unknown[]): Promise<unknown>; invalidate(): void };
  readonly surveyWorktree: (environmentId: string) => Promise<WorktreeSurvey>;
  readonly removeWorktreeDirectory: (args: {
    path: string;
    hostId: string;
    mainRepoPath: string | null;
  }) => Promise<{ directory: "removed" | "failed"; message: string | null }>;
  readonly planWorktreeRemoval: typeof planWorktreeRemoval;
  readonly removalSubmissionBlocker: typeof removalSubmissionBlocker;
}

export function workspaceHandlers(
  deps: WorkspaceHandlerDeps,
): Handlers<"listWorkspacePaths" | "listRepoFacts" | "inspectWorktree" | "removeWorktree"> {
  const {
    bb,
    readWorkspaceDescriptors,
    refreshSidebarIndex,
    repoFacts,
    surveyWorktree,
    removeWorktreeDirectory,
    planWorktreeRemoval,
    removalSubmissionBlocker,
  } = deps;

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
      const survey = await surveyWorktree(environmentId);
      return { survey, plan: worktreePlanWire(planWorktreeRemoval(survey)) };
    },

    async removeWorktree({ environmentId, deleteDirectory, acknowledged }) {
      // Survey again rather than trusting the dialog's copy: the workspace can
      // have changed since it was opened, and the acknowledgements the client
      // sends are only meaningful against what bb can see now.
      const survey = await surveyWorktree(environmentId);
      const plan = planWorktreeRemoval(survey);
      const blocker = removalSubmissionBlocker(plan, {
        deleteDirectory,
        acknowledged,
      });
      if (blocker !== null) {
        return {
          ok: false,
          blocker,
          archivedThreads: false,
          environmentRemoved: false,
          directory: "kept" as const,
          message: null,
        };
      }

      // The reversible half first, and in this order: archiving is what lets bb
      // release the environment, and an environment bb refuses to release must
      // stop the whole thing before anything on disk is touched.
      await bb.sdk.environments.archiveThreads({ environmentId });

      let environmentRemoved = false;
      try {
        await bb.sdk.environments.delete({ environmentId });
        environmentRemoved = true;
        // The workspace list changed, and the repository's own record may have
        // too. What is held about this machine is a picture of the state before
        // the change, so it goes; the sidebar re-reads on its own, because the
        // environments it is holding just changed shape.
        repoFacts.invalidate();
      } catch (error) {
        return {
          ok: false,
          blocker: null,
          archivedThreads: true,
          environmentRemoved: false,
          directory: "kept" as const,
          message: error instanceof Error ? error.message : String(error),
        };
      }

      if (!deleteDirectory) {
        return {
          ok: true,
          blocker: null,
          archivedThreads: true,
          environmentRemoved,
          directory: "kept" as const,
          message: null,
        };
      }

      const removal = await removeWorktreeDirectory({
        path: survey.path,
        hostId: survey.hostId,
        mainRepoPath: plan.directory.via === "git" ? survey.mainRepoPath : null,
      });
      return {
        ok: true,
        blocker: null,
        archivedThreads: true,
        environmentRemoved,
        directory: removal.directory,
        message: removal.message,
      };
    },
  };
}
