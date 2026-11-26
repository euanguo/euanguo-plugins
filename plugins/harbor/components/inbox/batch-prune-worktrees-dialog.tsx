import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { ConfirmDialogFooter } from "@/components/ui/confirm-dialog-footer";
import { DialogActions, DialogError } from "@/components/ui/control";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/modal";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { useDialogTask } from "@/hooks/use-dialog-task";
import { triggerRepoFactsRefresh } from "@/hooks/use-repo-facts";
import { triggerWorkspacePathsRefresh } from "@/hooks/use-workspace-paths";
import { errorMessage } from "@/lib/domain/errors";
import type {
  BatchRemoveWorktreesResult,
  BatchWorktreeSurveyItem,
} from "@/lib/domain/worktree-removal";
import { overlayCoordinator } from "@/lib/ui/overlay-coordinator";
import { cn, formatHomePathForDisplay } from "@/lib/ui/utils";
import type { harborRpcContract } from "@/server/contract";

export interface BatchPruneCandidate {
  readonly environmentId: string;
  readonly label: string;
  readonly branch: string | null;
  readonly path: string | null;
  readonly dangling: boolean;
}

/**
 * Surveys and removes multiple inactive or dangling git worktrees in one flow.
 *
 * Pre-selects clean worktrees (including missing directories with no live
 * threads) while leaving dirty or active worktrees unchecked unless the user
 * opts in and confirms `force`.
 */
