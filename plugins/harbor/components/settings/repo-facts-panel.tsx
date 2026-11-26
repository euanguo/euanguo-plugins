import {
  useBbNavigate,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Pill } from "@/components/ui/pill";
import { TruncateStart } from "@/components/ui/truncate-start";
import { triggerRepoFactsRefresh } from "@/hooks/use-repo-facts";
import { triggerWorkspacePathsRefresh } from "@/hooks/use-workspace-paths";
import { errorMessage } from "@/lib/domain/errors";
import {
  normalizeRepoPath,
  type RepoFacts,
  type RepoIdentity,
  type RepoWorktree,
} from "@/lib/domain/repo-identity";
import type { WorkspacePaths } from "@/lib/domain/workspace";
import type { UnseenOwnedWorkspace } from "@/lib/domain/workspace-ownership";
import { copyWithAnnouncement } from "@/lib/ui/clipboard";
import { cn, formatHomePathForDisplay } from "@/lib/ui/utils";
import type { harborRpcContract } from "@/server/contract";

export interface RepoFactsPanelProps {
  facts: RepoFacts;
  paths: WorkspacePaths;
  projects: readonly { id: string; name: string }[];
}

interface ActivationFeedback {
  readonly path: string;
  readonly branch: string | null;
  readonly threadId: string | null;
}

const STALE_WORKTREE_MS = 14 * 24 * 60 * 60 * 1000;

function formatTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function resolveUnseenTarget(
  repo: RepoIdentity,
  worktree: RepoWorktree,
  unseenByPath: ReadonlyMap<string, UnseenOwnedWorkspace>,
): { hostId: string; projectId: string } | null {
  const key = normalizeRepoPath(worktree.path) ?? worktree.path;
  const matched = unseenByPath.get(key);
  const hostId =
    matched?.hostId ??
    worktree.hostId ??
    (repo.hostIds.length === 1 ? repo.hostIds[0] : undefined);
  const projectId =
    matched?.projectId ??
    (repo.projectIds.length === 1 ? repo.projectIds[0] : undefined);

  if (
    hostId === undefined ||
    hostId === null ||
    hostId.length === 0 ||
    projectId === undefined ||
    projectId === null ||
    projectId.length === 0
  ) {
    return null;
  }
  return { hostId, projectId };
}

