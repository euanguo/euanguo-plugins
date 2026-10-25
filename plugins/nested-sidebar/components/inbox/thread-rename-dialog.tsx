import { useState } from "react";
import { useThreadActions } from "@/hooks/use-thread-actions";
import { Modal } from "@/components/ui/modal";

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
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="h-7 rounded-md px-2.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || trimmed.length === 0}
            onClick={() => void submit()}
            className="h-7 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40"
          >
            {busy ? "Renaming…" : "Rename"}
          </button>
        </div>
      }
    >
      <label className="grid gap-1 text-2xs text-muted-foreground">
        Thread title
        <input
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
          className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </label>
      {error === null ? null : (
        <p className="mt-2 text-2xs text-destructive">{error}</p>
      )}
    </Modal>
  );
}
