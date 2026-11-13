import { experimental_useArchiveEnvironmentThreads as useArchiveEnvironmentThreads } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";

import { Icon } from "@/components/ui/icon";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { copyTextToClipboard } from "@/lib/clipboard";
import type { Workspace } from "@/lib/workspace-index";

/**
 * The workspace-level actions, kept out of the tab strip's own width.
 *
 * Archiving every conversation is bb's own bulk archive, so its undo stays the
 * one bb ships. Removing the worktree is a separate act from archiving its
 * conversations, and it only appears for a directory that is one; the dialog
 * that follows is the same safety survey the sidebar's row uses. Copying the
 * path is the quiet one.
 */
export function WorkspaceMenu({
  workspace,
  environmentId,
  onRemoveWorktree,
}: {
  workspace: Workspace;
  /** The pane's environment, when the workspace has no canonical record. */
  environmentId: string | null;
  onRemoveWorktree(): void;
}) {
  const archiveEnvironmentThreads = useArchiveEnvironmentThreads();
  const targetEnvironmentId =
    workspace.canonicalEnvironmentId ?? environmentId;
  const isWorktree = workspace.kind === "git-worktree";

  return (
    <Menu
      label="Workspace actions"
      trigger={
        <button
          type="button"
          aria-label="Workspace actions"
          title="Workspace actions"
          className="inline-flex size-7 shrink-0 items-center justify-center self-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground"
        >
          <Icon name="MoreHorizontal" className="size-4" />
        </button>
      }
    >
      <MenuItem
        icon="Archive"
        label="Archive all conversations"
        disabled={targetEnvironmentId === null}
        onSelect={() => {
          if (targetEnvironmentId === null) return;
          void archiveEnvironmentThreads(targetEnvironmentId).catch(() =>
            toast.error("Could not archive these conversations."),
          );
        }}
      />
      {isWorktree && targetEnvironmentId !== null ? (
        <MenuItem
          icon="Trash2"
          label="Remove worktree…"
          destructive
          onSelect={onRemoveWorktree}
        />
      ) : null}
      <MenuSeparator />
      <MenuItem
        icon="Copy"
        label="Copy path"
        disabled={workspace.path === null}
        onSelect={() => {
          if (workspace.path === null) return;
          void copyTextToClipboard(workspace.path).then((copied) => {
            if (copied) toast.success("Copied the workspace path.");
            else toast.error("Could not copy the workspace path.");
          });
        }}
      />
    </Menu>
  );
}
