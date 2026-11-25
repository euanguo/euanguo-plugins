import { useEffect, useId, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";

import type { harborRpcContract } from "@/server/contract";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialogFooter } from "@/components/ui/confirm-dialog-footer";
import { DialogActions, DialogError, Field } from "@/components/ui/control";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useDialogTask } from "@/hooks/use-dialog-task";
import { useFeatureHealth } from "@/hooks/use-feature-cockpit";
import { errorMessage } from "@/lib/domain/errors";
import type { Feature } from "@/lib/domain/features";
import { cn } from "@/lib/ui/utils";

type Survey = {
  featureName: string;
  rootPath: string | null;
  repositories: string[];
  threadCount: number;
  /** Branches this feature created, which deleting may take back. */
  createdBranches: number;
  warnings: string[];
  requiresConfirmation: boolean;
};

/**
 * Ending a feature, one of two ways.
 *
 * **Finish** is the ordinary end: the work is merged or abandoned, so its
 * conversations are archived and its worktrees taken back, and everything with
 * history in it — the branches, the folder, the notes in `AGENTS.md` — stays.
 * The feature moves to the Finished shelf and can be reopened.
 *
 * **Delete** does all of that and removes the folder, and the branches Harbor
 * created for it when asked. Members may each be on their own name. It cannot be
 * undone.
 *
 * Both read what would be lost before the button is enabled, and the server
 * reads it again rather than trusting this copy. When anything uncommitted
 * would go, the feature's name has to be typed: a checkbox can be clicked
 * without reading, a name cannot.
 */
