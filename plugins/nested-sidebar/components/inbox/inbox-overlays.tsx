import { BulkDeleteDialog } from "@/components/inbox/bulk-delete-dialog";
import { GroupManagerDialog } from "@/components/inbox/group-manager-dialog";
import { NewThreadDialog } from "@/components/inbox/new-thread-dialog";
import type { useNewThread } from "@/hooks/use-new-thread";
import type { BulkDeletePreview } from "@/lib/bulk-delete";
import type { ProjectGroup } from "@/lib/groups";
import type { ScopeIcons } from "@/lib/group-scope-icons";

export interface InboxOverlaysProps {
  readonly bulkDelete: {
    readonly preview: BulkDeletePreview | null;
    readonly busy: boolean;
    readonly close: () => void;
    readonly confirm: () => void;
  };
  readonly groups: {
    readonly open: boolean;
    readonly items: readonly ProjectGroup[];
    readonly icons: ScopeIcons;
    readonly close: () => void;
  };
  readonly newThread: ReturnType<typeof useNewThread>;
}

export function InboxOverlays({
  bulkDelete,
  groups,
  newThread,
}: InboxOverlaysProps) {
  return (
    <>
      <BulkDeleteDialog
        open={bulkDelete.preview !== null}
        preview={bulkDelete.preview}
        busy={bulkDelete.busy}
        onCancel={bulkDelete.close}
        onConfirm={bulkDelete.confirm}
      />
      <GroupManagerDialog
        open={groups.open}
        groups={groups.items}
        icons={groups.icons}
        onClose={groups.close}
      />
      <NewThreadDialog
        seed={newThread.seed}
        onClose={newThread.close}
        onCreated={newThread.created}
      />
    </>
  );
}
