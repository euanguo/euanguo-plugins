import { experimental_Diff as BbDiff } from "@get-bb/plugin-sdk/app";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useFeatureRepoDiff } from "@/hooks/use-feature-cockpit";
import {
  classifyDiffPatch,
  type DiffFileEntry,
  type FeatureRepoGitStatus,
} from "@/lib/domain/feature-git";
import { cn } from "@/lib/ui/utils";

const EMPTY_FILES: readonly DiffFileEntry[] = [];

const STATUS_BADGE: Record<string, { label: string; tone: string }> = {
  modified: { label: "M", tone: "harbor-text-warning" },
  added: { label: "A", tone: "harbor-text-success" },
  deleted: { label: "D", tone: "text-destructive" },
  renamed: { label: "R", tone: "harbor-text-info" },
  untracked: { label: "?", tone: "harbor-text-success" },
};

export function DeliveryMatrixPreview({
  featureId,
  repo,
  active,
  canSplit,
  onOpenNativeDiff,
  onClosePreview,
}: {
  readonly featureId: string;
  readonly repo: FeatureRepoGitStatus;
  readonly active: boolean;
  readonly canSplit: boolean;
  readonly onOpenNativeDiff: () => void;
  readonly onClosePreview: () => void;
}) {
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [diffView, setDiffView] = useState<"unified" | "split">("unified");
  const effectiveDiffView = canSplit ? diffView : "unified";

  const diffQuery = useFeatureRepoDiff(featureId, repo.directory, {
    includeUntracked: true,
    enabled: active && repo.exists,
  });

  const files = diffQuery.data?.files ?? EMPTY_FILES;

  useEffect(() => {
    setActiveFilePath((prev) =>
      prev !== null && files.some((file) => file.filePath === prev)
        ? prev
        : (files[0]?.filePath ?? null),
    );
  }, [files, repo.directory]);

  const activeFile = useMemo(
    () => files.find((f) => f.filePath === activeFilePath) ?? files[0] ?? null,
    [activeFilePath, files],
  );

  return (
    <div className="flex min-h-[200px] flex-1 flex-col border-t border-border bg-muted/10">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-muted/25 px-2.5 py-1.5 text-2xs">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="font-medium text-foreground">{repo.directory}</span>
          <span className="font-mono text-muted-foreground">
            {repo.branch ?? "detached"}
          </span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            Read-only preview — stage &amp; commit in BB native Git
          </span>
        </div>
        <div className="flex items-center gap-1">
          {repo.role !== "ref" && files.length > 0 ? (
            <div className="flex items-center gap-0.5 rounded border border-border p-0.5">
              {(["unified", "split"] as const).map((view) => {
                const splitDisabled = view === "split" && !canSplit;
                return (
                  <button
                    key={view}
                    type="button"
                    disabled={splitDisabled}
                    title={
                      splitDisabled
                        ? "Widen panel to >= 600px for Split diff"
                        : undefined
                    }
                    onClick={() => setDiffView(view)}
                    className={cn(
                      "rounded-sm px-1.5 py-0.5 text-[10px] disabled:cursor-not-allowed disabled:opacity-40",
                      effectiveDiffView === view
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {view === "unified" ? "Unified" : "Split"}
                  </button>
                );
              })}
            </div>
          ) : null}
          {repo.role !== "ref" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 px-2 text-2xs"
              onClick={onOpenNativeDiff}
            >
              <Icon name="GitBranch" className="mr-1 size-3" aria-hidden />
              Open Diff &amp; Commit
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Close diff preview"
            className="h-6 px-1.5 text-2xs"
            onClick={onClosePreview}
          >
            <Icon name="X" className="size-3" aria-hidden />
          </Button>
        </div>
      </div>

      <div
        className={cn(
          "grid min-h-[180px] flex-1",
          canSplit
            ? "grid-cols-[200px_minmax(0,1fr)]"
            : "grid-cols-1 grid-rows-[auto_minmax(0,1fr)]",
        )}
      >
        <div
          className={cn(
            "overflow-y-auto border-border p-1",
            canSplit ? "border-r" : "max-h-32 border-b",
          )}
        >
          {diffQuery.isLoading ? (
            <p className="p-2 text-2xs text-muted-foreground">Loading diff…</p>
          ) : diffQuery.error !== null ? (
            <p className="p-2 text-2xs text-destructive">
              {diffQuery.error instanceof Error
                ? diffQuery.error.message
                : "Could not load diff."}
            </p>
          ) : files.length === 0 ? (
            <p className="p-2 text-2xs text-muted-foreground">Working tree clean.</p>
          ) : (
            <ul className="grid gap-0.5">
              {files.map((file) => {
                const badge = STATUS_BADGE[file.status] ?? {
                  label: "M",
                  tone: "text-muted-foreground",
                };
                const selected = activeFile?.filePath === file.filePath;
                return (
                  <li key={file.filePath}>
                    <button
                      type="button"
                      onClick={() => setActiveFilePath(file.filePath)}
                      title={file.filePath}
                      className={cn(
                        "flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-2xs",
                        selected
                          ? "bg-accent text-foreground"
                          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                      )}
                    >
                      <span className={cn("w-3 shrink-0 font-mono text-[10px]", badge.tone)}>
                        {badge.label}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                        {file.filePath}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="min-w-0 overflow-auto p-2">
          {activeFile === null ? (
            <div className="flex h-full items-center justify-center text-2xs text-muted-foreground">
              {repo.clean
                ? `${repo.directory} has no local modifications.`
                : "Select a file to inspect its unified patch."}
            </div>
          ) : classifyDiffPatch(activeFile.patch) !== "hunks" ? (
            <div className="flex items-start gap-2 rounded-md border border-border bg-muted/20 p-3 text-2xs text-muted-foreground">
              <Icon name="Info" className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <div className="grid min-w-0 gap-0.5">
                <p className="font-medium text-foreground">
                  {classifyDiffPatch(activeFile.patch) === "binary"
                    ? "Binary file — text preview unavailable"
                    : "Empty or metadata-only file change"}
                </p>
                <p className="font-mono break-words [overflow-wrap:anywhere]">
                  {activeFile.filePath}
                </p>
              </div>
            </div>
          ) : (
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between gap-2 rounded border border-border/70 bg-muted/30 px-2 py-1 text-[11px]">
                <span className="min-w-0 truncate font-mono text-foreground">
                  {activeFile.filePath}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  <span className="harbor-text-success">+{activeFile.additions}</span>{" "}
                  <span className="text-destructive">-{activeFile.deletions}</span>
                </span>
              </div>
              {activeFile.truncated ? (
                <p className="harbor-text-warning text-[10px]">
                  Large diff truncated at 128 KB preview limit.
                </p>
              ) : null}
              <BbDiff
                patch={activeFile.patch}
                path={activeFile.filePath}
                view={effectiveDiffView}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
