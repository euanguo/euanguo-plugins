import { useState, type ReactNode } from "react";

import {
  InspectDetailsModal,
  buildWorkspaceInspectFields,
} from "@/components/inbox/inspect-details-modal";
import {
  RowMenu,
  type RowMenuChoice,
  type RowMenuItem,
} from "@/components/inbox/row-context-menu";
import {
  useTreeActions,
  useTreeLiveState,
} from "@/components/inbox/tree-row-handlers-context";
import { copyWithAnnouncement } from "@/lib/ui/clipboard";
import { pullRequestPresentation } from "@/lib/domain/pull-request-presentation";
import type { WorkspaceNode } from "@/lib/domain/tree";
import type { Workspace } from "@/lib/domain/workspace-index";
import { changeCountFor } from "@/lib/ui/workspace-change-counts";

export interface WorkspaceRowMenuProps {
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
  repoKey?: string | null;
  remoteUrl?: string | null;
  hostName?: string | null;
  onToggleExpanded: () => void;
  onRename: () => void;
  onArchiving: () => void;
  onRemoving: () => void;
  onInspectDetails?: () => void;
}

export function useWorkspaceRowMenuModel({
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
  repoKey = null,
  remoteUrl = null,
  hostName = null,
  onToggleExpanded,
  onRename,
  onArchiving,
  onRemoving,
  onInspectDetails,
}: WorkspaceRowMenuProps): {
  items: readonly RowMenuItem[];
  dialog: ReactNode;
} {
  const treeActions = useTreeActions();
  const live = useTreeLiveState();
  const [inspectOpen, setInspectOpen] = useState(false);

  const items: RowMenuItem[] = [
    {
      key: "new-thread",
      icon: "Plus",
      label: "New thread here",
      onSelect: () =>
        treeActions.onNewThreadInWorkspace({ node, projectId, projectName }),
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
  const feature = treeActions.featureOfWorkspace?.(node.ref) ?? null;
  if (feature?.byPath) {
    items.push({
      key: "feature",
      icon: "Layers",
      label: `Show in ${feature.name}`,
      separatorBefore: true,
      onSelect: () => treeActions.onRevealFeature?.(feature.id),
    });
  } else {
    if (
      node.ref.environmentId !== null &&
      treeActions.onAdoptWorkspace !== undefined &&
      (treeActions.adoptableFeatures?.length ?? 0) > 0
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
            onSelect: () => treeActions.onAdoptWorkspace?.(environmentId, null),
          },
          ...(treeActions.adoptableFeatures ?? []).map((candidate) => ({
            key: candidate.id,
            label: candidate.name,
            checked: current === candidate.id,
            onSelect: () => treeActions.onAdoptWorkspace?.(environmentId, candidate.id),
          })),
        ],
      });
    }
    if (
      node.ref.environmentId !== null &&
      treeActions.onPromoteWorkspace !== undefined
    ) {
      const environmentId = node.ref.environmentId;
      items.push({
        key: "promote-feature",
        icon: "Layers",
        label: "Promote to Feature…",
        separatorBefore: (treeActions.adoptableFeatures?.length ?? 0) === 0,
        onSelect: () =>
          treeActions.onPromoteWorkspace?.({
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
    treeActions.onActivateOrphanWorktree !== undefined
  ) {
    const hostId = node.ref.hostId;
    const orphanPath = node.ref.path;
    items.push({
      key: "activate-orphan",
      icon: "Play",
      label: "Activate & start chat",
      separatorBefore: true,
      onSelect: () =>
        treeActions.onActivateOrphanWorktree?.({
          hostId,
          projectId,
          path: orphanPath,
          branch,
        }),
    });
  }

  const resolvedRepoKey =
    repoKey ??
    ("repoKey" in node.ref && typeof node.ref.repoKey === "string"
      ? node.ref.repoKey
      : null);
  const copyChoices: RowMenuChoice[] = [
    {
      key: "copy-path",
      icon: "Folder",
      label: "Copy path",
      disabled: path === null,
      onSelect: () => {
        if (path !== null) void copyWithAnnouncement(path, "Path");
      },
    },
    {
      key: "copy-branch",
      icon: "GitBranch",
      label: "Copy branch",
      disabled: branch === null,
      onSelect: () => {
        if (branch !== null) void copyWithAnnouncement(branch, "Branch");
      },
    },
  ];
  if (node.ref.environmentId !== null) {
    const environmentId = node.ref.environmentId;
    copyChoices.push({
      key: "copy-environment",
      icon: "Copy",
      label: "Copy environment ID",
      onSelect: () => {
        void copyWithAnnouncement(environmentId, "Environment ID");
      },
    });
  }
  if (resolvedRepoKey !== null) {
    copyChoices.push({
      key: "copy-repository-id",
      icon: "Copy",
      label: "Copy repository ID",
      onSelect: () => {
        void copyWithAnnouncement(resolvedRepoKey, "Repository ID");
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
          setInspectOpen(true);
        }
      },
    },
  );

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

  const changes = changeCountFor(
    live.workspaceChanges,
    node.ref.environmentIds,
  );
  const pullRequest =
    node.ref.environmentIds
      .map((environmentId) => live.pullRequests.get(environmentId))
      .find((entry) => entry !== undefined) ?? null;
  const statusParts: string[] = [];
  if (changes !== null) {
    statusParts.push(
      changes.insertions === 0 && changes.deletions === 0
        ? "Clean"
        : `+${changes.insertions} -${changes.deletions}`,
    );
  }
  if (pullRequest !== null) {
    statusParts.push(
      `PR #${pullRequest.number} · ${pullRequestPresentation(pullRequest).label}`,
    );
  }
  statusParts.push(`${threadCount} ${threadCount === 1 ? "thread" : "threads"}`);
  if (workspaceRef.unseen === true) {
    statusParts.push("Not activated");
  }

  const dialog =
    onInspectDetails === undefined && inspectOpen ? (
      <InspectDetailsModal
        open
        onClose={() => setInspectOpen(false)}
        title={label}
        subtitle={projectName}
        icon={node.ref.kind === "git-worktree" ? "GitBranch" : "Folder"}
        fields={buildWorkspaceInspectFields({
          ref: node.ref,
          projectName,
          projectId,
          branch,
          path,
          status: statusParts.join(" · "),
          repoKey: resolvedRepoKey,
          remoteUrl,
          hostName,
        })}
      />
    ) : null;

  return { items, dialog };
}

export function WorkspaceRowMenu({
  children,
  ...props
}: WorkspaceRowMenuProps & { children: ReactNode }) {
  const { items, dialog } = useWorkspaceRowMenuModel(props);

  return (
    <RowMenu label={`Actions for ${props.label}`} items={items} dialog={dialog}>
      {children}
    </RowMenu>
  );
}