export function BatchPruneWorktreesDialog({
  open,
  projectName,
  candidates,
  onClose,
}: {
  open: boolean;
  projectName: string;
  candidates: readonly BatchPruneCandidate[];
  onClose: () => void;
}) {
  const idPrefix = useId();
  const deleteDirId = `${idPrefix}-delete-dir`;
  const forceDirtyId = `${idPrefix}-force-dirty`;
  const rpc = useRpc<typeof harborRpcContract>();
  const isCompactViewport = useIsCompactViewport();
  const [surveys, setSurveys] = useState<BatchWorktreeSurveyItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [deleteDirectory, setDeleteDirectory] = useState(true);
  const [forceDirty, setForceDirty] = useState(false);
  const [result, setResult] = useState<BatchRemoveWorktreesResult | null>(null);
  const task = useDialogTask<void>();

  useEffect(() => {
    if (!open || !isCompactViewport) return;
    overlayCoordinator.openDialog();
    return () => {
      overlayCoordinator.closeDialog();
    };
  }, [isCompactViewport, open]);

  const environmentIds = useMemo(
    () => candidates.map((candidate) => candidate.environmentId),
    [candidates],
  );

  const runSurvey = useCallback(() => {
    if (!open || environmentIds.length === 0) return () => undefined;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setSurveys([]);
    setSelectedIds(new Set());
    setResult(null);
    setForceDirty(false);
    task.setError(null);
    rpc
      .call("batchSurveyWorktrees", { environmentIds })
      .then((response) => {
        if (cancelled) return;
        setSurveys(response.items);
        setSelectedIds(
          new Set(
            response.items
              .filter((item) => item.ok && !item.dirty)
              .map((item) => item.environmentId),
          ),
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(errorMessage(error, "Could not inspect inactive worktrees."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [environmentIds, open, rpc, task.setError]);

  useEffect(() => runSurvey(), [runSurvey]);

  const surveyById = useMemo(
    () => new Map(surveys.map((item) => [item.environmentId, item] as const)),
    [surveys],
  );
  const cleanIds = useMemo(
    () => surveys.filter((item) => item.ok && !item.dirty).map((item) => item.environmentId),
    [surveys],
  );
  const dirtySelectedCount = useMemo(
    () =>
      [...selectedIds].filter((id) => surveyById.get(id)?.dirty === true).length,
    [selectedIds, surveyById],
  );

  const toggleCandidate = (environmentId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(environmentId)) next.delete(environmentId);
      else next.add(environmentId);
      return next;
    });
  };

  const submit = () => {
    if (task.busy || selectedIds.size === 0) return;
    if (dirtySelectedCount > 0 && !forceDirty) return;
    void task.run(async () => {
      const outcome = await rpc.call("batchRemoveWorktrees", {
        environmentIds: [...selectedIds],
        deleteDirectory,
        force: forceDirty,
      });
      triggerRepoFactsRefresh();
      triggerWorkspacePathsRefresh();
      if (outcome.skippedCount === 0 && outcome.failedCount === 0) {
        onClose();
        return;
      }
      setResult(outcome);
    }, "Could not remove selected worktrees.");
  };

  const canSubmit =
    !loading &&
    loadError === null &&
    selectedIds.size > 0 &&
    (dirtySelectedCount === 0 || forceDirty);

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!task.busy) onClose();
      }}
      icon="Trash2"
      tone="destructive"
      title={`Clean inactive worktrees in ${projectName}`}
      subtitle={`${candidates.length} inactive ${candidates.length === 1 ? "worktree" : "worktrees"}`}
      busy={task.busy}
      width="36rem"
      footer={
        result !== null ? (
          <DialogActions>
            <Button variant="default" size="sm" onClick={onClose}>
              Done
            </Button>
          </DialogActions>
        ) : (
          <ConfirmDialogFooter
            cancelLabel="Cancel"
            submitLabel={
              selectedIds.size === 0
                ? "Remove selected"
                : `Remove ${selectedIds.size} ${selectedIds.size === 1 ? "worktree" : "worktrees"}`
            }
            busy={task.busy}
            disabled={!canSubmit}
            tone="destructive"
            submitIcon="Trash2"
            cancelAutoFocus
            onSubmit={submit}
            onCancel={onClose}
          />
        )
      }
    >
      <div className="space-y-3">
        {loading ? (
          <p className="text-xs text-muted-foreground">
            Checking git status and open terminals across inactive worktrees…
          </p>
        ) : null}
        {loadError !== null ? (
          <div className="space-y-2">
            <DialogError>{loadError}</DialogError>
            <Button variant="outline" size="sm" onClick={() => void runSurvey()}>
              Retry check
            </Button>
          </div>
        ) : null}
        {result !== null ? (
          <div className="space-y-2">
            <p className="text-xs text-foreground">
              Removed {result.removedCount}, skipped {result.skippedCount}, failed{" "}
              {result.failedCount}.
            </p>
            <ul className="max-h-60 space-y-1 overflow-y-auto rounded-md border border-border/70 p-2">
              {result.items.map((item) => {
                const candidate = candidates.find(
                  (entry) => entry.environmentId === item.environmentId,
                );
                return (
                  <li
                    key={item.environmentId}
                    className="flex items-start justify-between gap-2 text-xs"
                  >
                    <span className="min-w-0 truncate font-mono text-2xs">
                      {candidate?.branch ?? candidate?.label ?? item.environmentId}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-2xs",
                        item.status === "removed"
                          ? "text-muted-foreground"
                          : item.status === "skipped"
                            ? "text-warning-foreground"
                            : "text-destructive",
                      )}
                    >
                      {item.status}
                      {item.reason ? ` · ${item.reason}` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : !loading && loadError === null ? (
          <>
            <div className="flex items-center justify-between gap-2 text-2xs text-muted-foreground">
              <span>
                {cleanIds.length} clean / dangling ready ·{" "}
                {Math.max(0, candidates.length - cleanIds.length)} dirty or busy
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set(cleanIds))}
                  className="hover:text-foreground"
                >
                  Select clean
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="hover:text-foreground"
                >
                  Clear
                </button>
              </div>
            </div>
            <ul className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border/70 p-1.5">
              {candidates.map((candidate) => {
                const survey = surveyById.get(candidate.environmentId);
                const dirty = survey?.dirty === true;
                const dangling =
                  candidate.dangling || survey?.survey?.directoryExists === false;
                const checked = selectedIds.has(candidate.environmentId);
                const reason = survey?.blockedReason ?? survey?.error ?? null;
                const itemId = `${idPrefix}-${candidate.environmentId}`;
                return (
                  <li key={candidate.environmentId}>
                    <label
                      htmlFor={itemId}
                      className={cn(
                        "flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent/50",
                        task.busy && "cursor-not-allowed opacity-60",
                      )}
                    >
                      <Checkbox
                        id={itemId}
                        checked={checked}
                        disabled={task.busy}
                        onCheckedChange={() => toggleCandidate(candidate.environmentId)}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-mono text-xs text-foreground">
                            {candidate.branch ?? candidate.label}
                          </span>
                          {dangling ? (
                            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              missing on disk
                            </span>
                          ) : dirty ? (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] text-destructive">
                              <Icon name="AlertTriangle" className="size-2.5" aria-hidden />
                              dirty
                            </span>
                          ) : (
                            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              clean
                            </span>
                          )}
                        </div>
                        {candidate.path !== null ? (
                          <p className="truncate font-mono text-2xs text-muted-foreground">
                            {formatHomePathForDisplay(candidate.path)}
                          </p>
                        ) : null}
                        {reason !== null ? (
                          <p className="text-2xs text-warning-foreground">{reason}</p>
                        ) : null}
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className="space-y-1.5 pt-1 text-xs">
              <label
                htmlFor={deleteDirId}
                className="flex cursor-pointer items-center gap-2"
              >
                <Checkbox
                  id={deleteDirId}
                  checked={deleteDirectory}
                  disabled={task.busy}
                  onCheckedChange={(value) => setDeleteDirectory(value === true)}
                />
                <span>Delete worktree directories from disk</span>
              </label>
              {dirtySelectedCount > 0 ? (
                <label
                  htmlFor={forceDirtyId}
                  className="flex cursor-pointer items-center gap-2 text-destructive"
                >
                  <Checkbox
                    id={forceDirtyId}
                    checked={forceDirty}
                    disabled={task.busy}
                    onCheckedChange={(value) => setForceDirty(value === true)}
                  />
                  <span>
                    Force remove {dirtySelectedCount} selected{" "}
                    {dirtySelectedCount === 1 ? "worktree" : "worktrees"} with uncommitted
                    or unmerged changes
                  </span>
                </label>
              ) : null}
            </div>
          </>
        ) : null}
        {task.error !== null ? <DialogError>{task.error}</DialogError> : null}
      </div>
    </Modal>
  );
}
