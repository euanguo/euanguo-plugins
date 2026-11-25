import { experimental_Diff as BbDiff } from "@get-bb/plugin-sdk/app";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { Textarea } from "@/components/ui/textarea";
import {
  useFeatureCockpitMutations,
  useFeatureRepoDiff,
} from "@/hooks/use-feature-cockpit";
import type {
  DiffFileEntry,
  FeatureGitSummary,
  FeatureRepoGitStatus,
} from "@/lib/domain/feature-git";
import { cn } from "@/lib/ui/utils";

const EMPTY_REPOS: readonly FeatureRepoGitStatus[] = [];
const EMPTY_FILES: readonly DiffFileEntry[] = [];

const STATUS_BADGE: Record<string, { label: string; tone: string }> = {
  modified: { label: "M", tone: "text-amber-500" },
  added: { label: "A", tone: "text-emerald-500" },
  deleted: { label: "D", tone: "text-destructive" },
  renamed: { label: "R", tone: "text-sky-500" },
  untracked: { label: "?", tone: "text-emerald-500" },
};

export function FeatureHubChanges({
  featureId,
  gitSummary,
  loadingStatus,
  onRefreshStatus,
  requestedDirectory,
}: {
  readonly featureId: string;
  readonly gitSummary: FeatureGitSummary | null;
  readonly loadingStatus: boolean;
  readonly onRefreshStatus: () => void;
  readonly requestedDirectory?: string;
}) {
  const repos = gitSummary?.repos ?? EMPTY_REPOS;
  const [selectedDir, setSelectedDir] = useState<string | null>(null);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(() => new Set());
  const [diffView, setDiffView] = useState<"unified" | "split">("unified");
  const [commitMessage, setCommitMessage] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const mutations = useFeatureCockpitMutations();

  useEffect(() => {
    const node = containerRef.current;
    if (node === null || typeof ResizeObserver === "undefined") return;
    setContainerWidth(node.getBoundingClientRect().width);
    let rafId = 0;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (typeof width !== "number") return;
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => setContainerWidth(width));
    });
    observer.observe(node);
    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, []);

  const isWide = containerWidth >= 560;
  const canSplit = containerWidth >= 600;
  const effectiveDiffView = canSplit ? diffView : "unified";

  useEffect(() => {
    if (requestedDirectory && repos.some((r) => r.directory === requestedDirectory)) {
      setSelectedDir(requestedDirectory);
    }
  }, [repos, requestedDirectory]);

  useEffect(() => {
    if (repos.length === 0) {
      setSelectedDir(null);
      return;
    }
    if (selectedDir === null || !repos.some((r) => r.directory === selectedDir)) {
      const firstDirty = repos.find((r) => !r.clean) ?? repos[0];
      setSelectedDir(firstDirty?.directory ?? null);
    }
  }, [repos, selectedDir]);

  const activeRepo = useMemo(
    () => repos.find((repo) => repo.directory === selectedDir) ?? null,
    [repos, selectedDir],
  );

  const diffQuery = useFeatureRepoDiff(featureId, activeRepo?.directory ?? null, {
    includeUntracked: true,
    enabled: activeRepo !== null,
  });

  const files = diffQuery.data?.files ?? EMPTY_FILES;

  useEffect(() => {
    setSelectedFiles(new Set(files.map((file) => file.filePath)));
    setActiveFilePath(files[0]?.filePath ?? null);
    setActionError(null);
  }, [activeRepo?.directory, files]);

  const activeFile = useMemo(
    () => files.find((f) => f.filePath === activeFilePath) ?? files[0] ?? null,
    [activeFilePath, files],
  );

  const toggleFile = (filePath: string, checked: boolean) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (checked) next.add(filePath);
      else next.delete(filePath);
      return next;
    });
  };

  const handleSuggestMessage = () => {
    if (activeRepo === null || mutations.suggestCommit.isPending) return;
    setActionError(null);
    void mutations.suggestCommit
      .mutate({ featureId, directory: activeRepo.directory })
      .then((res) => setCommitMessage(res.message))
      .catch((err: unknown) =>
        setActionError(err instanceof Error ? err.message : "Could not draft commit message."),
      );
  };

  const handleCommit = (push: boolean) => {
    if (activeRepo === null || commitMessage.trim().length === 0) return;
    if (activeRepo.role === "ref") return;
    setActionError(null);
    const chosen = [...selectedFiles];
    void mutations.commitRepo
      .mutate({
        featureId,
        directory: activeRepo.directory,
        message: commitMessage.trim(),
        files: chosen.length > 0 && chosen.length < files.length ? chosen : null,
        push,
      })
      .then((res) => {
        setCommitMessage("");
        if (push && res.pushError) {
          setActionError(`Committed ${res.sha ?? ""}, but push failed: ${res.pushError}`);
        } else {
          toast.success(
            res.pushed
              ? `Committed & pushed ${activeRepo.directory} (${res.sha ?? ""})`
              : `Committed ${activeRepo.directory} (${res.sha ?? ""})`,
          );
        }
        onRefreshStatus();
        void diffQuery.refetch();
      })
      .catch((err: unknown) =>
        setActionError(err instanceof Error ? err.message : "Commit failed."),
      );
  };

  const handlePushOnly = () => {
    if (activeRepo === null || activeRepo.role === "ref") return;
    setActionError(null);
    void mutations.pushRepo
      .mutate({ featureId, directory: activeRepo.directory })
      .then(() => {
        toast.success(`Pushed ${activeRepo.directory}.`);
        onRefreshStatus();
      })
      .catch((err: unknown) =>
        setActionError(err instanceof Error ? err.message : "Push failed."),
      );
  };

  if (repos.length === 0) {
    return (
      <div className="p-4 text-xs text-muted-foreground">
        {loadingStatus
          ? "Inspecting repository git status…"
          : "No repositories attached yet. Switch to Repos to add one."}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="@container flex min-h-0 flex-1 flex-col text-xs">
      {/* Multi-Repo Switcher Strip */}
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-2.5 py-2">
        {repos.map((repo) => {
          const isSelected = repo.directory === activeRepo?.directory;
          return (
            <button
              key={repo.directory}
              type="button"
              onClick={() => setSelectedDir(repo.directory)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-2xs transition-colors",
                isSelected
                  ? "border-foreground/40 bg-accent text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              <Icon
                name={repo.role === "ref" ? "Link" : "FolderGit"}
                className="size-3 shrink-0"
                aria-hidden
              />
              <span className="font-medium">{repo.directory}</span>
              {repo.role === "ref" ? (
                <span className="rounded bg-muted px-1 text-[9px]">Ref</span>
              ) : repo.changedFiles + repo.untrackedFiles > 0 ? (
                <span className="tabular-nums text-amber-500">
                  ● {repo.changedFiles + repo.untrackedFiles}
                </span>
              ) : null}
              {(repo.aheadCommits ?? 0) > 0 ? (
                <span className="tabular-nums text-sky-500">↑{repo.aheadCommits}</span>
              ) : null}
            </button>
          );
        })}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Refresh git status"
          className="ml-auto h-6 shrink-0 px-2 text-2xs"
          onClick={() => {
            onRefreshStatus();
            void diffQuery.refetch();
          }}
        >
          Refresh
        </Button>
      </div>

      {/* Repo Branch & Submodules Subheader */}
      {activeRepo ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-muted/20 px-2.5 py-1.5 text-2xs">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="font-mono text-foreground/90">
              {activeRepo.branch ?? "detached"}
            </span>
            {activeRepo.upstream ? (
              <span className="text-muted-foreground">→ {activeRepo.upstream}</span>
            ) : null}
            {activeRepo.role === "ref" ? (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                Read-only Ref
              </span>
            ) : null}
            {activeRepo.submodules.length > 0 ? (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                Submodules:{" "}
                {activeRepo.submodules
                  .map((s) => `${s.name}${s.dirty ? " (dirty)" : ""}`)
                  .join(", ")}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            {(["unified", "split"] as const).map((view) => {
              const splitDisabled = view === "split" && !canSplit;
              return (
                <button
                  key={view}
                  type="button"
                  disabled={splitDisabled}
                  title={
                    splitDisabled
                      ? "Widen the Feature Hub panel to at least 600px for side-by-side Split diff"
                      : undefined
                  }
                  onClick={() => setDiffView(view)}
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] disabled:cursor-not-allowed disabled:opacity-40",
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
        </div>
      ) : null}

      {/* File Tree + BB Native experimental_Diff */}
      <div
        className={cn(
          "grid min-h-[220px] flex-1",
          isWide ? "grid-cols-[190px_minmax(0,1fr)]" : "grid-cols-1",
        )}
      >
        <div
          className={cn(
            "flex flex-col border-border",
            isWide ? "border-r" : "max-h-36 border-b",
          )}
        >
          <div className="flex items-center justify-between border-b border-border/60 px-2 py-1 text-[10px] text-muted-foreground">
            <span>Files ({files.length})</span>
            {files.length > 0 && activeRepo?.role !== "ref" ? (
              <button
                type="button"
                onClick={() =>
                  setSelectedFiles(
                    selectedFiles.size === files.length
                      ? new Set()
                      : new Set(files.map((f) => f.filePath)),
                  )
                }
                className="hover:text-foreground"
              >
                {selectedFiles.size === files.length ? "None" : "All"}
              </button>
            ) : null}
          </div>
          <div className="flex-1 overflow-y-auto p-1">
            {diffQuery.isLoading ? (
              <p className="p-2 text-2xs text-muted-foreground">Loading diff…</p>
            ) : files.length === 0 ? (
              <p className="p-2 text-2xs text-muted-foreground">Working tree clean.</p>
            ) : (
              <ul className="grid gap-0.5">
                {files.map((file) => {
                  const badge = STATUS_BADGE[file.status] ?? {
                    label: "M",
                    tone: "text-muted-foreground",
                  };
                  const active = activeFile?.filePath === file.filePath;
                  return (
                    <li
                      key={file.filePath}
                      className={cn(
                        "flex items-center gap-1.5 rounded px-1.5 py-1 text-2xs",
                        active ? "bg-accent text-foreground" : "hover:bg-muted/50",
                      )}
                    >
                      {activeRepo?.role !== "ref" ? (
                        <Checkbox
                          checked={selectedFiles.has(file.filePath)}
                          onCheckedChange={(v) => toggleFile(file.filePath, v === true)}
                        />
                      ) : null}
                      <span className={cn("w-3 shrink-0 font-mono text-[10px]", badge.tone)}>
                        {badge.label}
                      </span>
                      <button
                        type="button"
                        onClick={() => setActiveFilePath(file.filePath)}
                        title={file.filePath}
                        className="min-w-0 flex-1 truncate text-left font-mono text-[11px]"
                      >
                        {file.filePath}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="min-w-0 overflow-auto p-2">
          {activeFile === null ? (
            <div className="flex h-full items-center justify-center text-2xs text-muted-foreground">
              {activeRepo?.clean
                ? `${activeRepo.directory} has no local modifications.`
                : "Select a file to inspect its unified patch."}
            </div>
          ) : activeFile.patch.trim().length === 0 ? (
            <div className="rounded border border-border p-3 text-2xs text-muted-foreground">
              No text patch preview available for <span className="font-mono">{activeFile.filePath}</span> (binary or empty file).
            </div>
          ) : (
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between gap-2 rounded border border-border/70 bg-muted/30 px-2 py-1 text-[11px]">
                <span className="min-w-0 truncate font-mono text-foreground">
                  {activeFile.filePath}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  <span className="text-emerald-500">+{activeFile.additions}</span>{" "}
                  <span className="text-destructive">-{activeFile.deletions}</span>
                </span>
              </div>
              {activeFile.truncated ? (
                <p className="text-[10px] text-amber-500">
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

      {/* Commit & Push Footer */}
      {activeRepo ? (
        <div className="shrink-0 border-t border-border bg-muted/20 p-2.5">
          {activeRepo.role === "ref" ? (
            <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-2xs text-amber-500">
              <Icon name="AlertCircle" className="size-3.5 shrink-0" aria-hidden />
              Read-only reference repository — switch to a writable worktree to commit or push.
            </div>
          ) : (
            <div className="grid gap-2">
              <Textarea
                rows={2}
                value={commitMessage}
                maxLength={2000}
                placeholder={`Commit message for ${activeRepo.directory} (${selectedFiles.size} file${selectedFiles.size === 1 ? "" : "s"} selected)…`}
                onChange={(e) => setCommitMessage(e.currentTarget.value)}
                className="min-h-0 resize-none font-mono text-2xs"
              />
              {actionError ? (
                <p className="text-2xs text-destructive">{actionError}</p>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-2xs"
                  disabled={files.length === 0 || mutations.suggestCommit.isPending}
                  onClick={handleSuggestMessage}
                >
                  <Icon name="Edit" className="mr-1 size-3" aria-hidden />
                  {mutations.suggestCommit.isPending ? "Drafting…" : "Draft msg"}
                </Button>
                <div className="flex items-center gap-1.5">
                  {(activeRepo.aheadCommits ?? 0) > 0 ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2.5 text-2xs"
                      disabled={mutations.pushRepo.isPending}
                      onClick={handlePushOnly}
                    >
                      {mutations.pushRepo.isPending
                        ? "Pushing…"
                        : `Push (${activeRepo.aheadCommits})`}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2.5 text-2xs"
                    disabled={
                      files.length === 0 ||
                      selectedFiles.size === 0 ||
                      commitMessage.trim().length === 0 ||
                      mutations.commitRepo.isPending
                    }
                    onClick={() => handleCommit(false)}
                  >
                    Commit
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 px-2.5 text-2xs"
                    disabled={
                      files.length === 0 ||
                      selectedFiles.size === 0 ||
                      commitMessage.trim().length === 0 ||
                      mutations.commitRepo.isPending
                    }
                    onClick={() => handleCommit(true)}
                  >
                    {mutations.commitRepo.isPending ? "Working…" : "Commit & Push"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
