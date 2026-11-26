import {
  experimental_useAppPanel as useAppPanel,
  useBbContext,
  useBbNavigate,
  experimental_usePanelTabs as usePanelTabs,
} from "@get-bb/plugin-sdk/app";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { NEW_CHAT_PANEL_PATH } from "@/app/new-chat/route";
import { DeliveryMatrixPreview } from "@/components/feature-hub/delivery-matrix-preview";
import { DeliveryMatrixRow } from "@/components/feature-hub/delivery-matrix-row";
import {
  useDeliveryRepoTargets,
  useElementWidth,
} from "@/components/feature-hub/use-delivery-targets";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useFeatureCockpitMutations } from "@/hooks/use-feature-cockpit";
import {
  buildCrossRepoGitStatusCommand,
  summarizeDeliveryMatrix,
  type FeatureGitSummary,
  type FeatureRepoGitStatus,
} from "@/lib/domain/feature-git";
import { findDiffTabKey } from "@/lib/domain/workspace-tabs";
import { copyWithAnnouncement } from "@/lib/ui/clipboard";

const EMPTY_REPOS: readonly FeatureRepoGitStatus[] = [];

export function FeatureHubChanges({
  featureId,
  gitSummary,
  loadingStatus,
  active = true,
  onRefreshStatus,
  requestedDirectory,
  onOpenRepos,
  onClose,
}: {
  readonly featureId: string;
  readonly gitSummary: FeatureGitSummary | null;
  readonly loadingStatus: boolean;
  readonly active?: boolean;
  readonly onRefreshStatus: () => void;
  readonly requestedDirectory?: { readonly directory: string; readonly seq: number } | string;
  readonly onOpenRepos?: (directory: string) => void;
  readonly onClose?: () => void;
}) {
  const repos = gitSummary?.repos ?? EMPTY_REPOS;
  const [selectedDir, setSelectedDir] = useState<string | null>(null);
  const [batchPushing, setBatchPushing] = useState(false);
  const { ref: containerRef, width: containerWidth } = useElementWidth();
  const lastRequestedKeyRef = useRef<string | undefined>(undefined);

  const mutations = useFeatureCockpitMutations();
  const navigate = useBbNavigate();
  const bbContext = useBbContext();
  const panel = useAppPanel();
  const panelTabs = usePanelTabs();
  const diffTabKey = findDiffTabKey(panelTabs.tabs);
  const { targets, currentThreadInRepo } = useDeliveryRepoTargets(repos);

  const reqDir =
    typeof requestedDirectory === "string" ? requestedDirectory : requestedDirectory?.directory;
  const reqKey =
    typeof requestedDirectory === "string"
      ? requestedDirectory
      : requestedDirectory
        ? `${requestedDirectory.directory}#${requestedDirectory.seq}`
        : undefined;

  useEffect(() => {
    if (reqDir && reqKey && reqKey !== lastRequestedKeyRef.current && repos.some((r) => r.directory === reqDir)) {
      lastRequestedKeyRef.current = reqKey;
      setSelectedDir(reqDir);
    } else if (selectedDir !== null && !repos.some((r) => r.directory === selectedDir)) {
      setSelectedDir(null);
    }
  }, [repos, reqDir, reqKey, selectedDir]);

  if (repos.length === 0) {
    return (
      <div className="p-4 text-xs text-muted-foreground">
        {loadingStatus
          ? "Inspecting repository delivery status…"
          : "No repositories attached yet. Switch to Repos to add one."}
      </div>
    );
  }

  const summary = gitSummary ? summarizeDeliveryMatrix(gitSummary) : null;
  const inspectedRepo = repos.find((r) => r.directory === selectedDir) ?? null;

  const handleOpenDiffAndCommit = (repo: FeatureRepoGitStatus) => {
    const target = targets.get(repo.directory);
    if (currentThreadInRepo(repo.directory, bbContext.threadId) && diffTabKey !== null) {
      panel.selectTab(diffTabKey);
      onClose?.();
      return;
    }
    if (target?.threadId) {
      navigate.toThread(target.threadId);
      onClose?.();
      return;
    }
    if (target?.environmentId) {
      navigate.toPluginPanel(NEW_CHAT_PANEL_PATH, { subPath: target.environmentId });
      onClose?.();
      return;
    }
    if (onOpenRepos) onOpenRepos(repo.directory);
    else toast.info(`Open a thread in ${repo.directory} to inspect BB native Git Changes.`);
  };

  const handlePushRepo = (directory: string) => {
    void mutations.pushRepo
      .mutate({ featureId, directory })
      .then(() => {
        toast.success(`Pushed ${directory}.`);
        onRefreshStatus();
      })
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : `Push failed for ${directory}.`),
      );
  };

  const handlePushAllClean = async () => {
    if (summary === null || summary.cleanAheadRepos.length === 0 || batchPushing) return;
    setBatchPushing(true);
    let ok = 0;
    const failures: string[] = [];
    try {
      for (const repo of summary.cleanAheadRepos) {
        try {
          await mutations.pushRepo.mutate({ featureId, directory: repo.directory });
          ok += 1;
        } catch (err: unknown) {
          failures.push(`${repo.directory}: ${err instanceof Error ? err.message : "failed"}`);
        }
      }
      if (ok > 0) toast.success(`Pushed ${ok} clean ${ok === 1 ? "repository" : "repositories"}.`);
      if (failures.length > 0) toast.error(failures.join("; "));
      onRefreshStatus();
    } finally {
      setBatchPushing(false);
    }
  };

  const statusCmd = buildCrossRepoGitStatusCommand(repos);

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 flex-col text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5 text-2xs text-muted-foreground">
          <span className="font-medium text-foreground">{summary?.writableRepoCount ?? 0} writable</span>
          <span>·</span>
          <span className={summary && summary.dirtyRepoCount > 0 ? "harbor-text-warning font-medium" : undefined}>
            {summary?.dirtyRepoCount ?? 0} dirty
          </span>
          <span>·</span>
          <span className={summary && summary.unpushedRepoCount > 0 ? "harbor-text-info font-medium" : undefined}>
            {summary?.unpushedRepoCount ?? 0} ahead
          </span>
          {summary && summary.refRepoCount > 0 ? <><span>·</span><span>{summary.refRepoCount} ref</span></> : null}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {statusCmd.length > 0 ? (
            <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-2xs" onClick={() => void copyWithAnnouncement(statusCmd, "git -C status commands")}>
              <Icon name="Copy" className="mr-1 size-3" aria-hidden />
              Copy git status
            </Button>
          ) : null}
          {summary && summary.cleanAheadRepos.length > 0 ? (
            <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-2xs" disabled={batchPushing || mutations.pushRepo.isPending} onClick={() => void handlePushAllClean()}>
              {batchPushing ? "Pushing…" : `Push clean (${summary.cleanAheadRepos.length})`}
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="sm" aria-label="Refresh delivery matrix" className="h-6 px-2 text-2xs" onClick={onRefreshStatus}>
            <Icon name="FolderSync" className="mr-1 size-3" aria-hidden />
            Refresh
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-2xs">
          <thead>
            <tr className="border-b border-border/80 bg-muted/20 text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-1.5 font-medium">Repo</th>
              <th className="px-2 py-1.5 font-medium">Branch</th>
              <th className="px-2 py-1.5 font-medium">Working Tree</th>
              <th className="px-2 py-1.5 font-medium">Sync</th>
              <th className="px-2 py-1.5 font-medium">PR</th>
              <th className="px-3 py-1.5 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {repos.map((repo) => (
              <DeliveryMatrixRow
                key={repo.directory}
                repo={repo}
                pullRequest={targets.get(repo.directory)?.pullRequest ?? null}
                isSelected={selectedDir === repo.directory}
                pushing={mutations.pushRepo.isPending || batchPushing}
                onToggleInspect={() => setSelectedDir(selectedDir === repo.directory ? null : repo.directory)}
                onPush={() => handlePushRepo(repo.directory)}
                onOpenDiffAndCommit={() => handleOpenDiffAndCommit(repo)}
                onOpenPr={(url) => navigate.openUrl(url)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {inspectedRepo ? (
        <DeliveryMatrixPreview
          featureId={featureId}
          repo={inspectedRepo}
          active={active}
          canSplit={containerWidth >= 600}
          onOpenNativeDiff={() => handleOpenDiffAndCommit(inspectedRepo)}
          onClosePreview={() => setSelectedDir(null)}
        />
      ) : null}
    </div>
  );
}