export function RepoFactsPanel({
  facts,
  paths,
  projects,
}: RepoFactsPanelProps) {
  const rpc = useRpc<typeof harborRpcContract>();
  const navigate = useBbNavigate();

  const [manualFacts, setManualFacts] = useState<RepoFacts | null>(null);
  const [manualPaths, setManualPaths] = useState<WorkspacePaths | null>(null);
  const [truncatedNotice, setTruncatedNotice] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);

  const [activatingPath, setActivatingPath] = useState<string | null>(null);
  const [activationFeedback, setActivationFeedback] =
    useState<ActivationFeedback | null>(null);
  const [activationError, setActivationError] = useState<string | null>(null);
  const [copiedPrune, setCopiedPrune] = useState(false);

  const effectiveFacts = manualFacts ?? facts;
  const effectivePaths = manualPaths ?? paths;

  const projectNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const project of projects) {
      map.set(project.id, project.name);
    }
    return map;
  }, [projects]);

  const unseenByPath = useMemo(() => {
    const map = new Map<string, UnseenOwnedWorkspace>();
    for (const items of Object.values(effectiveFacts.unseenWorkspaces)) {
      for (const item of items) {
        const normalized = normalizeRepoPath(item.path) ?? item.path;
        map.set(normalized, item);
      }
    }
    return map;
  }, [effectiveFacts.unseenWorkspaces]);

  const ownershipConflicts = useMemo(
    () =>
      Object.values(effectiveFacts.workspaceOwnership).filter(
        (entry) => entry.conflict,
      ),
    [effectiveFacts.workspaceOwnership],
  );

  const maintenanceSummary = useMemo(() => {
    const danglingEnvs = [];
    const staleWorktrees = [];
    const now = Date.now();
    for (const env of Object.values(effectivePaths.environments)) {
      if (env.dangling === true) {
        danglingEnvs.push(env);
      } else if (
        env.isWorktree &&
        env.updatedAt !== null &&
        env.updatedAt !== undefined &&
        now - env.updatedAt > STALE_WORKTREE_MS
      ) {
        staleWorktrees.push(env);
      }
    }
    let prunableCount = 0;
    let unseenCount = 0;
    for (const repo of effectiveFacts.repos) {
      for (const wt of repo.unseenWorktrees) {
        unseenCount += 1;
        if (wt.prunable) prunableCount += 1;
      }
    }
    return {
      danglingEnvs,
      staleWorktrees,
      prunableCount,
      unseenCount,
    };
  }, [effectivePaths.environments, effectiveFacts.repos]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setRefreshError(null);
    try {
      const [nextFacts, nextPaths] = await Promise.all([
        rpc.call("listRepoFacts", {}),
        rpc.call("listWorkspacePaths", {}),
      ]);
      setManualFacts(nextFacts);
      setManualPaths(nextPaths);
      setTruncatedNotice(
        Boolean(nextFacts.truncated) || Boolean(nextPaths.truncated),
      );
      setLastRefreshedAt(Date.now());
      triggerRepoFactsRefresh();
      triggerWorkspacePathsRefresh();
    } catch (err) {
      setRefreshError(errorMessage(err, "Failed to refresh workspace diagnostics"));
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleActivateWorktree = async (
    worktree: RepoWorktree,
    target: { hostId: string; projectId: string },
  ) => {
    setActivatingPath(worktree.path);
    setActivationError(null);
    setActivationFeedback(null);
    try {
      const result = await rpc.call("activateOrphanWorktree", {
        hostId: target.hostId,
        projectId: target.projectId,
        path: worktree.path,
        branch: worktree.branch,
      });
      setActivationFeedback({
        path: worktree.path,
        branch: worktree.branch,
        threadId: result.threadId,
      });
      await handleRefresh();
    } catch (err) {
      setActivationError(
        errorMessage(err, "Failed to register worktree in Harbor"),
      );
    } finally {
      setActivatingPath(null);
    }
  };

  const handleCopyPrune = async () => {
    const ok = await copyWithAnnouncement(
      "git worktree prune",
      "Worktree prune command",
    );
    if (ok) {
      setCopiedPrune(true);
      setTimeout(() => setCopiedPrune(false), 1800);
    }
  };

  const refreshHeader = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Diagnostics & Maintenance
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Reconciles disk Git worktrees against bb project and environment
          records.
        </p>
      </div>
      <div className="flex items-center gap-2">
        {lastRefreshedAt !== null ? (
          <span className="font-mono text-[11px] text-muted-foreground">
            Checked {formatTime(lastRefreshedAt)}
          </span>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isRefreshing}
          onClick={() => void handleRefresh()}
          className="h-7 text-xs"
        >
          <Icon
            name="FolderSync"
            className={cn("mr-1.5 size-3.5", isRefreshing && "animate-spin")}
            aria-hidden
          />
          {isRefreshing ? "Refreshing..." : "Refresh"}
        </Button>
      </div>
    </div>
  );

  const errorBanner =
    refreshError !== null ? (
      <p
        role="alert"
        className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
      >
        {refreshError}
      </p>
    ) : null;

  if (
    effectiveFacts.repos.length === 0 &&
    effectiveFacts.diagnostics.length === 0 &&
    effectiveFacts.unavailableHostIds.length === 0
  ) {
    return (
      <div className="space-y-4">
        {refreshHeader}
        {errorBanner}
        <div className="rounded-lg border border-dashed border-border/70 px-4 py-6 text-center">
          <p className="text-xs font-medium text-foreground">
            No repositories probed yet
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Run a refresh to scan connected hosts and verify repository
            worktrees.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {refreshHeader}
        {errorBanner}
        {truncatedNotice ? (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-300">
            Workspace scan hit the host cap; some distant environments were
            omitted.
          </p>
        ) : null}
        {effectiveFacts.unavailableHostIds.length > 0 ? (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            <Icon
              name="AlertTriangle"
              className="mt-0.5 size-3.5 shrink-0"
              aria-hidden
            />
            <div>
              <span className="font-medium">Unreachable host(s): </span>
              <span className="font-mono">
                {effectiveFacts.unavailableHostIds.join(", ")}
              </span>
              <span className="block text-[11px] opacity-90">
                Workspaces on offline machines are shown unverified until those
                hosts reconnect.
              </span>
            </div>
          </div>
        ) : null}
      </div>

      {activationFeedback !== null ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
          <div className="min-w-0">
            <span>
              Activated{" "}
              <code className="font-mono">
                {activationFeedback.branch ??
                  formatHomePathForDisplay(activationFeedback.path)}
              </code>
              .
            </span>
          </div>
          {activationFeedback.threadId !== null ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 text-[11px]"
              onClick={() => {
                const threadId = activationFeedback.threadId;
                if (threadId !== null) navigate.toThread(threadId);
              }}
            >
              Open thread
            </Button>
          ) : null}
        </div>
      ) : null}

      {activationError !== null ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {activationError}
        </p>
      ) : null}

      {effectiveFacts.diagnostics.length > 0 ||
      ownershipConflicts.length > 0 ? (
        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Warnings & Ownership Conflicts
          </h4>
          <div className="divide-y divide-border/40 rounded-lg border border-border/60">
            {effectiveFacts.diagnostics.map((diag, idx) => (
              <div
                key={`${diag.repoKey}-${diag.code}-${idx}`}
                className="flex flex-col gap-1 px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2">
                  <Pill variant="outline" size="sm">
                    {diag.code}
                  </Pill>
                  <span className="truncate font-mono text-[11px] text-muted-foreground">
                    {diag.repoKey}
                  </span>
                </div>
                <p className="text-xs text-foreground">{diag.message}</p>
              </div>
            ))}

            {ownershipConflicts.map((conflict) => {
              const env = effectivePaths.environments[conflict.environmentId];
              const claimed =
                projectNames.get(conflict.claimedProjectId) ??
                conflict.claimedProjectId;
              const owner =
                conflict.ownerProjectId !== null
                  ? (projectNames.get(conflict.ownerProjectId) ??
                    conflict.ownerProjectId)
                  : "Unknown";
              return (
                <div
                  key={conflict.environmentId}
                  className="flex flex-col gap-1 px-3 py-2 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <Pill variant="destructive" size="sm">
                      ownership-conflict
                    </Pill>
                    <span className="text-[11px] text-muted-foreground">
                      claimed by <strong>{claimed}</strong>, repo points to{" "}
                      <strong>{owner}</strong> ({conflict.confidence})
                    </span>
                  </div>
                  {env?.path !== null && env?.path !== undefined ? (
                    <TruncateStart className="font-mono text-[11px] text-muted-foreground">
                      {formatHomePathForDisplay(env.path)}
                    </TruncateStart>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Repositories ({effectiveFacts.repos.length})
          </h4>
          <div className="flex flex-wrap items-center gap-1.5">
            {maintenanceSummary.unseenCount > 0 ? (
              <Pill variant="emphasis" size="sm">
                {maintenanceSummary.unseenCount} unregistered worktree(s)
              </Pill>
            ) : null}
            {maintenanceSummary.danglingEnvs.length > 0 ? (
              <Pill variant="destructive" size="sm">
                {maintenanceSummary.danglingEnvs.length} missing on disk
              </Pill>
            ) : null}
          </div>
        </div>

        <div className="divide-y divide-border/50 rounded-lg border border-border/60">
          {effectiveFacts.repos.map((repo) => {
            const linkedProjects = repo.projectIds
              .map((id) => projectNames.get(id) ?? id)
              .join(", ");

            return (
              <div key={repo.key} className="space-y-2 px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon
                      name="FolderGit"
                      className="size-3.5 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    <span className="truncate text-xs font-semibold text-foreground">
                      {repo.name}
                    </span>
                    <Pill variant="secondary" size="sm">
                      {repo.kind}
                    </Pill>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span>{repo.workspaces.length} tracked</span>
                    {repo.unseenWorktrees.length > 0 ? (
                      <span>· {repo.unseenWorktrees.length} unseen</span>
                    ) : null}
                    {linkedProjects.length > 0 ? (
                      <span>· {linkedProjects}</span>
                    ) : null}
                  </div>
                </div>

                {repo.rootPath !== null ? (
                  <TruncateStart
                    title={repo.rootPath}
                    className="font-mono text-[11px] text-muted-foreground"
                  >
                    {formatHomePathForDisplay(repo.rootPath)}
                  </TruncateStart>
                ) : null}

                {repo.unseenWorktrees.length > 0 ? (
                  <div className="space-y-1.5 rounded-md bg-muted/30 p-2">
                    <div className="text-[11px] font-medium text-muted-foreground">
                      Unregistered Git worktrees on disk
                    </div>
                    {repo.unseenWorktrees.map((wt) => {
                      const target = resolveUnseenTarget(repo, wt, unseenByPath);
                      const isActivating = activatingPath === wt.path;
                      return (
                        <div
                          key={wt.path}
                          className="flex flex-wrap items-center justify-between gap-2 text-xs"
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <Icon
                              name="GitBranch"
                              className="size-3 shrink-0 text-muted-foreground"
                              aria-hidden
                            />
                            <span className="shrink-0 font-mono text-[11px] text-foreground">
                              {wt.branch ?? (wt.detached ? "detached" : "HEAD")}
                            </span>
                            <TruncateStart
                              title={wt.path}
                              className="font-mono text-[11px] text-muted-foreground"
                            >
                              {formatHomePathForDisplay(wt.path)}
                            </TruncateStart>
                          </div>
                          {wt.prunable ? (
                            <Pill variant="outline" size="sm">
                              Prunable
                            </Pill>
                          ) : target !== null ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={isActivating || activatingPath !== null}
                              onClick={() =>
                                void handleActivateWorktree(wt, target)
                              }
                              className="h-6 px-2 text-[11px]"
                            >
                              <Icon name="Plus" className="mr-1 size-2.5" aria-hidden />
                              {isActivating ? "Activating..." : "Activate"}
                            </Button>
                          ) : (
                            <Pill variant="secondary" size="sm">
                              No single owner
                            </Pill>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                {repo.diagnostics.length > 0 ? (
                  <div className="space-y-1">
                    {repo.diagnostics.map((diag, idx) => (
                      <div
                        key={`${diag.code}-${idx}`}
                        className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-300"
                      >
                        <Icon
                          name="AlertTriangle"
                          className="mt-0.5 size-3 shrink-0"
                          aria-hidden
                        />
                        <span>
                          <strong className="font-mono">{diag.code}:</strong>{" "}
                          {diag.message}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      {maintenanceSummary.danglingEnvs.length > 0 ||
      maintenanceSummary.staleWorktrees.length > 0 ||
      maintenanceSummary.prunableCount > 0 ? (
        <section className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-xs font-semibold text-foreground">
                Worktree Maintenance Hints
              </h4>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {maintenanceSummary.prunableCount > 0
                  ? `${maintenanceSummary.prunableCount} prunable Git worktree reference(s) recorded in git metadata.`
                  : "Clean up missing or idle worktrees to keep your workspace list fast."}
              </p>
            </div>
            {maintenanceSummary.prunableCount > 0 ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void handleCopyPrune()}
                className="h-7 font-mono text-[11px]"
              >
                {copiedPrune ? (
                  <>
                    <Icon name="Check" className="mr-1 size-3" aria-hidden />
                    Copied command
                  </>
                ) : (
                  <>
                    <Icon name="Copy" className="mr-1 size-3" aria-hidden />
                    git worktree prune
                  </>
                )}
              </Button>
            ) : null}
          </div>

          {maintenanceSummary.danglingEnvs.length > 0 ? (
            <div className="space-y-1 pt-1">
              <div className="text-[11px] font-medium text-muted-foreground">
                Environments missing on disk (
                {maintenanceSummary.danglingEnvs.length})
              </div>
              {maintenanceSummary.danglingEnvs.slice(0, 6).map((env) => (
                <div
                  key={env.id}
                  className="flex items-center gap-2 text-[11px] text-muted-foreground"
                >
                  <Pill variant="destructive" size="sm">
                    Missing
                  </Pill>
                  <span className="truncate font-mono">
                    {env.path !== null
                      ? formatHomePathForDisplay(env.path)
                      : env.id}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {maintenanceSummary.staleWorktrees.length > 0 ? (
            <div className="text-[11px] text-muted-foreground">
              {maintenanceSummary.staleWorktrees.length} inactive worktree(s)
              untouched for over 14 days.
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
