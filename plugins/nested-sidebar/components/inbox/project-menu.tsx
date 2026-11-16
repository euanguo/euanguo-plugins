import type { ReactNode } from "react";
import { useState } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";

import { Button } from "@/components/ui/button";
import { DialogActions, Field } from "@/components/ui/control";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import {
  RowMenu,
  type RowMenuItem,
} from "@/components/inbox/row-context-menu";
import { copyWithAnnouncement } from "@/lib/ui/clipboard";
import type { ProjectGroup } from "@/lib/domain/groups";
import type { nestRpcContract } from "@/server/contract";

/**
 * Everything that can be done to a project, and the two dialogs that make the
 * irreversible ones deliberate.
 *
 * Split from the row itself so the row file stays about drawing: this is the
 * one place a project's name, group, archived shelf and removal are decided.
 * The menu opens on right-click like every other row's.
 */
export function ProjectRowMenu({
  projectId,
  projectName,
  projectPath,
  isPersonal,
  groups,
  currentGroupId,
  expanded,
  archivedShelfOn,
  removeBlockedReason,
  onToggleExpanded,
  onToggleArchivedShelf,
  onNewThread,
  onNewWorktree,
  onAssignGroup,
  children,
}: {
  projectId: string;
  projectName: string;
  projectPath: string | null;
  isPersonal: boolean;
  groups: readonly ProjectGroup[];
  currentGroupId: string | null;
  expanded: boolean;
  /** Whether this project's archived shelf is drawn. */
  archivedShelfOn: boolean;
  /** Why recursive project removal is unsafe from this display row. */
  removeBlockedReason: string | null;
  onToggleExpanded: () => void;
  onToggleArchivedShelf: () => void;
  onNewThread: () => void;
  onNewWorktree: () => void;
  onAssignGroup: (groupId: string | null) => void;
  children: ReactNode;
}) {
  const navigate = useBbNavigate();
  const [dialog, setDialog] = useState<"rename" | "remove" | null>(null);
  const currentGroupName =
    groups.find((group) => group.id === currentGroupId)?.name ?? "Ungrouped";

  const items: RowMenuItem[] = [
    { key: "new-thread", icon: "Plus", label: "New thread", onSelect: onNewThread },
  ];
  if (!isPersonal) {
    // The personal project has no checkout, and the worktree environment
    // provider requires one (`requires: { gitCheckout: true }`) — so a worktree
    // here is not a thing that can be created. Offering it would be a menu item
    // whose only outcome is a composer with no worktree in it.
    items.push({
      key: "new-worktree",
      icon: "GitBranch",
      label: "New worktree…",
      onSelect: onNewWorktree,
    });
  }
  items.push(
    {
      key: "disclose",
      icon: "ChevronDown",
      label: expanded ? "Collapse" : "Expand",
      separatorBefore: true,
      onSelect: onToggleExpanded,
    },
    /*
      The project's archive is a deliberate look, not a section that is always
      there: it costs a read, and most of the time the answer is "nothing". A
      checkbox rather than a label that flips, because the shelf stays on until
      it is turned off — the tick is the only thing that says so.
    */
    {
      key: "archived-shelf",
      icon: "Archive",
      label: "Show archived threads",
      checked: archivedShelfOn,
      onSelect: onToggleArchivedShelf,
    },
    {
      key: "rename",
      icon: "Edit",
      label: "Rename…",
      onSelect: () => setDialog("rename"),
    },
    // Membership is a rarer decision than acting on the project itself, so it
    // lives one level down instead of crowding this list — and it reports where
    // the project is now, so the menu does not have to be opened to find out.
    {
      key: "move-to-group",
      icon: "Layers",
      label: "Move to group",
      hint: currentGroupName,
      choices: [
        ...groups.map((group) => ({
          key: group.id,
          label: group.name,
          checked: group.id === currentGroupId,
          onSelect: () => onAssignGroup(group.id),
        })),
        {
          key: "ungrouped",
          label: "Ungrouped",
          checked: currentGroupId === null,
          onSelect: () => onAssignGroup(null),
        },
      ],
    },
    {
      key: "settings",
      icon: "Settings",
      label: "Project settings",
      onSelect: () => navigate.toProject(projectId),
    },
    {
      key: "copy-path",
      icon: "Copy",
      label: "Copy path",
      disabled: projectPath === null,
      onSelect: () => {
        if (projectPath !== null) {
          void copyWithAnnouncement(projectPath, "Path");
        }
      },
    },
    {
      key: "copy-id",
      icon: "IdCard",
      label: "Copy project ID",
      onSelect: () => {
        void copyWithAnnouncement(projectId, "Project ID");
      },
    },
    {
      key: "remove",
      icon: "Trash2",
      label: "Remove project…",
      separatorBefore: true,
      destructive: true,
      disabled: removeBlockedReason !== null,
      hint: removeBlockedReason ?? undefined,
      onSelect: () => setDialog("remove"),
    },
  );

  return (
    <RowMenu
      label={`Actions for ${projectName}`}
      items={items}
      dialog={
        <>
          {dialog === "rename" ? (
            <RenameProjectDialog
              projectId={projectId}
              currentName={projectName}
              onCancel={() => setDialog(null)}
              onRenamed={() => setDialog(null)}
            />
          ) : null}
          {dialog === "remove" && removeBlockedReason === null ? (
            <RemoveProjectDialog
              projectId={projectId}
              projectName={projectName}
              onCancel={() => setDialog(null)}
              onRemoved={() => setDialog(null)}
            />
          ) : null}
        </>
      }
    >
      {children}
    </RowMenu>
  );
}
function RenameProjectDialog({
  projectId,
  currentName,
  onCancel,
  onRenamed,
}: {
  projectId: string;
  currentName: string;
  onCancel: () => void;
  onRenamed: () => void;
}) {
  const rpc = useRpc<typeof nestRpcContract>();
  const [value, setValue] = useState(currentName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = value.trim();

  const submit = async () => {
    if (trimmed.length === 0 || trimmed === currentName) {
      onCancel();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await rpc.call("renameProject", { projectId, name: trimmed });
      onRenamed();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onCancel}
      busy={busy}
      icon="Edit"
      title="Rename project"
      width="26rem"
      footer={
        <DialogActions>
          <Button variant="ghost" size="sm"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button variant="default" size="sm"
            disabled={busy || trimmed.length === 0}
            onClick={() => void submit()}
          >
            {busy ? "Renaming…" : "Rename"}
          </Button>
        </DialogActions>
      }
    >
      <Field label="Project name">
        <Input
          autoFocus
          value={value}
          maxLength={120}
          disabled={busy}
          onChange={(event) => setValue(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submit();
            }
          }}
          className="w-full"
        />
      </Field>
      {error === null ? null : (
        <p className="mt-2 text-2xs text-destructive">{error}</p>
      )}
    </Modal>
  );
}

