import { useId, useState, type ReactNode } from "react";
import { Modal } from "@/components/ui/modal";
import { useThreadActions } from "@/hooks/use-thread-actions";
import { GroupIcon } from "@/components/ui/group-icon";
import { cn } from "@/lib/utils";
import { copyWithAnnouncement } from "@/lib/clipboard";
import { InfoCard, InfoRow } from "@/components/ui/hover-card";
import {
  RowActions,
  RowDisclosure,
} from "@/components/inbox/row-actions";
import {
  RowMenu,
  type RowMenuItem,
} from "@/components/inbox/row-context-menu";
import { RollupJump } from "@/components/inbox/rollup-badge";
import { useNestViewState } from "@/components/inbox/view-state-context";
import { useListAutoAnimate } from "@/hooks/use-list-auto-animate";
import { UNGROUPED_SCOPE_KEY } from "@/lib/view-state";
import {
  ProjectNode as ProjectNodeView,
} from "@/components/inbox/project-node";
import type { GroupNode } from "@/lib/tree";
import type { ProjectGroup } from "@/lib/groups";
import type { ProjectIcon } from "@/lib/project-icons";
import { renameIntent } from "@/lib/groups";
import type {
  TreeRowHandlers,
  WorkspaceLaunch,
} from "@/components/inbox/tree-rows";

/**
 * One group: the header row plus the projects filed under it.
 *
 * The header is the only place a project's group membership is edited from —
 * a project moves between groups through its own row's menu — so this row
 * carries the name, how many projects are inside, and the merged status of
 * every thread underneath. The last one is the reason the level exists at all:
 * with the group collapsed, a single dot plus a count is the whole answer to
 * "is anything in here running or waiting on me?".
 *
 * The name is edited in place. The pencil sits *before* the name so the
 * affordance reads as part of the label rather than as a trailing control, and
 * it only becomes a button once the row is hovered: at rest it is a quiet
 * glyph, so a screenful of groups is not a screenful of buttons. Clicking it
 * swaps the label for an input, which commits on Enter or blur and abandons on
 * Escape — the same rules the group manager dialog applies, shared through
 * `renameIntent` so the two cannot drift.
 */
