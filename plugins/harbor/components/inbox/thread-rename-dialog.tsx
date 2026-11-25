import { useState } from "react";
import { useThreadActions } from "@/hooks/use-thread-actions";
import { Modal } from "@/components/ui/modal";
import { DialogActions, Field } from "@/components/ui/control";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * Rename a thread through bb's own field.
 *
 * bb's sidebar renames inline, but its inline editor sits in a title element
 * this sidebar draws differently at every level. The action itself is a silent
 * write on the SDK, so the plugin owns the one thing the SDK leaves to it: the
 * way to collect the new name. A dialog keeps that identical to how a project
 * and a group already rename here.
 */
export function ThreadRenameDialog({
  threadId,
  currentTitle,
  onClose,
}: {
  threadId: string;
  currentTitle: string;
  onClose: () => void;
}) {
  const actions = useThreadActions();
  const [value, setValue] = useState(currentTitle);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = value.trim();

  const submit = async () => {
    if (trimmed.length === 0 || trimmed === currentTitle) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await actions.rename(threadId, trimmed);
      onClose();
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message.trim()
          ? caught.message
          : "Could not rename the thread.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      icon="Edit"
      title="Rename thread"
      width="26rem"
      footer={
        <DialogActions>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm"
            variant="default"
            disabled={busy || trimmed.length === 0}
            onClick={() => void submit()}
          >
            {busy ? "Renaming…" : "Rename"}
          </Button>
        </DialogActions>
      }
    >
      <Field label="Thread title" error={error}>
        <Input
          autoFocus
          value={value}
          maxLength={200}
          disabled={busy}
          onChange={(event) => setValue(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submit();
            }
          }}
        />
      </Field>
    </Modal>
  );
}
