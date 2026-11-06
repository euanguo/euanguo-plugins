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
  /*
   * Filing a worktree under a feature.
   *
   * Only on a worktree with an environment, because a label is keyed by
   * environment id; a checkout without one has nothing stable to file. The
   * submenu carries the whole list plus "None", so moving a label and clearing
   * one are the same gesture.
   */
  if (
    node.ref.environmentId !== null &&
    handlers.onAssignFeature !== undefined &&
    handlers.features !== undefined &&
    handlers.features.length > 0
  ) {
    const environmentId = node.ref.environmentId;
    const current = handlers.featureLabels?.[environmentId] ?? null;
    items.push({
      key: "feature",
      icon: "Tag",
      label: "功能",
      hint:
        current === null
          ? "未归档"
          : (handlers.featureNameById?.get(current) ?? current),
      separatorBefore: true,
      choices: [
        {
          key: "__none__",
          label: "不属于任何功能",
          checked: current === null,
          onSelect: () => handlers.onAssignFeature?.(environmentId, null),
        },
        ...handlers.features.map((feature) => ({
          key: feature.id,
          label: feature.name,
          checked: current === feature.id,
          onSelect: () => handlers.onAssignFeature?.(environmentId, feature.id),
        })),
      ],
    });
  }
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
