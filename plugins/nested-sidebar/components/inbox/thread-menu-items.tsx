import { useState, type ReactNode } from "react";
import {
  useSdk,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { useThreadActions } from "@/hooks/use-thread-actions";
import { copyWithAnnouncement } from "@/lib/clipboard";
import { threadLinkUrl } from "@/lib/thread-link";
import { threadDisplayTitle } from "@/lib/inbox";
import { ThreadRenameDialog } from "@/components/inbox/thread-rename-dialog";
import { RowMenu, type RowMenuItem } from "@/components/inbox/row-context-menu";
import { resolveSnoozePresets } from "@/lib/lifecycle";
import { Modal } from "@/components/ui/modal";
import { DialogActions } from "@/components/ui/control";
import { Button } from "@/components/ui/button";

/**
 * One thread action, described once and drawn by the one menu.
 *
 * The items are shared by every thread row — the family's card, a child row, and
 * a parked row on a shelf — so a new action is written once and appears
 * everywhere, instead of being added to one row and silently missing from the
 * rest. `RowMenuItem` is the side bar's whole menu vocabulary, so a thread item
 * and a project item are the same kind of thing.
 *
 * The set matches bb's own thread menu. Copying is deliberately two items:
 * the link is what a person pastes into a chat, and the id is what a person
 * pastes into a command or a bug report. bb offers the link alone, so the id is
 * additive here.
 */
export type ThreadMenuItem = RowMenuItem;

export interface ThreadMenuActions {
  readonly items: readonly ThreadMenuItem[];
  /** Mounted by the caller so the confirmation outlives the menu. */
  readonly dialog: ReactNode;
}

export function useThreadMenuActions({
  thread,
  expanded,
  childCount,
  canToggleChildren,
  onToggleChildren,
  onSettle,
  onSnooze,
  canPark,
  onUnarchive,
  splitAvailable,
}: {
  thread: PluginSidebarThread;
  expanded: boolean;
  childCount: number;
  canToggleChildren: boolean;
  onToggleChildren: () => void;
  onSettle: () => void;
  onSnooze: (snoozedUntil: number) => void;
  canPark: boolean;
  /**
   * Restore an archived thread. The SDK exposes `archive` but no inverse, so
   * the plugin's own lifecycle owns the restore and hands it in. Absent for a
   * thread that is not archived.
   */
  onUnarchive?: () => void;
  /**
   * Whether this thread can open in a split pane. Passed in rather than read
   * here because the caller already subscribes for its own drag support, and a
   * second subscription per row is a cost with no benefit.
   */
  splitAvailable: boolean;
}): ThreadMenuActions {
  const actions = useThreadActions();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const tomorrow = () => {
    const preset = resolveTomorrow();
    if (preset !== null) onSnooze(preset);
  };

  const items: ThreadMenuItem[] = [];
  if (canToggleChildren) {
    items.push({
      key: "children",
      icon: "ChevronDown",
      label: `${expanded ? "Hide" : "Show"} ${childCount} child${childCount === 1 ? "" : "ren"}`,
      onSelect: onToggleChildren,
    });
  }
  if (splitAvailable) {
    items.push({
      key: "split",
      icon: "ArrowRight",
      label: "Open in split",
      onSelect: () => actions.open(thread.id, { split: true }),
    });
  }
  items.push(
    {
      key: "copy-link",
      icon: "CopyLink",
      label: "Copy thread link",
      separatorBefore: items.length > 0,
      onSelect: () => {
        void copyWithAnnouncement(
          threadLinkUrl(thread.projectId, thread.id),
          "Thread link",
        );
      },
    },
    {
      key: "copy-id",
      icon: "IdCard",
      label: "Copy thread ID",
      onSelect: () => {
        void copyWithAnnouncement(thread.id, "Thread ID");
      },
    },
    {
      key: "read",
      icon: thread.isUnread ? "Eye" : "CircleQuestion",
      label: thread.isUnread ? "Mark read" : "Mark unread",
      separatorBefore: true,
      onSelect: () => void actions.setRead(thread.id, thread.isUnread),
    },
    {
      key: "pin",
      icon: thread.isPinned ? "PinOff" : "Pin",
      label: thread.isPinned ? "Unpin" : "Pin",
      onSelect: () => void actions.setPinned(thread.id, !thread.isPinned),
    },
    {
      key: "rename",
      icon: "Edit",
      label: "Rename…",
      separatorBefore: true,
      onSelect: () => setRenaming(true),
    },
  );

  if (canPark) {
    items.push(
      {
        key: "snooze",
        icon: "Clock",
        label: "Snooze until tomorrow",
        onSelect: tomorrow,
      },
      {
        key: "settle",
        icon: "Archive",
        label: "Settle thread",
        onSelect: onSettle,
      },
    );
  }

  items.push(
    thread.isArchived && onUnarchive !== undefined
      ? {
          key: "unarchive",
          icon: "ArchiveRestore",
          label: "Unarchive",
          separatorBefore: true,
          onSelect: onUnarchive,
        }
      : {
          key: "archive",
          icon: "Archive",
          label: "Archive",
          separatorBefore: true,
          onSelect: () => actions.archive(thread.id),
        },
    {
      key: "delete",
      icon: "Trash",
      label: "Delete…",
      destructive: true,
      onSelect: () => setDeleting(true),
    },
  );

  return {
    items,
    dialog: renaming ? (
        <ThreadRenameDialog
          threadId={thread.id}
          currentTitle={threadDisplayTitle(thread)}
          onClose={() => setRenaming(false)}
        />
      ) : deleting ? (
        <DeleteThreadDialog
          thread={thread}
          childCount={childCount}
          onClose={() => setDeleting(false)}
        />
      ) : null,
  };
}

function DeleteThreadDialog({
  thread,
  childCount,
  onClose,
}: {
  thread: PluginSidebarThread;
  childCount: number;
  onClose: () => void;
}) {
  const sdk = useSdk();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = threadDisplayTitle(thread);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await sdk.threads.delete({
        threadId: thread.id,
        childThreadsConfirmed: true,
      });
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      icon="Trash"
      title="Delete thread?"
      width="26rem"
      footer={
        <DialogActions>
          <Button variant="ghost" size="sm"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button variant="destructive" size="sm"
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? "Deleting…" : "Delete thread"}
          </Button>
        </DialogActions>
      }
    >
      <p className="text-xs leading-relaxed text-muted-foreground">
        This deletes <span className="font-medium text-foreground">{title}</span>
        {childCount === 0
          ? "."
          : ` and ${childCount} child thread${childCount === 1 ? "" : "s"}.`}{" "}
        This cannot be undone.
      </p>
      {error === null ? null : (
        <p className="mt-2 text-2xs text-destructive">{error}</p>
      )}
    </Modal>
  );
}

