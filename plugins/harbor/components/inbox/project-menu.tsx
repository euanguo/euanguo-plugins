import { useState, type ReactNode } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";

import { Button } from "@/components/ui/button";
import { DialogActions, Field } from "@/components/ui/control";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import {
  InspectDetailsModal,
  buildProjectInspectFields,
} from "@/components/inbox/inspect-details-modal";
import {
  RowMenu,
  type RowMenuChoice,
  type RowMenuItem,
} from "@/components/inbox/row-context-menu";
import { RenameDialog } from "@/components/inbox/rename-dialog";
import { errorMessage } from "@/lib/domain/rpc-error";
import { copyWithAnnouncement } from "@/lib/ui/clipboard";
import type { ProjectGroup } from "@/lib/domain/groups";
import type { harborRpcContract } from "@/server/contract";

export interface ProjectRowMenuProps {
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
  repoKey?: string | null;
  remoteUrl?: string | null;
  hostName?: string | null;
  statusSummary?: string | null;
  onToggleExpanded: () => void;
  onToggleArchivedShelf: () => void;
  onNewThread: () => void;
  onNewWorktree: () => void;
  onAssignGroup: (groupId: string | null) => void;
  onInspectDetails?: () => void;
}

export function useProjectRowMenuModel({
  projectId,
  projectName,
  projectPath,
  isPersonal,
  groups,
  currentGroupId,
  expanded,
  archivedShelfOn,
  removeBlockedReason,
  repoKey = null,
  remoteUrl = null,
  hostName = null,
  statusSummary = null,
  onToggleExpanded,
  onToggleArchivedShelf,
  onNewThread,
  onNewWorktree,
  onAssignGroup,
  onInspectDetails,
}: ProjectRowMenuProps): {
  items: readonly RowMenuItem[];
  dialog: ReactNode;
} {
  const navigate = useBbNavigate();
  const [dialogKind, setDialogKind] = useState<
    "rename" | "remove" | "inspect" | null
  >(null);
  const currentGroupName =
    groups.find((group) => group.id === currentGroupId)?.name ?? "Ungrouped";

  const items: RowMenuItem[] = [
    { key: "new-thread", icon: "Plus", label: "New thread", onSelect: onNewThread },
  ];
  if (!isPersonal) {
    // The personal project has no checkout, and the worktree environment
    // provider requires one (`requires: { gitCheckout: true }`) — so a worktree
    // here is not a thing that can be created.
    items.push({
      key: "new-worktree",
      icon: "GitBranch",
      label: "New worktree…",
      onSelect: onNewWorktree,
    });
  }

  const copyChoices: RowMenuChoice[] = [
    {
      key: "copy-path",
      icon: "Folder",
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
      icon: "Copy",
      label: "Copy project ID",
      onSelect: () => {
        void copyWithAnnouncement(projectId, "Project ID");
      },
    },
  ];
  if (repoKey !== null) {
    copyChoices.push({
      key: "copy-repository-id",
      icon: "Copy",
      label: "Copy repository ID",
      onSelect: () => {
        void copyWithAnnouncement(repoKey, "Repository ID");
      },
    });
  }
  if (remoteUrl !== null) {
    copyChoices.push({
      key: "copy-remote-url",
      icon: "Link",
      label: "Copy remote URL",
      onSelect: () => {
        void copyWithAnnouncement(remoteUrl, "Remote URL");
      },
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
      onSelect: () => setDialogKind("rename"),
    },
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
      key: "copy",
      icon: "Copy",
      label: "Copy",
      separatorBefore: true,
      choices: copyChoices,
    },
    {
      key: "inspect-details",
      icon: "Info",
      label: "Inspect details…",
      onSelect: () => {
        if (onInspectDetails !== undefined) {
          onInspectDetails();
        } else {
          setDialogKind("inspect");
        }
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
      onSelect: () => setDialogKind("remove"),
    },
  );

  const rpc = useRpc<typeof harborRpcContract>();
  const dialog = (
    <>
      {dialogKind === "rename" ? (
        <RenameDialog
          open
          title="Rename project"
          fieldLabel="Project name"
          currentName={projectName}
          maxLength={120}
          onClose={() => setDialogKind(null)}
          onSubmit={(next) => rpc.call("renameProject", { projectId, name: next })}
        />
      ) : null}
      {dialogKind === "remove" && removeBlockedReason === null ? (
        <RemoveProjectDialog
          projectId={projectId}
          projectName={projectName}
          onCancel={() => setDialogKind(null)}
          onRemoved={() => setDialogKind(null)}
        />
      ) : null}
      {dialogKind === "inspect" && onInspectDetails === undefined ? (
        <InspectDetailsModal
          open
          onClose={() => setDialogKind(null)}
          title={projectName}
          subtitle={currentGroupName}
          icon="Folder"
          fields={buildProjectInspectFields({
            projectId,
            projectName,
            projectPath,
            isPersonal,
            groupName: currentGroupName,
            repoKey,
            remoteUrl,
            hostName,
            status: statusSummary,
          })}
        />
      ) : null}
    </>
  );

  return { items, dialog };
}

/**
 * Everything that can be done to a project, and the dialogs that make
 * inspection, rename, and removal deliberate.
 */
export function ProjectRowMenu({
  children,
  ...props
}: ProjectRowMenuProps & { children: ReactNode }) {
  const { items, dialog } = useProjectRowMenuModel(props);

  return (
    <RowMenu
      label={`Actions for ${props.projectName}`}
      items={items}
      dialog={dialog}
    >
      {children}
    </RowMenu>
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
  const rpc = useRpc<typeof harborRpcContract>();
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
      setError(errorMessage(caught, "That did not work."));
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
          <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={busy || !confirmed}
            onClick={() => void submit()}
          >
            {busy ? "Removing…" : "Remove project"}
          </Button>
        </DialogActions>
      }
    >
      <p className="text-xs leading-relaxed text-muted-foreground">
        This removes{" "}
        <span className="font-medium text-foreground">{projectName}</span> and
        all of its threads. This cannot be undone.
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
