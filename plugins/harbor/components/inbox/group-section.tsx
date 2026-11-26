import { useId, useState, type ReactNode } from "react";
import { RenameDialog } from "@/components/inbox/rename-dialog";
import { useThreadActions } from "@/hooks/use-thread-actions";
import { GroupIcon } from "@/components/ui/group-icon";
import { copyWithAnnouncement } from "@/lib/ui/clipboard";
import {
  RowActions,
  RowDisclosure,
} from "@/components/inbox/row-actions";
import {
  RowMenu,
  type RowMenuItem,
} from "@/components/inbox/row-context-menu";
import { RollupJump } from "@/components/inbox/rollup-badge";
import { useHarborViewState } from "@/components/inbox/view-state-context";
import { useListAutoAnimate } from "@/hooks/use-list-auto-animate";
import {
  UNGROUPED_SCOPE_KEY,
  machineSectionCollapseKey,
} from "@/lib/ui/view-state";
import {
  ProjectNode as ProjectNodeView,
} from "@/components/inbox/project-node";
import { useTreeActions } from "@/components/inbox/tree-row-handlers-context";
import type { GroupNode } from "@/lib/domain/tree";
import type { ProjectGroup } from "@/lib/domain/groups";
import type { ProjectIcon } from "@/lib/domain/project-icons";

/**
 * One group or machine section: the header row plus the projects filed under it.
 *
 * When expanded, the group's own rollup pill is hidden so its count does not
 * repeat the open project rows directly beneath it; when collapsed, a single
 * rollup pill answers whether anything inside needs attention.
 */
export function GroupSection({
  node,
  groups,
  groupKind = "group",
  groupAssignment,
  onAssignGroup,
  onNewThreadInProject,
  onNewWorktree,
  projectColorOverrides,
  projectIcons,
  projectReorder,
}: {
  node: GroupNode;
  groups: readonly ProjectGroup[];
  groupKind?: "group" | "machine";
  groupAssignment?: Readonly<Record<string, string>>;
  onAssignGroup: (projectId: string, groupId: string | null) => void;
  onNewThreadInProject: (projectId: string, projectName: string) => void;
  onNewWorktree: (projectId: string, projectName: string) => void;
  projectColorOverrides: ReadonlyMap<string, string>;
  projectIcons: ReadonlyMap<string, ProjectIcon>;
  projectReorder: {
    enabled: boolean;
    next: (projectId: string, delta: -1 | 1) => void;
    drop: (
      sourceProjectId: string,
      targetProjectId: string,
      position: "before" | "after",
    ) => void;
  };
}) {
  const treeActions = useTreeActions();
  const actions = useThreadActions();
  const viewState = useHarborViewState();
  const isMachine = groupKind === "machine";
  const groupKey = isMachine
    ? machineSectionCollapseKey(node.groupId)
    : (node.groupId ?? UNGROUPED_SCOPE_KEY);
  const expanded = !viewState.isGroupCollapsed(groupKey);
  const setExpanded = (open: boolean) =>
    viewState.setGroupCollapsed(groupKey, !open);
  const listId = useId();
  const attachListAutoAnimateRef = useListAutoAnimate<HTMLDivElement>();
  const editableGroupId = isMachine ? null : node.groupId;
  const effectiveReorder = isMachine
    ? { ...projectReorder, enabled: false }
    : projectReorder;

  return (
    <section aria-label={node.name} className="mb-1">
      <GroupRowMenu
        name={node.name}
        groupId={editableGroupId}
        expanded={expanded}
        canMoveUp={
          editableGroupId !== null && groups[0]?.id !== editableGroupId
        }
        canMoveDown={
          editableGroupId !== null &&
          groups[groups.length - 1]?.id !== editableGroupId
        }
        onToggleExpanded={() => setExpanded(!expanded)}
        onMove={(delta) => treeActions.onGroupMove?.(editableGroupId ?? "", delta)}
        onRename={(name) => treeActions.onRenameGroup(editableGroupId ?? "", name)}
        onRemove={() => treeActions.onRemoveGroup(editableGroupId ?? "")}
      >
        <div className="group/group flex h-6.5 w-full items-center gap-1.5 rounded-md px-1.5 hover:bg-sidebar-accent/50">
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={() => setExpanded(!expanded)}
            title={node.name}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <GroupIcon
              name={node.icon}
              className="size-3.5 text-muted-foreground/80"
              ariaHidden
            />
            <span className="min-w-0 flex-1 truncate text-2xs font-semibold text-foreground/90">
              {node.name}
            </span>
          </button>
          <RowActions>
            {expanded ? null : (
              <RollupJump
                rollup={node.rollup}
                onJump={(threadId) => {
                  actions.open(threadId);
                  treeActions.onNavigate();
                }}
                onFallback={() => setExpanded(true)}
              />
            )}
            <RowDisclosure
              label={`${expanded ? "Collapse" : "Expand"} ${node.name}`}
              expanded={expanded}
              controls={listId}
              onToggle={() => setExpanded(!expanded)}
            />
          </RowActions>
        </div>
      </GroupRowMenu>
      {/*
        The container stays mounted and the rows come and go inside it: that is
        what lets auto-animate play the same per-row entry and exit a loaded
        page does.
      */}
      <div id={listId} ref={attachListAutoAnimateRef}>
        {expanded
          ? node.projects.map((project) => (
              <ProjectNodeView
                key={project.project.id}
                node={project}
                groups={groups}
                currentGroupId={
                  isMachine
                    ? (groupAssignment?.[project.project.id] ?? null)
                    : node.groupId
                }
                onAssignGroup={onAssignGroup}
                onNewThreadInProject={onNewThreadInProject}
                onNewWorktree={onNewWorktree}
                projectColorOverrides={projectColorOverrides}
                projectIcons={projectIcons}
                projectReorder={effectiveReorder}
              />
            ))
          : null}
      </div>
    </section>
  );
}