/**
 * Removing a project deletes its threads with it, so the dialog says so and
 * makes the user name the project. The name is sent with the request and
 * re-checked server-side, so a rename in between cannot delete the wrong thing.
 */
function RemoveProjectDialog({
  projectId,
  projectName,
  onCancel,
  onRemoved,
}: {
  projectId: string;
  projectName: string;
  onCancel: () => void;
  onRemoved: () => void;
}) {
  const rpc = useRpc<typeof nestRpcContract>();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmed = value.trim() === projectName;

  const submit = async () => {
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      const result = await rpc.call("removeProject", {
        projectId,
        expectedName: projectName,
      });
      if (!result.ok) {
        setError("This project changed. Reopen the menu and try again.");
        return;
      }
      onRemoved();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onCancel}
      busy={busy}
      icon="Trash2"
      title="Remove project?"
      width="26rem"
      footer={
        <DialogActions>
          <Button variant="ghost" size="sm"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button variant="destructive" size="sm"
            disabled={busy || !confirmed}
            onClick={() => void submit()}
          >
            {busy ? "Removing…" : "Remove project"}
          </Button>
        </DialogActions>
      }
    >
      <p className="text-xs leading-relaxed text-muted-foreground">
        This removes <span className="font-medium text-foreground">{projectName}</span>{" "}
        and all of its threads. This cannot be undone.
      </p>
      <Field label={`Type ${projectName} to confirm`} className="mt-3">
        <Input
          autoFocus
          value={value}
          disabled={busy}
          onChange={(event) => setValue(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && confirmed) {
              event.preventDefault();
              void submit();
            }
          }}
          className="w-full"
        />
      </Field>
      {error === null ? null : (
        <p className="mt-2 text-2xs text-destructive">{error}</p>
      )}
    </Modal>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "That did not work.";
}
