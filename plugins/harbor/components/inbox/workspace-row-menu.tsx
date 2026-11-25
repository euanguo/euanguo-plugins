import type { ReactNode } from "react";

import {
  RowMenu,
  type RowMenuItem,
} from "@/components/inbox/row-context-menu";
import { useTreeRowHandlers } from "@/components/inbox/tree-row-handlers-context";
import { copyWithAnnouncement } from "@/lib/ui/clipboard";
import type { WorkspaceNode } from "@/lib/domain/tree";
import type { Workspace } from "@/lib/domain/workspace-index";

export function WorkspaceRowMenu({
  label,
  node,
  projectId,
  projectName,
  branch,
  path,
  expanded,
  disclosable = true,
  canRename,
  canRemove,
  threadCount,
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
  /** False where the row has nothing to open, as in the workspaces view. */
  disclosable?: boolean;
  canRename: boolean;
  canRemove: boolean;
  threadCount: number;
  onToggleExpanded: () => void;
  onRename: () => void;
  onArchiving: () => void;
  onRemoving: () => void;
  children: ReactNode;
}) {
  /** The row's own handlers, not a second copy threaded through props. */
  const handlers = useTreeRowHandlers();
  const items: RowMenuItem[] = [
    {
      key: "new-thread",
      icon: "Plus",
      label: "New thread here",
      onSelect: () =>
        handlers.onNewThreadInWorkspace({ node, projectId, projectName }),
    },
    ...(disclosable
      ? [
          {
            key: "disclose",
            icon: "ChevronDown" as const,
            label: expanded ? "Collapse" : "Expand",
            onSelect: onToggleExpanded,
          },
        ]
      : []),
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
  if (feature?.byPath) {
    items.push({
      key: "feature",
      icon: "Layers",
      label: `Show in ${feature.name}`,
      separatorBefore: true,
      onSelect: () => handlers.onRevealFeature?.(feature.id),
    });
  } else {
    if (
      node.ref.environmentId !== null &&
      handlers.onAdoptWorkspace !== undefined &&
      (handlers.adoptableFeatures?.length ?? 0) > 0
    ) {
      const environmentId = node.ref.environmentId;
      const current = feature?.id ?? null;
      items.push({
        key: "feature",
        icon: "Layers",
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
    if (
      node.ref.environmentId !== null &&
      handlers.onPromoteWorkspace !== undefined
    ) {
      const environmentId = node.ref.environmentId;
      items.push({
        key: "promote-feature",
        icon: "Layers",
        label: "Promote to Feature…",
        separatorBefore: (handlers.adoptableFeatures?.length ?? 0) === 0,
        onSelect: () =>
          handlers.onPromoteWorkspace?.({
            environmentId,
            workspaceLabel: label,
            branch,
            projectId,
          }),
      });
    }
  }
  const workspaceRef = node.ref as Workspace;
  if (
    workspaceRef.unseen === true &&
    node.ref.environmentId === null &&
    node.ref.path !== null &&
    node.ref.hostId !== null &&
    handlers.onActivateOrphanWorktree !== undefined
  ) {
    const hostId = node.ref.hostId;
    const orphanPath = node.ref.path;
    items.push({
      key: "activate-orphan",
      icon: "Play",
      label: "Activate & start chat",
      separatorBefore: true,
      onSelect: () =>
        handlers.onActivateOrphanWorktree?.({
          hostId,
          projectId,
          path: orphanPath,
          branch,
        }),
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
        icon: "Copy",
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
