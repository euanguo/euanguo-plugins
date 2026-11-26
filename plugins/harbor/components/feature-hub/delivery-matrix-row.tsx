import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  canPushFeatureRepo,
  deliveryRepoReadiness,
  type FeatureRepoGitStatus,
} from "@/lib/domain/feature-git";
import type { WorkspacePullRequest } from "@/lib/domain/pull-request";
import { pullRequestPresentation } from "@/lib/domain/pull-request-presentation";
import { cn } from "@/lib/ui/utils";

export function DeliveryMatrixRow({
  repo,
  pullRequest,
  isSelected,
  pushing,
  onToggleInspect,
  onPush,
  onOpenDiffAndCommit,
  onOpenPr,
}: {
  readonly repo: FeatureRepoGitStatus;
  readonly pullRequest: WorkspacePullRequest | null;
  readonly isSelected: boolean;
  readonly pushing: boolean;
  readonly onToggleInspect: () => void;
  readonly onPush: () => void;
  readonly onOpenDiffAndCommit: () => void;
  readonly onOpenPr: (url: string) => void;
}) {
  const prView = pullRequest ? pullRequestPresentation(pullRequest) : null;
  const readiness = deliveryRepoReadiness(repo);
  const counts = [
    repo.stagedFiles > 0 ? `${repo.stagedFiles}S` : null,
    repo.unstagedFiles > 0 ? `${repo.unstagedFiles}U` : null,
    repo.untrackedFiles > 0 ? `${repo.untrackedFiles}?` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <tr
      className={cn(
        "border-b border-border/60 transition-colors last:border-b-0",
        isSelected ? "bg-accent/35" : "hover:bg-muted/25",
      )}
    >
      <td className="px-3 py-2 align-middle">
        <button
          type="button"
          onClick={onToggleInspect}
          className="flex items-center gap-1.5 text-left font-medium text-foreground hover:underline"
        >
          <Icon
            name={repo.role === "ref" ? "Link" : "FolderGit"}
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <span className="truncate">{repo.directory}</span>
          <span className="rounded bg-muted px-1 py-0.5 text-[10px] font-normal text-muted-foreground">
            {repo.role === "ref" ? "Ref" : repo.role === "submodule" ? "Sub" : "WT"}
          </span>
        </button>
      </td>
      <td className="px-2 py-2 align-middle font-mono text-[11px] text-foreground/90">
        <div className="max-w-[14rem] truncate" title={repo.branch ?? "detached"}>
          {repo.branch ?? "detached"}
        </div>
        {repo.upstream ? (
          <div className="max-w-[14rem] truncate text-[10px] text-muted-foreground">
            → {repo.upstream}
          </div>
        ) : null}
      </td>
      <td className="px-2 py-2 align-middle tabular-nums">
        {readiness === "missing" ? (
          <span className="text-destructive">Missing</span>
        ) : readiness === "error" ? (
          <span className="text-destructive" title={repo.statusError ?? undefined}>
            Error
          </span>
        ) : repo.clean ? (
          <span className="harbor-text-success">Clean</span>
        ) : (
          <div className="flex flex-col">
            <span>
              <span className="harbor-text-success">+{repo.additions}</span>{" "}
              <span className="text-destructive">-{repo.deletions}</span>
            </span>
            {counts ? (
              <span className="font-mono text-[10px] text-muted-foreground">
                {counts}
              </span>
            ) : null}
          </div>
        )}
      </td>
      <td className="px-2 py-2 align-middle tabular-nums text-muted-foreground">
        {repo.role === "ref" ? (
          "—"
        ) : (repo.aheadCommits ?? 0) > 0 || (repo.behindCommits ?? 0) > 0 ? (
          <span className="font-mono">
            {(repo.aheadCommits ?? 0) > 0 ? `↑${repo.aheadCommits} ` : ""}
            {(repo.behindCommits ?? 0) > 0 ? `↓${repo.behindCommits}` : ""}
          </span>
        ) : repo.upstream ? (
          "Synced"
        ) : (
          "Local"
        )}
      </td>
      <td className="px-2 py-2 align-middle">
        {pullRequest && prView ? (
          <button
            type="button"
            onClick={() => onOpenPr(pullRequest.url)}
            title={pullRequest.title}
            className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-foreground hover:bg-accent"
          >
            <span className="font-mono">#{pullRequest.number}</span>
            <span>{prView.label}</span>
          </button>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-right align-middle">
        <div className="inline-flex items-center justify-end gap-1">
          {canPushFeatureRepo(repo) ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 px-2 text-2xs"
              disabled={pushing}
              onClick={onPush}
            >
              Push
            </Button>
          ) : null}
          {repo.role !== "ref" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 px-2 text-2xs"
              onClick={onOpenDiffAndCommit}
            >
              Open Diff &amp; Commit
            </Button>
          ) : null}
          <Button
            type="button"
            variant={isSelected ? "secondary" : "ghost"}
            size="sm"
            className="h-6 px-2 text-2xs"
            onClick={onToggleInspect}
          >
            {isSelected ? "Hide" : "Inspect"}
          </Button>
        </div>
      </td>
    </tr>
  );
}
