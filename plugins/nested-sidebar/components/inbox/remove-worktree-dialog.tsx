import { useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { nestRpcContract } from "@/server/contract";
import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/modal";
import { DialogError } from "@/components/ui/control";
import { ConfirmDialogFooter } from "@/components/ui/confirm-dialog-footer";
import { useDialogTask } from "@/hooks/use-dialog-task";
import { errorMessage } from "@/lib/domain/errors";
import { cn } from "@/lib/ui/utils";
import {
  removalSubmissionBlocker,
  WORKSPACE_CHANGED_MESSAGE,
  type WorktreeRemovalPlan,
} from "@/lib/domain/worktree-removal";

/** What the dialog draws from, narrowed to the fields it actually reads. */
interface Inspected {
  readonly survey: {
    readonly path: string;
    readonly branch: string | null;
    readonly bbOwned: boolean;
  };
  readonly plan: WorktreeRemovalPlan;
  readonly digest: string;
}

/**
 * Removing a worktree row, which is three things at once and only one of them
 * irreversible.
 *
 * The top half is what the row is: its threads archive and bb's environment is
 * released, both of which can be undone. The bottom half is the directory on
 * disk, and it is off by default: it is behind a checkbox, a list of exactly
 * what would be lost, an acknowledgement, and the directory's own name typed out.
 * The two halves are in one dialog because they are one decision — "this row is
 * done" — and because the second half is only safe to offer next to the counts
 * the first half would leave behind.
 */
export function RemoveWorktreeDialog({
  open,
  environmentId,
  label,
  onClose,
}: {
  open: boolean;
  environmentId: string | null;
  /** The row's own label, for the heading. */
  label: string;
  onClose: () => void;
}) {
  const rpc = useRpc<typeof nestRpcContract>();
  const [plan, setPlan] = useState<Inspected | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deleteDirectory, setDeleteDirectory] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const task = useDialogTask<unknown>();
  const busy = task.busy;
  const failure = task.error;
  /** Set when the row is gone but the directory could not be. */
  const [leftBehind, setLeftBehind] = useState<string | null>(null);
  /**
   * The environment the dialog is currently showing. A re-inspection started
   * for one row must not land on another row the user opened meanwhile.
   */
  const currentEnvironmentId = useRef(environmentId);
  currentEnvironmentId.current = environmentId;

  useEffect(() => {
    if (!open || environmentId === null) return;
    let cancelled = false;
    setPlan(null);
    setLoadError(null);
    task.setError(null);
    setLeftBehind(null);
    setDeleteDirectory(false);
    setAcknowledged(false);
    rpc
      .call("inspectWorktree", { environmentId })
      .then((result) => {
        if (!cancelled) setPlan(result);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(errorMessage(error, "That did not work."));
      });
    return () => {
      cancelled = true;
    };
  }, [open, environmentId, rpc]);

  const directory = plan?.plan.directory ?? null;
  const blocker =
    plan === null
      ? "unavailable"
      : removalSubmissionBlocker(plan.plan, { deleteDirectory, acknowledged });
  const warnings = directory?.warnings ?? [];

  const submit = () => {
    if (environmentId === null || busy) return;
    void task.run(async () => {
      const result = await rpc.call("removeWorktree", {
        environmentId,
        deleteDirectory,
        acknowledged,
        expectedDigest: plan?.digest ?? null,
      });
      if (!result.ok) {
        // The plan the user agreed to is not the one on disk now. Say so,
        // then read the workspace again so the decision restarts from the
        // current counts rather than leaving a stale plan underneath.
        if (result.code === "changed") {
          task.setError(result.message ?? WORKSPACE_CHANGED_MESSAGE);
          setPlan(null);
          // The new plan is a new decision: both the directory choice and
          // the acknowledgement have to be made again against these counts.
          setAcknowledged(false);
          setDeleteDirectory(false);
          rpc
            .call("inspectWorktree", { environmentId })
            .then((inspected) => {
              if (currentEnvironmentId.current === environmentId) {
                setPlan(inspected);
              }
            })
            .catch((error: unknown) => {
              setLoadError(errorMessage(error, "That did not work."));
            });
          return;
        }
        task.setError(result.message ?? "The workspace could not be removed.");
        return;
      }
      if (result.directory === "failed") {
        // The row is gone, so re-inspecting it would fail; say what is left
        // and let the user close this themselves.
        setLeftBehind(result.message ?? "The directory was not removed.");
        return;
      }
      onClose();
    }, "The workspace could not be removed.");
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title="Remove this worktree?"
      subtitle={
        plan === null || plan.survey.branch === null
          ? label
          : `${label} · ${plan.survey.branch}`
      }
      icon="Trash2"
      tone="destructive"
      busy={busy}
      width="30rem"
      footer={
        <ConfirmDialogFooter
          cancelLabel={leftBehind === null ? "Cancel" : "Close"}
          submitLabel={deleteDirectory ? "Delete worktree" : "Remove worktree"}
          busy={busy}
          disabled={busy || blocker !== null || leftBehind !== null}
          tone="destructive"
          submitIcon="Trash2"
          cancelAutoFocus
          onSubmit={submit}
          onCancel={onClose}
        />
      }
    >
      <div className="space-y-3">
        {plan === null ? null : (
          <p className="break-all text-2xs text-muted-foreground">
            {plan.survey.path}
          </p>
        )}

        {loadError === null ? null : (
          <p className="rounded border border-destructive/30 bg-destructive/10 px-2 py-1 text-2xs text-destructive">
            {loadError}
          </p>
        )}

        {plan === null && loadError === null ? (
          <p className="text-xs text-muted-foreground">Reading the workspace…</p>
        ) : null}

        {plan === null ? null : (
          <>
            <div className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-2.5">
              <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                Always, and reversible
              </p>
              <FixedStep
                label={
                  plan.plan.threadCount === 0
                    ? "No threads are here to archive"
                    : `Archive ${plan.plan.threadCount === 1 ? "1 thread" : `${plan.plan.threadCount} threads`} here`
                }
                hint={
                  plan.plan.liveThreadCount === 0
                    ? "Unarchiving brings them back."
                    : `${plan.plan.liveThreadCount} running now; archiving stops them.`
                }
                done={plan.plan.threadCount === 0}
              />
              <FixedStep
                label="Release bb's environment for this directory"
                hint="Nothing on disk changes; a thread here can rebuild it."
                done={false}
              />
            </div>

            <div className="space-y-2 rounded-lg border border-border p-2.5">
              <label className="flex items-start gap-2 text-xs text-foreground">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={deleteDirectory}
                  disabled={
                    busy || plan.plan.directory.refusal !== null || leftBehind !== null
                  }
                  onChange={(event) => setDeleteDirectory(event.target.checked)}
                />
                <span className="min-w-0">
                  Also delete the directory from disk
                  <span className="block text-2xs text-muted-foreground">
                    {plan.plan.directory.refusal ??
                      (plan.survey.bbOwned
                        ? "bb created this directory, so this is bb's own cleanup."
                        : "bb did not create this directory; the tool that did keeps its own record of it.")}
                  </span>
                </span>
              </label>

              {deleteDirectory && plan.plan.directory.refusal === null ? (
                <div className="space-y-2 border-t border-border pt-2">
                  {warnings.length === 0 ? (
                    <p className="text-2xs text-muted-foreground">
                      Nothing uncommitted here, and no commits ahead of its base.
                    </p>
                  ) : (
                    <ul className="space-y-1 text-2xs">
                      {warnings.map((warning) => (
                        <li
                          key={warning.text}
                          className={cn(
                            "flex items-start gap-1.5",
                            warning.kind === "discard"
                              ? "text-destructive"
                              : warning.kind === "in-use"
                                ? "text-primary"
                                : "text-muted-foreground",
                          )}
                        >
                          <Icon
                            // An open terminal is what "in use" means, and a
                            // directory something else still points at is a
                            // folder. Both are names the host draws; the
                            // hourglass it does not have.
                            name={
                              warning.kind === "discard"
                                ? "Trash2"
                                : warning.kind === "in-use"
                                  ? "Terminal"
                                  : "Folder"
                            }
                            className="mt-0.5 size-3 shrink-0"
                            aria-hidden
                          />
                          <span className="min-w-0">{warning.text}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* One box, always: what it asks the user to read is the list
                      above, and a path is too long to type without reading. */}
                  <label className="flex items-start gap-2 text-2xs text-foreground">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={acknowledged}
                      disabled={busy}
                      onChange={(event) => setAcknowledged(event.target.checked)}
                    />
                    I understand this cannot be undone
                  </label>
                </div>
              ) : null}
            </div>
          </>
        )}

        {failure === null ? null : (
          <DialogError className="rounded border border-destructive/30 bg-destructive/10 px-2 py-1">
            {failure}
          </DialogError>
        )}

        {leftBehind === null ? null : (
          <p className="rounded border border-border bg-muted/40 px-2 py-1 text-2xs text-muted-foreground">
            The row is gone, but the directory is still there: {leftBehind}
          </p>
        )}
      </div>
    </Modal>
  );
}

/** A step the dialog always takes, drawn as a checkbox that cannot be cleared. */
function FixedStep({
  label,
  hint,
  done,
}: {
  label: string;
  hint: string;
  done: boolean;
}) {
  return (
    <label className="flex items-start gap-2 text-xs text-foreground/90">
      <input type="checkbox" className="mt-0.5" checked={!done} disabled readOnly />
      <span className="min-w-0">
        {label}
        <span className="block text-2xs text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}
