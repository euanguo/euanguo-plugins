/**
 * Consolidated workspace and project RPC handlers: workspace paths, repository
 * facts, worktree inspection/removal, project rename/removal, thread spawn,
 * and provider listing.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { HarborAgentActions } from "../../lib/agent/actions.ts";
import type { SidebarIndex } from "../../lib/agent/index-cache.ts";
import { NO_REPO_FACTS } from "../../lib/domain/repo-identity.ts";
import { environmentFiledUnder } from "../../lib/domain/workspace-ownership.ts";
import type {
  WorkspaceEnvironmentDescriptor,
  WorkspaceProjectDescriptor,
} from "../../lib/domain/workspace.ts";
import type {
  BatchRemoveWorktreesResult,
  BatchWorktreeSurveyItem,
  WorkspaceRemovalOutcome,
  WorktreeRemovalPlan,
  WorktreeSurvey,
} from "../../lib/domain/worktree-removal.ts";
import type { HarborRpcHandlers } from "../contract.ts";
import type { ProjectService } from "../project-service.ts";

export interface ProjectHandlerDeps {
  readonly bb: BbPluginApi;
  readonly projects: ProjectService;
  readonly harborAgentActions: HarborAgentActions;
  readonly refreshSidebarIndex: () => Promise<SidebarIndex | null>;
}

export function projectHandlers(
  deps: ProjectHandlerDeps,
): HarborRpcHandlers<
  "renameProject" | "renameEnvironment" | "removeProject" | "spawnThread" | "listProviders"
> {
  const { bb, projects, harborAgentActions, refreshSidebarIndex } = deps;

  return {
    async renameProject({ projectId, name }) {
      return { name: await projects.renameProject(projectId, name) };
    },

    async renameEnvironment({ environmentId, name }) {
      return { name: await harborAgentActions.setWorkspaceAlias(environmentId, name) };
    },

    async removeProject({ projectId, expectedName }) {
      const ok = await projects.removeProject(projectId, expectedName);
      return { ok };
    },

    async spawnThread({ request }) {
      const projectId = request.projectId;
      if (typeof projectId !== "string" || projectId.trim().length === 0) {
        throw new Error("A project is required to create a thread.");
      }
      const environment = request.environment;
      let environment2 = environment as SpawnRequest["environment"];
      if (isReuseEnvironment(environment)) {
        const index = await refreshSidebarIndex();
        const ownership = index?.repoFacts.workspaceOwnership ?? {};
        const row = ownership[environment.environmentId];
        const ownerProjectId = row?.ownerProjectId ?? null;
        if (ownerProjectId !== null && ownerProjectId !== projectId) {
          throw new Error(
            `This workspace belongs to ${ownerProjectId}, not ${projectId}. ` +
              "Choose the owning project or another workspace.",
          );
        }
        const claimedProjectId = row?.claimedProjectId ?? null;
        if (claimedProjectId !== null && claimedProjectId !== projectId) {
          const replacement = environmentFiledUnder(
            ownership,
            row?.workspaceKey ?? null,
            projectId,
          );
          if (replacement === null) {
            throw new Error(
              `bb files this workspace under another project (${claimedProjectId}), ` +
                "so a thread cannot be created here as " +
                `${projectId}. Remove the duplicate workspace, or start from ` +
                "the project's own checkout.",
            );
          }
          environment2 = { ...environment, environmentId: replacement };
        }
      }
      // Forward the composer payload while ensuring execution defaults record for `app` origin.
      const request2 = request as unknown as Parameters<
        typeof bb.sdk.threads.spawn
      >[0];
      const spawned = await bb.sdk.threads.spawn({
        ...request2,
        ...(environment2 === environment ? {} : { environment: environment2 }),
        origin: "app",
        executionInputSources: {
          providerId: "explicit",
          model: "explicit",
          reasoningLevel: "explicit",
          permissionMode: "explicit",
          ...(request2.serviceTier === undefined
            ? {}
            : { serviceTier: "explicit" as const }),
        },
      });
      return { threadId: spawned.id ?? null };
    },

    async listProviders() {
      const providers = await bb.sdk.providers.list();
      return {
        providers: providers.map(({ id, displayName, logoUrl }) => ({
          id,
          displayName,
          logoUrl,
        })),
      };
    },
  };
}

export interface WorkspaceHandlerDeps extends ProjectHandlerDeps {
  readonly readWorkspaceDescriptors: () => Promise<{
    environments: Readonly<Record<string, WorkspaceEnvironmentDescriptor>>;
    projects: Readonly<Record<string, WorkspaceProjectDescriptor>>;
    truncated: boolean;
  }>;
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
    batchSurvey: (
      environmentIds: readonly string[],
    ) => Promise<{ items: BatchWorktreeSurveyItem[] }>;
    batchRemove: (request: {
      environmentIds: readonly string[];
      deleteDirectory: boolean;
      force?: boolean;
    }) => Promise<BatchRemoveWorktreesResult>;
  };
}

export function workspaceHandlers(
  deps: WorkspaceHandlerDeps,
): HarborRpcHandlers<
  | "listWorkspacePaths"
  | "listRepoFacts"
  | "inspectWorktree"
  | "removeWorktree"
  | "batchSurveyWorktrees"
  | "batchRemoveWorktrees"
  | "renameProject"
  | "renameEnvironment"
  | "removeProject"
  | "spawnThread"
  | "listProviders"
> {
  const { readWorkspaceDescriptors, refreshSidebarIndex, removal } = deps;

  return {
    async listWorkspacePaths() {
      return readWorkspaceDescriptors();
    },

    async listRepoFacts() {
      const index = await refreshSidebarIndex();
      if (index === null) return NO_REPO_FACTS;
      return {
        ...index.repoFacts,
        ...(index.truncated ? { truncated: true } : {}),
      };
    },

    async inspectWorktree({ environmentId }) {
      return removal.inspect(environmentId);
    },

    async removeWorktree({ environmentId, deleteDirectory, acknowledged, expectedDigest }) {
      return removal.remove({
        environmentId,
        deleteDirectory,
        acknowledged,
        expectedDigest,
      });
    },

    async batchSurveyWorktrees({ environmentIds }) {
      return removal.batchSurvey(environmentIds);
    },

    async batchRemoveWorktrees({ environmentIds, deleteDirectory, force }) {
      const result = await removal.batchRemove({
        environmentIds,
        deleteDirectory,
        force,
      });
      if (result.removedCount > 0) void refreshSidebarIndex();
      return result;
    },

    ...projectHandlers(deps),
  };
}

type ReuseEnvironment = { readonly type: "reuse"; readonly environmentId: string };
type SpawnRequest = Parameters<BbPluginApi["sdk"]["threads"]["spawn"]>[0];

function isReuseEnvironment(value: unknown): value is ReuseEnvironment {
  if (typeof value !== "object" || value === null) return false;
  return (
    (value as { type?: unknown }).type === "reuse" &&
    typeof (value as { environmentId?: unknown }).environmentId === "string"
  );
}
