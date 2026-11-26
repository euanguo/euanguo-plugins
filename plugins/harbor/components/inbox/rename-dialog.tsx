import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { DialogActions, Field } from "@/components/ui/control";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { errorMessage } from "@/lib/domain/rpc-error";

export interface RenameDialogProps {
  readonly open?: boolean;
  readonly title: string;
  readonly subtitle?: string;
  readonly fieldLabel: string;
  readonly currentName: string;
  readonly maxLength?: number;
  readonly inputAriaLabel?: string;
  readonly errorFallback?: string;
  readonly onClose: () => void;
  readonly onSubmit: (nextName: string) => undefined | Promise<unknown>;
}

/**
 * Shared single-input rename dialog for groups, projects, features, and threads.
 */
export function RenameDialog({
  open = true,
  title,
  subtitle,
  fieldLabel,
  currentName,
  maxLength = 120,
  inputAriaLabel,
  errorFallback = "That did not work.",
  onClose,
  onSubmit,
}: RenameDialogProps) {
  const [value, setValue] = useState(currentName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValue(currentName);
    setError(null);
  }, [currentName, open]);

  const trimmed = value.trim();

  const submit = async () => {
    if (busy) return;
    if (trimmed.length === 0 || trimmed === currentName) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(trimmed);
      onClose();
    } catch (caught) {
      setError(errorMessage(caught, errorFallback));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      busy={busy}
      icon="Edit"
      title={title}
      subtitle={subtitle}
      width="26rem"
      footer={
        <DialogActions>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="default"
            size="sm"
            disabled={busy || trimmed.length === 0}
            onClick={() => void submit()}
          >
            {busy ? "Renaming…" : "Rename"}
          </Button>
        </DialogActions>
      }
    >
      <Field label={fieldLabel} error={error}>
        <Input
          autoFocus
          value={value}
          maxLength={maxLength}
          aria-label={inputAriaLabel}
          disabled={busy}
          onChange={(event) => setValue(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }}
          className="w-full"
        />
      </Field>
    </Modal>
  );
}