export function GroupSection({
  node,
  handlers,
  groups,
  onAssignGroup,
  onNewThreadInProject,
  onNewWorktree,
  onNewThreadInWorkspace,
  projectColorOverrides,
  projectIcons,
  projectReorder,
}: {
  node: GroupNode;
  handlers: TreeRowHandlers;
  groups: readonly ProjectGroup[];
  onAssignGroup: (projectId: string, groupId: string | null) => void;
  onNewThreadInProject: (projectId: string, projectName: string) => void;
  onNewWorktree: (projectId: string, projectName: string) => void;
  onNewThreadInWorkspace: (launch: WorkspaceLaunch) => void;
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
  const actions = useThreadActions();
  const viewState = useNestViewState();
  /** Ungrouped is a real bucket, so it needs a key of its own to collapse under. */
  const groupKey = node.groupId ?? UNGROUPED_SCOPE_KEY;
  const expanded = !viewState.isGroupCollapsed(groupKey);
  const setExpanded = (open: boolean) =>
    viewState.setGroupCollapsed(groupKey, !open);
  const listId = useId();
  const attachListAutoAnimateRef = useListAutoAnimate<HTMLDivElement>();
  const threadCount = node.projects.reduce(
    (total, project) =>
      total +
      project.families.reduce(
        (sum, family) => sum + 1 + family.children.length,
        0,
      ),
    0,
  );
  const projectCount = node.projects.length;
  const groupId = node.groupId;

  const header = (
    <GroupRowMenu
      name={node.name}
      groupId={groupId}
      expanded={expanded}
      canMoveUp={groupId !== null && groups[0]?.id !== groupId}
      canMoveDown={groupId !== null && groups[groups.length - 1]?.id !== groupId}
      onToggleExpanded={() => setExpanded(!expanded)}
      onMove={(delta) => handlers.onGroupMove?.(groupId ?? "", delta)}
      onRename={(name) => handlers.onRenameGroup(groupId ?? "", name)}
      onRemove={() => handlers.onRemoveGroup(groupId ?? "")}
    >
    <div
      className="group/group flex h-6.5 w-full items-center gap-1.5 rounded-md px-1.5 hover:bg-sidebar-accent/50"
    >
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
            className="text-[0.7rem] leading-none"
            ariaHidden
          />
          <span className="min-w-0 flex-1 truncate text-2xs font-semibold text-foreground/90">
            {node.name}
          </span>
        </button>
      <RowActions>
        <RollupJump
          rollup={node.rollup}
          onJump={(threadId) => {
            actions.open(threadId);
            handlers.onNavigate();
          }}
            onFallback={() => setExpanded(!expanded)}
        />
        <RowDisclosure
          label={`${expanded ? "Collapse" : "Expand"} ${node.name}`}
          expanded={expanded}
          controls={listId}
          onToggle={() => setExpanded(!expanded)}
        />
      </RowActions>
    </div>
    </GroupRowMenu>
  );

  return (
    <section
      aria-label={node.name}
      data-nested-group={node.groupId ?? "__ungrouped__"}
      className="mb-1"
    >
      <InfoCard
        trigger={header}
        label={node.name}
        rows={[
          { label: "Type", value: groupId === null ? "Ungrouped" : "Group" },
          { label: "Projects", value: String(projectCount) },
          { label: "Threads", value: String(threadCount) },
          ...(groupId === null
            ? []
            : [{ label: "Group ID", value: groupId, mono: true, copy: true }]),
        ]}
      />
      {/*
        The container stays mounted and the rows come and go inside it: that is
        what lets auto-animate play the same per-row entry and exit a loaded
        page does. Hiding the container instead would leave one box to fade,
        and the list would have nothing to animate.
      */}
      <div id={listId} ref={attachListAutoAnimateRef}>
        {expanded
          ? node.projects.map((project) => (
              <ProjectNodeView
                key={project.project.id}
                node={project}
                handlers={handlers}
                groups={groups}
                currentGroupId={node.groupId}
                onAssignGroup={onAssignGroup}
                onNewThreadInProject={onNewThreadInProject}
                onNewWorktree={onNewWorktree}
                onNewThreadInWorkspace={onNewThreadInWorkspace}
                projectColorOverrides={projectColorOverrides}
                projectIcons={projectIcons}
                projectReorder={projectReorder}
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
        icon: "IdCard",
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
        icon: "Trash",
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
          <RenameGroupDialog
            groupId={groupId}
            currentName={name}
            onCancel={() => setRenaming(false)}
            onRenamed={(next) => {
              setRenaming(false);
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
function RenameGroupDialog({
  groupId,
  currentName,
  onCancel,
  onRenamed,
}: {
  groupId: string;
  currentName: string;
  onCancel: () => void;
  onRenamed: (name: string) => void;
}) {
  const [value, setValue] = useState(currentName);
  const trimmed = value.trim();

  const submit = () => {
    const next = renameIntent(trimmed, currentName);
    if (next === null) {
      onCancel();
      return;
    }
    onRenamed(next);
  };

  return (
    <Modal
      open
      onClose={onCancel}
      icon="Edit"
      title="Rename group"
      width="26rem"
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-7 rounded-md px-2.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={trimmed.length === 0}
            onClick={submit}
            className="h-7 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40"
          >
            Rename
          </button>
        </div>
      }
    >
      <label className="grid gap-1 text-2xs text-muted-foreground">
        Group name
        <input
          autoFocus
          value={value}
          maxLength={60}
          aria-label={`Rename ${currentName}`}
          onChange={(event) => setValue(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </label>
    </Modal>
  );
}