export function FeatureEndDialog({
  mode,
  feature,
  onClose,
}: {
  mode: "finish" | "delete" | null;
  feature: Feature | null;
  onClose: () => void;
}) {
  const deleteBranchesId = useId();
  const rpc = useRpc<typeof harborRpcContract>();
  const open = mode !== null && feature !== null;
  const [deleteBranches, setDeleteBranches] = useState(false);
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const task = useDialogTask<unknown>();
  const busy = task.busy;
  const error = task.error;
  const healthQuery = useFeatureHealth(
    feature?.id ?? null,
    mode === "delete" && deleteBranches,
    open,
  );

  useEffect(() => {
    if (!open) return;
    setTyped("");
    task.reset();
    setDeleteBranches(false);
  }, [open, mode, feature?.id]);
  useEffect(() => {
    if (!open || feature === null) return;
    let cancelled = false;
    setSurvey(null);
    setLoadError(null);
    rpc
      .call("inspectFeatureRemoval", {
        featureId: feature.id,
        deletesBranches: mode === "delete" && deleteBranches,
      })
      .then((result) => {
        if (!cancelled) setSurvey(result);
      })
      .catch((failure: unknown) => {
        if (!cancelled) setLoadError(errorMessage(failure, "That did not work."));
      });
    return () => {
      cancelled = true;
    };
  }, [deleteBranches, feature, mode, open, rpc]);

  if (!open || feature === null || mode === null) return null;

  const health = healthQuery.data ?? null;
  const needsName =
    survey?.requiresConfirmation === true || (health?.blockedCount ?? 0) > 0;
  const healthPending = mode === "delete" && deleteBranches && healthQuery.isLoading;
  const ready =
    survey !== null && !healthPending && (!needsName || typed.trim() === feature.name);

  const submit = () => {
    if (!ready || busy) return;
    void task.run(async () => {
      const result =
        mode === "finish"
          ? await rpc.call("finishFeature", { featureId: feature.id, acknowledged: true })
          : await rpc.call("deleteFeature", {
              featureId: feature.id,
              acknowledged: true,
              deleteBranches,
            });
        if (result.leftovers.length > 0) {
          task.setError(
            `Could not remove ${result.leftovers.join(", ")}. They are still on disk.`,
          );
          return;
        }
        onClose();
    }, "That did not work.");
  };

  const finishing = mode === "finish";
  const repositories = survey?.repositories ?? [];
  return (
    <Modal
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      title={finishing ? "Finish feature?" : "Delete feature?"}
      subtitle={feature.name}
      icon={finishing ? "Archive" : "Trash2"}
      tone={finishing ? "default" : "destructive"}
      busy={busy}
      width="30rem"
      footer={
        <ConfirmDialogFooter
          cancelLabel="Cancel"
          submitLabel={
            busy
              ? finishing
                ? "Finishing…"
                : "Deleting…"
              : finishing
                ? "Finish feature"
                : "Delete feature"
          }
          busy={busy}
          disabled={!ready}
          tone={finishing ? "default" : "destructive"}
          onSubmit={submit}
          onCancel={onClose}
        />
      }
    >
      <div className="grid gap-3 text-xs">
        <ul className="grid gap-1 leading-relaxed text-muted-foreground">
          <li>
            {repositories.length === 0
              ? "It has no worktrees to take back."
              : `Removes the worktrees for ${repositories.join(", ")}.`}
          </li>
          <li>Archives its conversations.</li>
          {finishing ? (
            <li>
              Keeps every branch, the folder and its <span className="font-mono">AGENTS.md</span>. You can reopen it from Finished.
            </li>
          ) : (
            <li>
              Deletes the folder{feature.rootPath === null ? "" : ` ${feature.rootPath}`}, including the notes in{" "}
              <span className="font-mono">AGENTS.md</span>. This cannot be undone.
            </li>
          )}
        </ul>
        {finishing ? null : (
          <label
            htmlFor={deleteBranchesId}
            className="flex cursor-pointer items-center gap-2 text-foreground"
          >
            <Checkbox
              id={deleteBranchesId}
              checked={deleteBranches}
              disabled={busy || survey?.createdBranches === 0}
              onCheckedChange={(value) => setDeleteBranches(value === true)}
            />
            <span>
              {survey === null || survey.createdBranches === 0
                ? "Keep every branch — none of these were created by Harbor"
                : `Also delete the ${survey.createdBranches} ${survey.createdBranches === 1 ? "branch" : "branches"} Harbor created`}
            </span>
          </label>
        )}
        {health && health.repos.length > 0 ? (
          <div className="grid gap-1.5 rounded-md border border-border p-2.5">
            <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
              <span>Cross-Repo Health Matrix</span>
              <span
                className={cn(
                  health.blockedCount === 0
                    ? "text-emerald-500"
                    : "font-semibold text-destructive",
                )}
              >
                {health.blockedCount === 0
                  ? "Ready"
                  : `${health.blockedCount} attention needed`}
              </span>
            </div>
            <ul className="grid gap-1">
              {health.repos.map((repo) => {
                const blocked = repo.blockerReason !== null;
                const unpushed = !blocked && (repo.aheadCommits ?? 0) > 0;
                return (
                  <li
                    key={repo.directory}
                    className="flex items-center justify-between gap-2 text-2xs"
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate font-medium text-foreground">
                        {repo.directory}
                      </span>
                      {repo.role === "ref" ? (
                        <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                          Ref · exempt
                        </span>
                      ) : repo.branch ? (
                        <span className="truncate rounded bg-muted/60 px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {repo.branch}
                        </span>
                      ) : null}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 tabular-nums",
                        blocked
                          ? "text-destructive"
                          : unpushed
                            ? "text-amber-500"
                            : repo.role === "ref"
                              ? "text-muted-foreground"
                              : "text-emerald-500",
                      )}
                    >
                      {blocked
                        ? repo.blockerReason
                        : unpushed
                          ? `↑${repo.aheadCommits} unpushed`
                          : repo.role === "ref"
                            ? "Unlinked safely"
                            : "Clean"}
                      {repo.additions > 0 || repo.deletions > 0
                        ? ` (+${repo.additions}/-${repo.deletions})`
                        : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        {loadError !== null ? (
          <p className="text-destructive">{loadError}</p>
        ) : survey === null ? (
          <p className="text-muted-foreground">Reading what is in it…</p>
        ) : survey.warnings.length === 0 ? (
          <p className="text-muted-foreground">Nothing uncommitted would be lost.</p>
        ) : (
          <ul className="grid gap-0.5 rounded-md border border-border px-2.5 py-1.5">
            {survey.warnings.map((warning) => {
              const destructiveWarning = /changed|uncommitted|unpushed|lost|deleted/i.test(
                warning,
              );
              return (
                <li
                  key={warning}
                  className={
                    destructiveWarning && needsName
                      ? "text-destructive"
                      : "text-muted-foreground"
                  }
                >
                  {warning}
                </li>
              );
            })}
          </ul>
        )}
        {needsName ? (
          <Field label={`Type ${feature.name} to confirm`}>
            <Input
              autoFocus
              value={typed}
              disabled={busy}
              onChange={(event) => setTyped(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  submit();
                }
              }}
            />
          </Field>
        ) : null}
        {error === null ? null : <DialogError>{error}</DialogError>}
      </div>
    </Modal>
  );
}

/** Renaming a feature. Its folder and branch keep their slug, so nothing moves. */
export function FeatureRenameDialog({
  feature,
  onClose,
  onRename,
}: {
  feature: Feature | null;
  onClose: () => void;
  onRename: (featureId: string, name: string) => Promise<boolean>;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setValue(feature?.name ?? "");
  }, [feature]);
  if (feature === null) return null;
  const trimmed = value.trim();
  const submit = () => {
    if (trimmed.length === 0 || trimmed === feature.name) {
      onClose();
      return;
    }
    setBusy(true);
    void onRename(feature.id, trimmed).finally(() => {
      setBusy(false);
      onClose();
    });
  };
  return (
    <Modal
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      icon="Edit"
      title="Rename feature"
      subtitle="The folder and the branch keep their name."
      busy={busy}
      width="26rem"
      footer={
        <DialogActions>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={busy || trimmed.length === 0} onClick={submit}>
            Rename
          </Button>
        </DialogActions>
      }
    >
      <Field label="Feature name">
        <Input
          autoFocus
          value={value}
          maxLength={60}
          aria-label={`Rename ${feature.name}`}
          onChange={(event) => setValue(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
        />
      </Field>
    </Modal>
  );
}
