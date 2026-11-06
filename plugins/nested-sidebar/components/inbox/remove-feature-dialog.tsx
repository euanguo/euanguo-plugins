import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";

import type { nestRpcContract } from "@/server/contract";
import { Modal } from "@/components/ui/modal";
import { DialogActions, Field } from "@/components/ui/control";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type Survey = {
  featureName: string;
  threadCount: number;
  warnings: readonly string[];
  requiresConfirmation: boolean;
};

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "That did not work.";
}

/**
 * Removing a feature, which takes its worktrees and its conversations with it.
 *
 * The pattern is the same one the other destructive dialogs in this sidebar
 * use: what will be lost is listed before the button, the button stays disabled
 * until the feature's own name is typed, and the server re-reads the survey
 * rather than trusting this dialog's copy.
 *
 * The typed name is the point of the exercise. A checkbox can be clicked
 * without reading; typing a name cannot.
 */
export function RemoveFeatureDialog({
  open,
  featureId,
  onClose,
  onRemoved,
}: {
  open: boolean;
  featureId: string | null;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const rpc = useRpc<typeof nestRpcContract>();
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || featureId === null) return;
    let cancelled = false;
    setSurvey(null);
    setLoadError(null);
    setValue("");
    setError(null);
    rpc
      .call("inspectFeatureRemoval", { featureId })
      .then((result) => {
        if (!cancelled) setSurvey(result);
      })
      .catch((failure: unknown) => {
        if (!cancelled) setLoadError(messageOf(failure));
      });
    return () => {
      cancelled = true;
    };
  }, [open, featureId, rpc]);

  const confirmed =
    survey !== null && value.trim() === survey.featureName.trim();

  const submit = () => {
    if (featureId === null || busy || !confirmed) return;
    setBusy(true);
    setError(null);
    rpc
      .call("deleteFeature", { featureId, acknowledged: true })
      .then((result) => {
        if (!result.ok) {
          setError("That did not work.");
          return;
        }
        onRemoved();
        onClose();
      })
      .catch((failure: unknown) => setError(messageOf(failure)))
      .finally(() => setBusy(false));
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title="Remove feature?"
      subtitle={survey?.featureName}
      icon="Trash2"
      tone="destructive"
      busy={busy}
      width="30rem"
      footer={
        <DialogActions>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={busy || !confirmed}
            onClick={submit}
          >
            {busy ? "Removing…" : "Remove feature"}
          </Button>
        </DialogActions>
      }
    >
      {loadError === null ? null : (
        <p className="text-xs text-destructive">{loadError}</p>
      )}
      {survey === null ? (
        loadError === null ? (
          <p className="text-xs text-muted-foreground">Reading what is here…</p>
        ) : null
      ) : (
        <>
          <p className="text-xs leading-relaxed text-muted-foreground">
            This removes{" "}
            <span className="font-medium text-foreground">
              {survey.featureName}
            </span>{" "}
            and every worktree it created. This cannot be undone.
          </p>
          {survey.warnings.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Nothing uncommitted is in its worktrees.
            </p>
          ) : (
            <ul className="mt-2 grid gap-0.5">
              {survey.warnings.map((warning) => (
                <li key={warning} className="text-xs text-foreground">
                  {warning}
                </li>
              ))}
            </ul>
          )}
          <Field
            label={`Type ${survey.featureName} to confirm`}
            className="mt-3"
          >
            <Input
              autoFocus
              value={value}
              disabled={busy}
              onChange={(event) => setValue(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && confirmed) {
                  event.preventDefault();
                  submit();
                }
              }}
            />
          </Field>
          {error === null ? null : (
            <p className="mt-2 text-2xs text-destructive">{error}</p>
          )}
        </>
      )}
    </Modal>
  );
}
