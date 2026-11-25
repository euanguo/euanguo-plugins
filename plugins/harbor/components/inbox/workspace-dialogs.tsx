import { Button } from "@/components/ui/button";
import { DialogActions } from "@/components/ui/control";
import { Modal } from "@/components/ui/modal";

export function ArchiveWorkspaceDialog({
  label,
  threadIds,
  onCancel,
  onArchive,
}: {
  label: string;
  threadIds: readonly string[];
  onCancel: () => void;
  onArchive: () => void;
}) {
  return (
    <Modal
      open
      onClose={onCancel}
      icon="Archive"
      title={`Archive threads in ${label}`}
      width="28rem"
      footer={
        <DialogActions>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="default" size="sm" onClick={onArchive}>
            Archive
          </Button>
        </DialogActions>
      }
    >
      <p className="text-xs leading-relaxed text-muted-foreground">
        This archives {threadIds.length}{" "}
        {threadIds.length === 1 ? "thread family" : "thread families"} and their
        child agents. You can unarchive them from bb at any time.
      </p>
    </Modal>
  );
}
