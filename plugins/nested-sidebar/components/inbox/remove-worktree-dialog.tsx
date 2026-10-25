import { useEffect, useId, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { nestRpcContract } from "@/server";
import { Icon } from "@/components/ui/icon";
import { PlainDialog } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import { removalSubmissionBlocker, type WorktreeRemovalPlan } from "@/lib/worktree-removal";

/** What the dialog draws from, narrowed to the fields it actually reads. */
interface Inspected {
  readonly survey: {
    readonly path: string;
    readonly branch: string | null;
    readonly bbOwned: boolean;
  };
  readonly plan: WorktreeRemovalPlan;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  const titleId = useId();
  const descriptionId = useId();
  const [plan, setPlan] = useState<Inspected | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deleteDirectory, setDeleteDirectory] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /** Set when the row is gone but the directory could not be. */
  const [leftBehind, setLeftBehind] = useState<string | null>(null);

  useEffect(() => {
    if (!open || environmentId === null) return;
    let cancelled = false;
    setPlan(null);
    setLoadError(null);
    setFailure(null);
    setLeftBehind(null);
    setDeleteDirectory(false);
    setAcknowledged(false);
    rpc
      .call("inspectWorktree", { environmentId })
      .then((result) => {
        if (!cancelled) setPlan(result);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(messageOf(error));
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
    setBusy(true);
    setFailure(null);
    rpc
      .call("removeWorktree", {
        environmentId,
        deleteDirectory,
        acknowledged,
      })
      .then((result) => {
        if (!result.ok) {
          setFailure(result.message ?? "The workspace could not be removed.");
          return;
        }
        if (result.directory === "failed") {
          // The row is gone, so re-inspecting it would fail; say what is left
          // and let the user close this themselves.
          setLeftBehind(result.message ?? "The directory was not removed.");
          return;
        }
        onClose();
      })
      .catch((error: unknown) => setFailure(messageOf(error)))
      .finally(() => setBusy(false));
  };

  return (
    <PlainDialog
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      labelledBy={titleId}
      describedBy={descriptionId}
      className="w-[min(30rem,calc(100vw-2rem))]"
    >
      <div className="space-y-4 p-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <Icon name="Trash" className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 id={titleId} className="text-sm font-semibold text-foreground">
              Remove this worktree?
            </h2>
            <p
              id={descriptionId}
              className="mt-1 break-all text-xs leading-relaxed text-muted-foreground"
            >
              {label}
              {plan === null ? null : (
                <>
                  <br />
                  {plan.survey.path}
                  {plan.survey.branch === null ? null : ` · ${plan.survey.branch}`}
                </>
              )}
            </p>
          </div>
        </div>

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
                            name={warning.kind === "discard" ? "Trash" : "Hourglass"}
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
          <p className="rounded border border-destructive/30 bg-destructive/10 px-2 py-1 text-2xs text-destructive">
            {failure}
          </p>
        )}

        {leftBehind === null ? null : (
          <p className="rounded border border-border bg-muted/40 px-2 py-1 text-2xs text-muted-foreground">
            The row is gone, but the directory is still there: {leftBehind}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            autoFocus
            disabled={busy}
            onClick={onClose}
            className="h-8 rounded-md px-3 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          >
            {leftBehind === null ? "Cancel" : "Close"}
          </button>
          <button
            type="button"
            disabled={busy || blocker !== null || leftBehind !== null}
            onClick={submit}
            className="flex h-8 items-center gap-1.5 rounded-md bg-destructive px-3 text-xs font-semibold text-destructive-foreground hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          >
            {busy ? (
              <Icon
                name="Loading"
                className="size-3.5 animate-spin motion-reduce:animate-none"
                aria-hidden
              />
            ) : (
              <Icon name="Trash" className="size-3.5" aria-hidden />
            )}
            {deleteDirectory ? "Delete worktree" : "Remove worktree"}
          </button>
        </div>
      </div>
    </PlainDialog>
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
