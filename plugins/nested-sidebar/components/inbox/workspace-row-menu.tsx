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
   * Filing a worktree from outside any feature folder under a feature.
   *
   * A worktree inside a feature folder belongs to that feature by its path, and
   * the menu says so rather than offering a choice the path would overrule.
   * One outside every folder can be adopted — keyed by environment id, so only
   * a worktree that has one — and released the same way.
   */
  const feature = handlers.featureOfWorkspace?.(node.ref) ?? null;
  if (feature !== null && feature.byPath) {
    items.push({
      key: "feature",
      icon: "Tag",
      label: `Show in ${feature.name}`,
      separatorBefore: true,
      onSelect: () => handlers.onRevealFeature?.(feature.id),
    });
  } else if (
    node.ref.environmentId !== null &&
    handlers.onAdoptWorkspace !== undefined &&
    (handlers.adoptableFeatures?.length ?? 0) > 0
  ) {
    const environmentId = node.ref.environmentId;
    const current = feature?.id ?? null;
    items.push({
      key: "feature",
      icon: "Tag",
      label: "Feature",
      hint: feature?.name ?? "None",
      separatorBefore: true,
      choices: [
        {
          key: "__none__",
          label: "None",
          checked: current === null,
          onSelect: () => handlers.onAdoptWorkspace?.(environmentId, null),
        },
        ...(handlers.adoptableFeatures ?? []).map((candidate) => ({
          key: candidate.id,
          label: candidate.name,
          checked: current === candidate.id,
          onSelect: () => handlers.onAdoptWorkspace?.(environmentId, candidate.id),
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
