import type { BbPluginApi } from "@get-bb/plugin-sdk";

import type { WorktreeSurvey } from "../lib/worktree-removal.ts";

export const WORKTREE_REMOVAL_TIMEOUT_MS = 120_000;

const LIVE_THREAD_STATUSES: ReadonlySet<string> = new Set([
  "starting",
  "active",
  "stopping",
]);
const OPEN_TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "running",
  "starting",
  "disconnected",
]);

type GitRemovalResult =
  | { readonly status: "removed" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "fallback"; readonly reason: string };

export function createWorkspaceService(input: {
  readonly bb: BbPluginApi;
  readonly removeViaGit: (args: {
    path: string;
    hostId: string;
    mainRepoPath: string;
  }) => Promise<GitRemovalResult>;
}) {
  const { bb, removeViaGit } = input;

  const readWorktreeStatus = async (
    environmentId: string,
    baseRef: string | null,
  ) => {
    const read = async (mergeBaseBranch: string | null) => {
      const status = await bb.sdk.environments.status({
        environmentId,
        ...(mergeBaseBranch === null ? {} : { mergeBaseBranch }),
      });
      return status.outcome === "available" ? status.workspace : null;
    };
    if (baseRef === null) return await read(null);
    try {
      return await read(baseRef);
    } catch {
      return await read(null);
    }
  };

  const surveyWorktree = async (
    environmentId: string,
  ): Promise<WorktreeSurvey> => {
    const environment = await bb.sdk.environments.get({ environmentId });
    const path = environment.path ?? "";
    const baseRef =
      environment.mergeBaseBranch ??
      environment.baseBranch ??
      (environment.defaultBranch === null
        ? null
        : `origin/${environment.defaultBranch}`);
    const status = await readWorktreeStatus(environmentId, baseRef);
    const [threads, terminals, project] = await Promise.all([
      bb.sdk.threads.list({
        environmentId,
        archived: false,
        includeHidden: true,
      }),
      bb.sdk.terminals.list({
        scope: { kind: "environment", environmentId },
      }),
      bb.sdk.projects.get({ projectId: environment.projectId }),
    ]);
    const source =
      project.sources.find((candidate) => candidate.isDefault) ??
      project.sources[0];
    const existence =
      path.length === 0
        ? {}
        : (
            await bb.sdk.hosts.pathsExist({
              hostId: environment.hostId,
              paths: [path],
            })
          ).existence;
    const files = status?.workingTree.files ?? [];

    return {
      path,
      hostId: environment.hostId,
      branch: environment.branchName,
      bbOwned: environment.managed,
      gitWorktree: environment.isWorktree,
      directoryExists: path.length > 0 && existence[path] === true,
      mainRepoPath: source?.path ?? null,
      changedFiles: files.filter((file) => file.status !== "??").length,
      untrackedFiles: files.filter((file) => file.status === "??").length,
      aheadCommits: status?.mergeBase?.aheadCount ?? 0,
      baseRef: status?.mergeBase?.mergeBaseBranch ?? null,
      threads: threads.length,
      liveThreads: threads.filter((thread) =>
        LIVE_THREAD_STATUSES.has(thread.status),
      ).length,
      openTerminals: terminals.sessions.filter((session) =>
        OPEN_TERMINAL_STATUSES.has(session.status),
      ).length,
    };
  };

  const removeWorktreeDirectory = async (args: {
    path: string;
    hostId: string;
    mainRepoPath: string | null;
  }): Promise<{ directory: "removed" | "failed"; message: string | null }> => {
    let note: string | null = null;
    try {
      if (args.mainRepoPath !== null) {
        const attempt = await removeViaGit({
          path: args.path,
          hostId: args.hostId,
          mainRepoPath: args.mainRepoPath,
        });
        if (attempt.status === "removed") {
          return { directory: "removed", message: null };
        }
        if (attempt.status === "failed") {
          return { directory: "failed", message: attempt.message };
        }
        note = attempt.reason;
      }
      await bb.sdk.files.remove({
        hostId: args.hostId,
        path: args.path,
        recursive: true,
      });
      return { directory: "removed", message: note };
    } catch (error) {
      return {
        directory: "failed",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  };

  const projectSource = async (
    projectId: string,
  ): Promise<{ path: string; hostId: string } | null> => {
    const project = await bb.sdk.projects.get({ projectId });
    const source =
      project.sources.find((candidate) => candidate.isDefault) ??
      project.sources[0];
    const path = source?.path ?? null;
    const hostId = source?.hostId ?? null;
    if (path === null || hostId === null) return null;
    return { path, hostId };
  };

  return { surveyWorktree, removeWorktreeDirectory, projectSource };
}
