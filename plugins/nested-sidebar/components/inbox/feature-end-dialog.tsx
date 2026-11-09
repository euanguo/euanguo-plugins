import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";

import type { nestRpcContract } from "@/server/contract";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogActions, Field } from "@/components/ui/control";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import type { Feature } from "@/lib/features";

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
 * **Delete** does all of that and removes the folder, and the branches Nest
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
  const rpc = useRpc<typeof nestRpcContract>();
  const open = mode !== null && feature !== null;
  const [deleteBranches, setDeleteBranches] = useState(false);
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTyped("");
    setError(null);
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
        if (!cancelled) setLoadError(messageOf(failure));
      });
    return () => {
      cancelled = true;
    };
  }, [deleteBranches, feature, mode, open, rpc]);

  if (!open || feature === null || mode === null) return null;

  const needsName = survey?.requiresConfirmation === true;
  const ready = survey !== null && (!needsName || typed.trim() === feature.name);

  const submit = () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const request =
      mode === "finish"
        ? rpc.call("finishFeature", { featureId: feature.id, acknowledged: true })
        : rpc.call("deleteFeature", {
            featureId: feature.id,
            acknowledged: true,
            deleteBranches,
          });
    request
      .then((result) => {
        if (result.leftovers.length > 0) {
          setError(`Could not remove ${result.leftovers.join(", ")}. They are still on disk.`);
          return;
        }
        onClose();
      })
      .catch((failure: unknown) => setError(messageOf(failure)))
      .finally(() => setBusy(false));
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
        <DialogActions>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={finishing ? "default" : "destructive"}
            size="sm"
            disabled={busy || !ready}
            onClick={submit}
          >
            {busy
              ? finishing
                ? "Finishing…"
                : "Deleting…"
              : finishing
                ? "Finish feature"
                : "Delete feature"}
          </Button>
        </DialogActions>
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
          <label className="flex cursor-pointer items-center gap-2 text-foreground">
            <Checkbox
              checked={deleteBranches}
              disabled={busy || survey?.createdBranches === 0}
              onCheckedChange={(value) => setDeleteBranches(value === true)}
            />
            <span>
              {survey === null || survey.createdBranches === 0
                ? "Keep every branch — none of these were created by Nest"
                : `Also delete the ${survey.createdBranches} ${survey.createdBranches === 1 ? "branch" : "branches"} Nest created`}
            </span>
          </label>
        )}
        {loadError !== null ? (
          <p className="text-destructive">{loadError}</p>
        ) : survey === null ? (
          <p className="text-muted-foreground">Reading what is in it…</p>
        ) : survey.warnings.length === 0 ? (
          <p className="text-muted-foreground">Nothing uncommitted would be lost.</p>
        ) : (
          <ul className="grid gap-0.5 rounded-md border border-border px-2 py-1.5">
            {survey.warnings.map((warning) => (
              <li key={warning} className={needsName ? "text-destructive" : "text-foreground"}>
                {warning}
              </li>
            ))}
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
        {error === null ? null : <p className="text-2xs text-destructive">{error}</p>}
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

function messageOf(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : "That did not work.";
}