/**
 * The tomorrow preset, or null when the clock cannot produce one. Kept out of
 * the hook body so the two callers that need it (menu and keyboard) agree.
 */
function resolveTomorrow(): number | null {
  const preset = resolveSnoozePresets(new Date()).find(
    (candidate) => candidate.id === "tomorrow",
  );
  return preset === undefined ? null : preset.snoozedUntil;
}

/**
 * A thread row's menu, wired to the sidebar's one menu surface.
 *
 * A component rather than a hook so the three thread rows — a family's card, a
 * child row, and a parked row on a shelf — cannot each invent their own props
 * for it. The items and the confirmation are the only thread-specific parts;
 * `RowMenu` draws them, so every row in the tree opens a menu the same way.
 */
export function ThreadRowMenu({
  thread,
  expanded = false,
  childCount = 0,
  canToggleChildren = false,
  onToggleChildren,
  onSettle,
  onSnooze,
  canPark = false,
  onUnarchive,
  splitAvailable = false,
  children,
}: {
  thread: PluginSidebarThread;
  expanded?: boolean;
  childCount?: number;
  canToggleChildren?: boolean;
  onToggleChildren?: () => void;
  onSettle?: () => void;
  onSnooze?: (snoozedUntil: number) => void;
  canPark?: boolean;
  onUnarchive?: () => void;
  splitAvailable?: boolean;
  children: ReactNode;
}) {
  const { items, dialog } = useThreadMenuActions({
    thread,
    expanded,
    childCount,
    canToggleChildren,
    onToggleChildren: onToggleChildren ?? (() => undefined),
    onSettle: onSettle ?? (() => undefined),
    onSnooze: onSnooze ?? (() => undefined),
    canPark,
    onUnarchive,
    splitAvailable,
  });

  return (
    <RowMenu
      label={`Actions for ${threadDisplayTitle(thread)}`}
      items={items}
      dialog={dialog}
    >
      {children}
    </RowMenu>
  );
}
