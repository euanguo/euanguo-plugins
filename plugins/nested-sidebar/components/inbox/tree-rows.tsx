import {
  useId,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
  type RefObject,
} from "react";
import {
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { useThreadActions } from "@/hooks/use-thread-actions";
import { Icon } from "@/components/ui/icon";
import { PageControls } from "@/components/inbox/page-controls";
import {
  RowMenu,
  type RowMenuItem,
} from "@/components/inbox/row-context-menu";
import {
  hasMoreRows,
  nextPageSize,
  visibleRows,
} from "@/lib/paging";
import { cn } from "@/lib/utils";
import { ThreadCard } from "@/components/inbox/thread-card";
import type { ProviderGlyphInfo } from "@/components/inbox/provider-glyph";
import { RollupJump } from "@/components/inbox/rollup-badge";
import { useNestViewState } from "@/components/inbox/view-state-context";
import { useListAutoAnimate } from "@/hooks/use-list-auto-animate";
import { usePointerCoarse } from "@/components/ui/hooks/use-pointer-coarse";
import { workspaceExpansionKeys } from "@/lib/view-state";
import { InfoCard, type InfoCardRow } from "@/components/ui/hover-card";
import {
  RowActionButton,
  RowActions,
  RowDisclosure,
} from "@/components/inbox/row-actions";
import type { LifecycleApi } from "@/hooks/use-lifecycle";
import type { ThreadFamily } from "@/lib/inbox";
import type { WorkspaceNode } from "@/lib/tree";
import { workspaceRowLabel } from "@/lib/workspace";
import type { RootSelectionIntent } from "@/lib/thread-management";
import { BULK_PROTECTION_LABELS, bulkEligibility } from "@/lib/thread-management";
import type { NestPreferences } from "@/lib/preferences";
import type { WorkspacePaths } from "@/hooks/use-workspace-paths";
import { renameIntent } from "@/lib/groups";
import { PINNED_DRAG_TYPE, encodeDraggedPinned } from "@/lib/pinned";

/** The body of an expanded workspace that has nothing in it yet. */
const EMPTY_WORKSPACE_CLASS = "ml-4 py-1 pl-3 text-2xs text-muted-foreground";
import { copyWithAnnouncement } from "@/lib/clipboard";
import { Modal } from "@/components/ui/modal";
import { RemoveWorktreeDialog } from "@/components/inbox/remove-worktree-dialog";
import type { WorkspaceKind } from "@/lib/workspace";

function workspaceKindLabel(kind: WorkspaceKind): string {
  switch (kind) {
    case "project-checkout": return "Project checkout";
    case "git-worktree": return "Git worktree";
    case "nested-checkout": return "Nested checkout";
    case "external-checkout": return "External checkout";
    case "external-directory": return "External directory";
    case "unresolved": return "Unresolved workspace";
    case "personal": return "Personal workspace";
  }
}

export interface TreeRowHandlers {
  readonly providerInfoById: ReadonlyMap<string, ProviderGlyphInfo>;
  readonly activeThreadId: string | null;
  /**
   * A search reveals every match rather than a page of them: the results are
   * what the user asked for, and holding some behind a Load more the search box
   * cannot explain is the one case where a limit works against the list.
   */
  readonly searching: boolean;
  readonly forceExpanded: boolean;
  readonly lifecycle: LifecycleApi;
  readonly onNavigate: () => void;
  readonly now: number;
  readonly selectionMode: boolean;
  readonly selectedRootIds: ReadonlySet<string>;
  readonly selectionHintId: string;
  readonly onToggleRoot: (threadId: string, intent: RootSelectionIntent) => void;
  /** Opens the new-thread dialog seeded from a workspace row. */
  readonly onNewThreadInWorkspace: (launch: WorkspaceLaunch) => void;
  readonly preferences: NestPreferences;
  /** Where each workspace and project lives, for the copy actions. */
  readonly paths: WorkspacePaths;
  /** Family reordering is disabled by selection, filters, and host search. */
  readonly reorderEnabled: boolean;
  readonly reorderDisabledReason: string | null;
  /**
   * Worktree rows drag too, but they answer to fewer modes: the workspace
   * arrangement is always the manual one, so only the shared blocker — search,
   * a filter, bulk selection — can turn them off.
   */
  readonly workspaceReorderEnabled: boolean;
  readonly workspaceReorderDisabledReason: string | null;
  readonly onWorkspaceReorder: (input: {
    sourceProjectId: string;
    sourceKey: string;
    targetProjectId: string;
    targetKey: string;
    position: "before" | "after";
  }) => void;
  readonly onWorkspaceKeyboardMove: (
    projectId: string,
    workspaceKey: string,
    direction: -1 | 1,
  ) => void;
  readonly onReorder: (input: FamilyReorderInput) => void;
  readonly onKeyboardMove: (
    projectId: string,
    rootId: string,
    direction: -1 | 1,
  ) => void;
  /**
   * The pinned section's own reorder, which lands in bb's pin order rather than
   * in a project's family order.
   *
   * Separate from `onReorder` rather than folded into it: the two write to
   * different stores, and a drop that reached the wrong one would move a row in a
   * list the user was not looking at.
   */
  readonly pinnedReorderEnabled: boolean;
  readonly pinnedReorderDisabledReason: string | null;
  readonly onPinnedKeyboardMove: (rootId: string, direction: -1 | 1) => void;
  /**
   * A project's archived shelf, keyed by project id.
   *
   * Read once for every project whose shelf is on, in the inbox, rather than by
   * the row that draws it: one read for the list instead of one subscription per
   * project, which is the same read amplification the realtime coalescing exists
   * to avoid.
   */
  readonly archivedByProject: ReadonlyMap<
    string,
    readonly PluginSidebarThread[]
  >;
  /** Take bb's archive off a thread the shelf is showing. */
  readonly onUnarchiveArchived: (threadId: string) => void;
  readonly projectReorderEnabled: boolean;
  readonly projectReorderDisabledReason: string | null;
  readonly onProjectReorder: (input: ProjectReorderInput) => void;
  readonly onProjectKeyboardMove: (
    projectId: string,
    direction: -1 | 1,
  ) => void;
  /** Move a group through the explicit order the store persists. */
  readonly onGroupMove?: (groupId: string, delta: -1 | 1) => void;
  /** Rename a group from its row menu; the store publishes and the tree re-reads. */
  readonly onRenameGroup: (groupId: string, name: string) => void;
  /** Delete a group; its projects return to Ungrouped. */
  readonly onRemoveGroup: (groupId: string) => void;
  /** Rename a project from a row menu; opens bb's own name field. */
  readonly onRenameProject: (projectId: string, name: string) => void;
  /** Rename a worktree's environment — the alias the row shows beside its branch. */
  readonly onRenameWorktree: (environmentId: string, name: string) => void;
}

export interface FamilyReorderInput {
  readonly sourceProjectId: string;
  readonly sourceRootId: string;
  readonly targetProjectId: string;
  readonly targetRootId: string;
  readonly position: "before" | "after";
}

export interface ProjectReorderInput {
  readonly sourceProjectId: string;
  readonly targetProjectId: string;
  readonly position: "before" | "after";
}

/**
 * A workspace row's + carries both the workspace to reuse and the project it
 * belongs to, because the dialog's project picker must be seeded from the row
 * the user actually clicked rather than from whatever project is on screen.
 */
export interface WorkspaceLaunch {
  readonly node: WorkspaceNode;
  readonly projectId: string;
  readonly projectName: string;
}

/**
 * One workspace: a worktree, the project checkout, or the no-workspace bucket.
 *
 * Collapsed by default when a project has several, because the whole point of
 * this level is to make many worktrees navigable rather than to show them all
 * at once.
 */
export function WorkspaceGroup({
  node,
  projectId,
  projectName,
  handlers,
}: {
  node: WorkspaceNode;
  projectId: string;
  projectName: string;
  handlers: TreeRowHandlers;
}) {
  const actions = useThreadActions();
  const viewState = useNestViewState();
  // A workspace is collapsed by default — the level only earns its space when
  // a project has several — so the store keeps the expanded ones instead.
  const expanded =
    viewState.isWorkspaceExpanded(node.ref.key) ||
    node.ref.environmentIds.some((id) => viewState.isWorkspaceExpanded(id));
  const setExpanded = (open: boolean) =>
    // Every key this row answers to, in one write — a row expanded under an id
    // it was once known by cannot be folded otherwise.
    viewState.setWorkspaceFolded({
      keys: workspaceExpansionKeys(node.ref),
      openKey: node.ref.key,
      expanded: open,
    });
  const [renaming, setRenaming] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const dragStarted = useRef(false);
  // The checkout leads every project and has nothing to arrange, so only a
  // worktree row is a handle.
  //
  // A coarse pointer cannot drag: HTML5 drag-and-drop has no touch story, so the
  // gesture the aria-label promises does not exist there. Saying it does is
  // worse than offering nothing — the row is reported as a drag handle to a
  // screen reader on a phone and then refuses to move. Alt+Arrow does still
  // work with a hardware keyboard, so the disclosure keeps its own label.
  const coarse = usePointerCoarse();
  const canReorder =
    handlers.workspaceReorderEnabled &&
    node.ref.kind === "git-worktree" &&
    !coarse;
  const canRename = node.ref.environmentId !== null && node.ref.kind !== "unresolved";
  const canRemove = node.ref.environmentId !== null && node.ref.kind === "git-worktree";
  const listId = useId();
  const attachListAutoAnimateRef = useListAutoAnimate<HTMLUListElement>();
  const renameInput = useRef<HTMLInputElement>(null);
  const threadCount = node.families.reduce(
    (total, family) => total + 1 + family.children.length,
    0,
  );
  /**
   * How many pages of this worktree's threads are drawn. Counted in pages so a
   * change to the page size re-scales what is already on screen.
   */
  const [familyPages, setFamilyPages] = useState(1);
  const familyLimit =
    (handlers.searching ? Number.MAX_SAFE_INTEGER : familyPages) *
    handlers.preferences.pageSize;
  const visibleFamilies = visibleRows(
    node.families,
    familyLimit,
    handlers.activeThreadId,
    (family) => family.root.id,
  );
  const familyHasMore = hasMoreRows(node.families.length, familyLimit);
  const familyNextPage = nextPageSize(
    node.families.length,
    familyLimit,
    handlers.preferences.pageSize,
  );

  const label = node.ref.label;
  const branch = node.ref.branch;
  const alias = node.ref.alias;
  // What the row draws is the setting's call, but the branch stays on the row
  // in every mode that has it, so a mistyped alias is caught by the row rather
  // than by opening something.
  const rowLabel = workspaceRowLabel(
    node.ref,
    handlers.preferences.worktreeLabel,
  );
  const stacked = rowLabel.detail !== null && rowLabel.stacked;
  const path =
    node.ref.environmentId === null
      ? node.ref.path
      : (handlers.paths.environments[node.ref.environmentId]?.path ?? node.ref.path);

  const rows: InfoCardRow[] = [
    { label: "Kind", value: workspaceKindLabel(node.ref.kind) },
    { label: "Project", value: projectName },
    { label: "Threads", value: String(threadCount) },
    ...(alias === null ? [] : [{ label: "Alias", value: alias }]),
    ...(branch === null ? [] : [{ label: "Branch", value: branch, mono: true, copy: true }]),
    ...(node.ref.environmentId === null
      ? []
      : [{ label: "Env ID", value: node.ref.environmentId, mono: true, copy: true }]),
    ...(path === null ? [] : [{ label: "Path", value: path, mono: true, copy: true }]),
    ...(node.ref.diagnostic === null ? [] : [{ label: "Diagnostic", value: node.ref.diagnostic }]),
  ];

  /**
   * The row's own controls, drawn at the right end of whichever line is its
   * last: the branch line when there is one, the only line when there is not.
   */
  const workspaceRowActions = (
    <RowActions className="pointer-events-auto">
      <RollupJump
        rollup={node.rollup}
        onJump={(threadId) => {
          actions.open(threadId);
          handlers.onNavigate();
        }}
        onFallback={() => setExpanded(!expanded)}
      />
      {/* Starting a thread in *this* worktree is the reason to be here, so it
          keeps its own button outside the menu. */}
      <RowActionButton
        label={`New thread in ${label}`}
        icon="Add"
        onClick={() =>
          handlers.onNewThreadInWorkspace({ node, projectId, projectName })
        }
      />
      <RowDisclosure
        label={`${expanded ? "Collapse" : "Expand"} ${label}`}
        expanded={expanded}
        controls={listId}
        onToggle={() => setExpanded(!expanded)}
      />
    </RowActions>
  );

  return (
    <section aria-label={node.ref.label}>
      <InfoCard
        trigger={
      <WorkspaceRowMenu
        label={label}
        node={node}
        projectId={projectId}
        projectName={projectName}
        branch={branch}
        path={path}
        expanded={expanded}
        canRename={canRename}
        canRemove={canRemove}
        threadCount={threadCount}
        handlers={handlers}
        onToggleExpanded={() => setExpanded(!expanded)}
        onRename={() => setRenaming(true)}
        onArchiving={() => setArchiving(true)}
        onRemoving={() => setRemoving(true)}
      >
      <div
        className={cn(
          // `relative` is load-bearing: the row's full-bleed button below is
          // `absolute inset-0`, and an absolutely positioned element resolves
          // against the nearest *positioned* ancestor. Without this the button
          // stretched across whatever ancestor happened to be positioned and
          // took the pointer for rows it does not belong to — a hover anywhere
          // in that area opened another row's card, and a click toggled it.
          "group/ws relative flex w-full items-center gap-1.5 rounded-md pl-4 pr-1.5 hover:bg-sidebar-accent/50",
          stacked ? "min-h-11 py-1" : "h-7",
        )}
        onDragOver={(event) => {
          if (!canReorder) return;
          if (!event.dataTransfer.types.includes("application/x-nest-workspace")) {
            return;
          }
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }}
        onDrop={(event) => {
          if (!canReorder) return;
          const raw = event.dataTransfer.getData("application/x-nest-workspace");
          if (raw.length === 0) return;
          event.preventDefault();
          const dragged = parseDraggedWorkspace(raw);
          if (dragged === null) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          handlers.onWorkspaceReorder({
            sourceProjectId: dragged.projectId,
            sourceKey: dragged.workspaceKey,
            targetProjectId: projectId,
            targetKey: node.ref.key,
            position:
              event.clientY >= bounds.top + bounds.height / 2
                ? "after"
                : "before",
          });
        }}
      >
        {renaming && node.ref.environmentId !== null ? (
          <WorkspaceNameField
            inputRef={renameInput}
            initial={alias ?? branch ?? ""}
            fallback={label}
            ariaLabel={`Rename worktree ${label}`}
            onCommit={(draft) => {
              const next = renameIntent(draft, alias ?? "");
              setRenaming(false);
              if (next !== null && node.ref.environmentId !== null) {
                handlers.onRenameWorktree(node.ref.environmentId, next);
              }
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
        <button
          type="button"
          draggable={canReorder}
          aria-expanded={expanded}
          aria-controls={listId}
          aria-keyshortcuts={canReorder ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
          // The label is drawn beside this button rather than inside it: the
          // branch line ends with the row's own controls, and a control cannot
          // live inside a button. So the name is spelled out here instead of
          // coming from the text the button used to wrap.
          aria-label={`${expanded ? "Collapse" : "Expand"} ${label}. ${canReorder ? "Drag this row to reorder worktrees, or press Alt+Up or Alt+Down." : "Worktree reordering is unavailable."}`}
          // The flag spans the whole gesture, not just the drag: a browser may
          // follow a drag with a click, and clearing it on `dragend` left that
          // click to toggle the row a second time — which, after the toggle the
          // drop performed, is a row that appears not to respond at all. The
          // next press is the first moment this gesture is over.
          onPointerDown={() => {
            dragStarted.current = false;
          }}
          onClick={(event) => {
            if (dragStarted.current) {
              event.preventDefault();
              return;
            }
            setExpanded(!expanded);
          }}
          onDragStart={(event) => {
            if (!canReorder) {
              event.preventDefault();
              return;
            }
            dragStarted.current = true;
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData(
              "application/x-nest-workspace",
              JSON.stringify({
                projectId,
                workspaceKey: node.ref.key,
              }),
            );
          }}
          onKeyDown={(event) => {
            if (!event.altKey || !canReorder) return;
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
            event.preventDefault();
            handlers.onWorkspaceKeyboardMove(
              projectId,
              node.ref.key,
              event.key === "ArrowUp" ? -1 : 1,
            );
          }}
          className={cn(
            "absolute inset-0 rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            canReorder && "cursor-grab active:cursor-grabbing",
          )}
        />
        )}
        <div
          className={cn(
            "pointer-events-none relative flex min-w-0 flex-1",
            // `gap-1.5` spaces a row's icon, label and controls on one line. A
            // column is not that: the same number becomes the line gap and reads
            // as a paragraph break between a worktree's alias and its branch.
            stacked ? "flex-col gap-0.5" : "items-center gap-1.5",
          )}
        >
          {stacked ? (
            <>
              <span className="min-w-0 max-w-full truncate text-xs text-foreground/80">
                {rowLabel.label}
              </span>
              {/* The branch line, the shape a thread card's branch line has one
                  level down: the branch's own icon and name on the left, and
                  the row's controls at the right end of the same line. The kind
                  icon that used to open the alias is dropped here rather than
                  repeated — a row with a branch line is a worktree, and the
                  branch icon already says so. */}
              <span className="flex min-w-0 max-w-full items-center gap-1.5">
                <span className="flex min-w-0 flex-1 items-center gap-1 truncate">
                  <Icon
                    name={
                      node.ref.kind === "git-worktree" ? "FolderGit" : "GitBranch"
                    }
                    aria-label="Branch"
                    className="size-3 shrink-0 text-muted-foreground/60"
                  />
                  <span className="truncate font-mono text-2xs text-muted-foreground/80">
                    {rowLabel.detail}
                  </span>
                </span>
                {workspaceRowActions}
              </span>
            </>
          ) : (
            <>
              {/* A worktree is a branch of the project; a checkout is the
                  project's own directory, and the two are worth telling apart
                  at a glance. */}
              <Icon
                name={node.ref.kind === "project-checkout" ? "Folder" : node.ref.kind === "git-worktree" ? "GitBranch" : "Folder"}
                className="size-3 shrink-0 text-muted-foreground/60"
                aria-hidden
              />
              {/* The alias reads as a name, so it is not monospaced; the branch
                  is an identifier, so it is. */}
              <span
                className={cn(
                  "min-w-0 max-w-full truncate text-xs",
                  rowLabel.labelIsBranch
                    ? "font-mono text-2xs text-muted-foreground/80"
                    : "text-foreground/80",
                )}
              >
                {rowLabel.label}
              </span>
              {rowLabel.detail === null ? null : (
                <span className="min-w-0 max-w-full truncate font-mono text-2xs text-muted-foreground/80">
                  {rowLabel.detail}
                </span>
              )}
              {workspaceRowActions}
            </>
          )}
        </div>
      </div>
      </WorkspaceRowMenu>
        }
        label={label}
        rows={rows}
      />
      {archiving ? (
        <ArchiveWorkspaceDialog
          label={label}
          threadIds={node.families.map((family) => family.root.id)}
          onCancel={() => setArchiving(false)}
          onArchive={() => {
            setArchiving(false);
            for (const family of node.families) actions.archive(family.root.id);
          }}
        />
      ) : null}
      {removing ? (
        <RemoveWorktreeDialog
          open
          environmentId={node.ref.environmentId}
          label={label}
          onClose={() => setRemoving(false)}
        />
      ) : null}
      {/*
        The list stays mounted and its rows come and go inside it, so opening
        and closing a worktree plays the same per-row entry and exit a loaded
        page does. Its connector line and padding are dropped while it is
        closed: an empty list is zero tall, and a border and a padding-bottom
        on zero height would leave a stub of the border hanging under the row.
      */}
      {node.families.length === 0 ? (
        // A workspace outlives the conversations in it, so an empty one is a
        // real row. It has no rows to animate, so it is simply here or not.
        expanded ? (
          <p id={listId} className={EMPTY_WORKSPACE_CLASS}>
            No threads yet
          </p>
        ) : null
      ) : (
        <>
          <ul
            id={listId}
            ref={attachListAutoAnimateRef}
            className={cn(
              "ml-4 flex flex-col gap-px",
              expanded && "border-l border-sidebar-border pl-3",
            )}
          >
            {expanded
              ? visibleFamilies.map((family) => (
                  <FamilyRow
                    key={family.root.id}
                    family={family}
                    projectId={projectId}
                    handlers={handlers}
                  />
                ))
              : null}
          </ul>
          {expanded && !handlers.searching && (familyHasMore || familyPages > 1) ? (
            <PageControls
              hasMore={familyHasMore}
              remaining={familyNextPage}
              page={familyPages}
              onLoadMore={() => setFamilyPages((pages) => pages + 1)}
              onShowLess={() => setFamilyPages(1)}
              className="ml-4"
            />
          ) : null}
        </>
      )}
    </section>
  );
}

/**
 * Every action a worktree row offers, as the tree's one menu.
 *
 * The row itself is the trigger: right-click anywhere on it. The two dialogs it
 * opens are mounted by the row, not here, so they outlive the menu.
 */
function WorkspaceRowMenu({
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
      icon: "Add",
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
    icon: "Trash",
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

export function FamilyRow({
  family,
  projectId,
  handlers,
  pinned = false,
}: {
  family: ThreadFamily;
  projectId: string;
  handlers: TreeRowHandlers;
  /**
   * Draw this row in the pinned section.
   *
   * The row is otherwise identical — same status, children, menu, split gesture —
   * and only the reorder differs: a pinned row's drag carries the pinned payload
   * and its drops are the section's, because they land in bb's pin order rather
   * than in a project's family order.
   */
  pinned?: boolean;
}) {
  const eligibility = bulkEligibility(family, handlers.activeThreadId);
  const reorderEnabled = pinned
    ? handlers.pinnedReorderEnabled
    : handlers.reorderEnabled;
  return (
    <ThreadCard
      thread={family.root}
      childThreads={family.children}
      providerInfoById={handlers.providerInfoById}
      activeThreadId={handlers.activeThreadId}
      canPark={handlers.lifecycle.canPark(family.root)}
      forceExpanded={handlers.forceExpanded}
      onNavigate={handlers.onNavigate}
      onSettle={() => handlers.lifecycle.settle(family.root.id)}
      onSnooze={(until) => handlers.lifecycle.snooze(family.root.id, until)}
      now={handlers.now}
      selectionMode={handlers.selectionMode}
      selected={handlers.selectedRootIds.has(family.root.id)}
      selectionHintId={handlers.selectionHintId}
      selectionDisabledReason={
        eligibility.eligible
          ? null
          : BULK_PROTECTION_LABELS[eligibility.reason]
      }
      onToggleSelected={(intent) => handlers.onToggleRoot(family.root.id, intent)}
      reorderEnabled={reorderEnabled}
      reorderDisabledReason={
        pinned
          ? handlers.pinnedReorderDisabledReason
          : handlers.reorderDisabledReason
      }
      onMoveByKeyboard={(direction) =>
        pinned
          ? handlers.onPinnedKeyboardMove(family.root.id, direction)
          : handlers.onKeyboardMove(projectId, family.root.id, direction)
      }
      onReorderDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        if (pinned) {
          event.dataTransfer.setData(
            PINNED_DRAG_TYPE,
            encodeDraggedPinned(family.root.id),
          );
          return;
        }
        event.dataTransfer.setData(
          "application/x-nest-family",
          JSON.stringify({ projectId, rootId: family.root.id }),
        );
      }}
      // The pinned section owns its own drops, on the list rather than the row:
      // a drop lands between two rows, and only the list knows which two.
      onReorderDragOver={
        pinned
          ? () => undefined
          : (event) => {
              if (!handlers.reorderEnabled) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }
      }
      onReorderDrop={
        pinned
          ? () => undefined
          : (event) => {
              event.preventDefault();
              const dragged = parseDraggedFamily(
                event.dataTransfer.getData("application/x-nest-family"),
              );
              if (dragged === null) return;
              const bounds = event.currentTarget.getBoundingClientRect();
              handlers.onReorder({
                sourceProjectId: dragged.projectId,
                sourceRootId: dragged.rootId,
                targetProjectId: projectId,
                targetRootId: family.root.id,
                position:
                  event.clientY < bounds.top + bounds.height / 2
                    ? "before"
                    : "after",
              });
            }
      }
      preferences={handlers.preferences}
    />
  );
}

/** Flat rendering used when a project occupies a single workspace. */
export function FlatFamilies({
  families,
  projectId,
  handlers,
}: {
  families: readonly ThreadFamily[];
  projectId: string;
  handlers: TreeRowHandlers;
}) {
  const attachListAutoAnimateRef = useListAutoAnimate<HTMLUListElement>();
  return (
    <ul ref={attachListAutoAnimateRef} className="flex flex-col gap-px">
      {families.map((family) => (
        <FamilyRow
          key={family.root.id}
          family={family}
          projectId={projectId}
          handlers={handlers}
        />
      ))}
    </ul>
  );
}

/**
 * The worktree alias editor.
 *
 * Commits on a mounted-field basis only: a plain function component whose
 * input is autofocused and whose Enter/blur/Escape rules mirror the group
 * name field, so the two levels rename the same way.
 */
function WorkspaceNameField({
  inputRef,
  initial,
  fallback,
  ariaLabel,
  onCommit,
  onCancel,
}: {
  inputRef?: RefObject<HTMLInputElement | null>;
  initial: string;
  /** Shown as help text; the alias the user types replaces what is shown. */
  fallback: string;
  ariaLabel: string;
  onCommit: (draft: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [done, setDone] = useState(false);
  const finish = (commit: boolean) => {
    if (done) return;
    setDone(true);
    if (commit) onCommit(value);
    else onCancel();
  };
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      <Icon
        name="Edit"
        className="size-3 shrink-0 text-muted-foreground/60"
        aria-hidden
      />
      <input
        ref={inputRef}
        autoFocus
        value={value}
        maxLength={120}
        aria-label={ariaLabel}
        placeholder={fallback}
        onChange={(event) => setValue(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            finish(true);
          } else if (event.key === "Escape") {
            event.preventDefault();
            finish(false);
          }
        }}
        onBlur={() => finish(true)}
        className={cn(
          "h-6 min-w-0 flex-1 rounded border border-border bg-background px-1.5 text-xs",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        )}
      />
    </span>
  );
}

/** Parses the drag payload a family row puts on the data transfer. */
export function parseDraggedFamily(
  raw: string,
): { projectId: string; rootId: string } | null {
  if (raw.length === 0 || raw.length > 1_000) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("projectId" in parsed) ||
      !("rootId" in parsed) ||
      typeof parsed.projectId !== "string" ||
      typeof parsed.rootId !== "string"
    ) {
      return null;
    }
    return { projectId: parsed.projectId, rootId: parsed.rootId };
  } catch {
    return null;
  }
}

export type { PluginSidebarThread, DragEvent };

/**
 * Confirm archiving every thread under one workspace.
 *
 * bb's own environment row archives its threads from the menu with no second
 * step, but that row sits on a single environment the user just opened. Here
 * the workspace level can hold several thread families, and the action reaches
 * all of them at once, so it says how many before it does it.
 */
function ArchiveWorkspaceDialog({
  label,
  threadIds,
  onCancel,
  onArchive,
}: {
  label: string;
  threadIds: readonly string[];
  onCancel: () => void;
  onArchive: () => void;
}) {
  return (
    <Modal
      open
      onClose={onCancel}
      icon="Archive"
      title={`Archive threads in ${label}`}
      width="28rem"
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
            onClick={onArchive}
            className="h-7 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            Archive
          </button>
        </div>
      }
    >
      <p className="text-xs leading-relaxed text-muted-foreground">
        This archives {threadIds.length}{" "}
        {threadIds.length === 1 ? "thread family" : "thread families"} and their
        child agents. You can unarchive them from bb at any time.
      </p>
    </Modal>
  );
}

/** The payload a dragged worktree row carries: which project, and which place. */
function parseDraggedWorkspace(
  raw: string,
): { projectId: string; workspaceKey: string } | null {
  if (raw.length === 0 || raw.length > 500) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("projectId" in parsed) ||
      !("workspaceKey" in parsed) ||
      typeof parsed.projectId !== "string" ||
      typeof parsed.workspaceKey !== "string"
    ) {
      return null;
    }
    return {
      projectId: parsed.projectId,
      workspaceKey: parsed.workspaceKey,
    };
  } catch {
    return null;
  }
}