/**
 * Everything that can be done to a group, in one place.
 *
 * The inline pencil is the fast path for the common move (rename); this menu
 * holds the rest. Ungrouped is not a stored group, so its menu offers only what
 * applies to a bucket that cannot be renamed, moved, or deleted — and it opens
 * from the row itself, like every other menu in the tree.
 */
function GroupRowMenu({
  name,
  groupId,
  expanded,
  canMoveUp,
  canMoveDown,
  onToggleExpanded,
  onMove,
  onRename,
  onRemove,
  children,
}: {
  name: string;
  groupId: string | null;
  expanded: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onToggleExpanded: () => void;
  onMove: (delta: -1 | 1) => void;
  onRename: (name: string) => void;
  onRemove: () => void;
  children: ReactNode;
}) {
  const [renaming, setRenaming] = useState(false);
  const items: RowMenuItem[] = [
    {
      key: "disclose",
      icon: "ChevronDown",
      label: expanded ? "Collapse" : "Expand",
      onSelect: onToggleExpanded,
    },
  ];
  if (groupId !== null) {
    items.push(
      {
        key: "rename",
        icon: "Edit",
        label: "Rename…",
        separatorBefore: true,
        onSelect: () => setRenaming(true),
      },
      {
        key: "copy-id",
        icon: "Copy",
        label: "Copy group ID",
        onSelect: () => {
          void copyWithAnnouncement(groupId, "Group ID");
        },
      },
      {
        key: "move-up",
        icon: "ChevronUp",
        label: "Move up",
        separatorBefore: true,
        disabled: !canMoveUp,
        onSelect: () => onMove(-1),
      },
      {
        key: "move-down",
        icon: "ChevronDown",
        label: "Move down",
        disabled: !canMoveDown,
        onSelect: () => onMove(1),
      },
      {
        key: "remove",
        icon: "Trash2",
        label: "Remove group",
        separatorBefore: true,
        destructive: true,
        onSelect: onRemove,
      },
    );
  }

  return (
    <RowMenu
      label={`Actions for ${name}`}
      items={items}
      dialog={
        renaming && groupId !== null ? (
          <RenameDialog
            open
            title="Rename group"
            fieldLabel="Group name"
            currentName={name}
            maxLength={60}
            inputAriaLabel={`Rename ${name}`}
            onClose={() => setRenaming(false)}
            onSubmit={(next) => {
              onRename(next);
            }}
          />
        ) : null
      }
    >
      {children}
    </RowMenu>
  );
}
