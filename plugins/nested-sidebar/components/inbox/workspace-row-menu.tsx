import type { ReactNode } from "react";

import {
  RowMenu,
  type RowMenuItem,
} from "@/components/inbox/row-context-menu";
import type { TreeRowHandlers } from "@/components/inbox/tree-row-types";
import { copyWithAnnouncement } from "@/lib/clipboard";
import type { WorkspaceNode } from "@/lib/tree";

export function WorkspaceRowMenu({
  label,
  node,
  projectId,
  projectName,
  branch,
  path,
  expanded,
  canRename,
  canRemove,
  threadCount,
  handlers,
  onToggleExpanded,
  onRename,
  onArchiving,
  onRemoving,
  children,
}: {
  label: string;
  node: WorkspaceNode;
  projectId: string;
  projectName: string;
  branch: string | null;
  path: string | null;
  expanded: boolean;
  canRename: boolean;
  canRemove: boolean;
  threadCount: number;
  handlers: TreeRowHandlers;
  onToggleExpanded: () => void;
  onRename: () => void;
  onArchiving: () => void;
  onRemoving: () => void;
  children: ReactNode;
}) {
  const items: RowMenuItem[] = [
    {
      key: "new-thread",
      icon: "Plus",
      label: "New thread here",
      onSelect: () =>
        handlers.onNewThreadInWorkspace({ node, projectId, projectName }),
    },
    {
      key: "disclose",
      icon: "ChevronDown",
      label: expanded ? "Collapse" : "Expand",
      onSelect: onToggleExpanded,
    },
    {
      key: "rename",
      icon: "Edit",
      label:
        node.ref.kind === "git-worktree"
          ? "Rename worktree…"
          : "Rename workspace…",
      disabled: !canRename,
      onSelect: onRename,
    },
  ];
  if (node.ref.environmentId !== null) {
    const environmentId = node.ref.environmentId;
    items.push(
      {
        key: "copy-path",
        icon: "Copy",
        label: "Copy path",
        separatorBefore: true,
        disabled: path === null,
        onSelect: () => {
          if (path !== null) void copyWithAnnouncement(path, "Path");
        },
      },
      {
        key: "copy-branch",
        icon: "Copy",
        label: "Copy branch",
        disabled: branch === null,
        onSelect: () => {
          if (branch !== null) void copyWithAnnouncement(branch, "Branch");
        },
      },
      {
        key: "copy-environment",
        icon: "IdCard",
        label: "Copy environment ID",
        onSelect: () => {
          void copyWithAnnouncement(environmentId, "Environment ID");
        },
      },
    );
  }
  if (threadCount > 0) {
    items.push({
      key: "archive",
      icon: "Archive",
      label: "Archive threads here",
      separatorBefore: true,
      onSelect: onArchiving,
    });
  }
  items.push({
    key: "remove",
    icon: "Trash2",
    label: "Remove worktree…",
    separatorBefore: true,
    disabled: !canRemove,
    onSelect: onRemoving,
  });

  return (
    <RowMenu label={`Actions for ${label}`} items={items}>
      {children}
    </RowMenu>
  );
}
