import { memo, useId, useRef, useState } from "react";
import { useThreadActions } from "@/hooks/use-thread-actions";
import { ArchivedShelf } from "@/components/inbox/archived-shelf";
import { InFeaturesLine } from "@/components/inbox/feature-tree-panel";
import { CompactThreadRow, WorkspaceCard } from "@/components/inbox/workspace-card";
import { ProjectRowMenu } from "@/components/inbox/project-menu";
import { PageControls } from "@/components/inbox/page-controls";
import { visibleRows } from "@/lib/paging";
import { cn } from "@/lib/utils";
import {
  RowActionButton,
  RowActions,
  RowDisclosure,
} from "@/components/inbox/row-actions";
import { InfoCard, type InfoCardRow } from "@/components/ui/hover-card";
import { RollupJump } from "@/components/inbox/rollup-badge";
import { useNestViewState } from "@/components/inbox/view-state-context";
import { useListAutoAnimate } from "@/hooks/use-list-auto-animate";
import { usePagedRows } from "@/hooks/use-paged-rows";
import {
  FlatFamilies,
  WorkspaceGroup,
  parseDraggedFamily,
} from "@/components/inbox/tree-rows";
import { useTreeRowHandlers } from "@/components/inbox/tree-row-handlers-context";
import type { ProjectNode as ProjectNodeModel } from "@/lib/tree";
import { projectWorkspaceRows } from "@/lib/workspace-view";
import type { ProjectGroup } from "@/lib/groups";
import {
  projectBadgeLetter,
  projectBadgePresentation,
  type ProjectBadgePresentation,
} from "@/lib/project-colors";
import type { ProjectIcon } from "@/lib/project-icons";

/** The body of an expanded project that has nothing under it. */
const EMPTY_PROJECT_CLASS = "py-1 pl-4 text-2xs text-muted-foreground";

/**
 * One project, whether or not it has anything in it yet.
 *
 * The workspace level appears only when the project occupies more than one, so
 * a single-checkout project stays flat. A project with nothing at all draws one
 * muted line instead of an empty list: it is a real project, and the row above
 * it is where the first thread or worktree gets started.
 */
export const ProjectNode = memo(function ProjectNode({
  node,
  groups,
  currentGroupId,
  onAssignGroup,
  onNewThreadInProject,
  onNewWorktree,
  projectColorOverrides,
  projectIcons,
  projectReorder,
}: {
  node: ProjectNodeModel;
  groups: readonly ProjectGroup[];
  currentGroupId: string | null;
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
  const handlers = useTreeRowHandlers();
  const actions = useThreadActions();
  const viewState = useNestViewState();
  const workspacesMode = handlers.firstLevel === "workspaces";
  /**
   * The personal project starts folded in the workspaces view: it is a long
   * tail of one-off conversations, and the workspaces above it are the work.
   * The thread view keeps the ordinary project default.
   */
  const personal = workspacesMode && node.project.isPersonal;
  const expanded = personal
    ? viewState.isPersonalProjectExpanded(node.project.id)
    : !viewState.isProjectCollapsed(node.project.id);
  const setExpanded = (open: boolean) =>
    personal
      ? viewState.setPersonalProjectExpanded(node.project.id, open)
      : viewState.setProjectCollapsed(node.project.id, !open);
  const listId = useId();
  const attachListAutoAnimateRef = useListAutoAnimate<HTMLDivElement>();
  const dragStarted = useRef(false);
  const badge = projectBadgePresentation(
    node.project.id,
    projectColorOverrides.get(node.project.id),
  );
  const threadCount = node.families.reduce(
    (total, family) => total + 1 + family.children.length,
    0,
  );
  const projectPath = handlers.paths.projects[node.project.id]?.sourcePath ?? null;
  const inFeatures = node.inFeatures;

  /**
   * The project's own thread list, paged. A project that draws a workspace
   * level pages per worktree instead — each of those is a list of its own, and
   * a single limit spanning them would have to drop a worktree row or draw it
   * claiming to be empty. The loose rows page with it, since they are all the
   * workspaces view draws under the project.
   */
  const workspaceRows = workspacesMode ? projectWorkspaceRows(node, handlers.now) : null;
  const paged = usePagedRows({
    total:
      workspaceRows === null
        ? node.families.length
        : workspaceRows.loose.length,
    pageSize: handlers.preferences.pageSize,
    searching: handlers.searching,
  });
  const visibleFamilies = visibleRows(
    node.families,
    paged.visibleCount,
    handlers.activeThreadId,
    (family) => family.root.id,
  );

  const visibleLoose = visibleRows(
    workspaceRows?.loose ?? [],
    paged.visibleCount,
    handlers.activeThreadId,
    (family) => family.root.id,
  );

  const infoRows: InfoCardRow[] = [
    { label: "Kind", value: node.project.isPersonal ? "Personal" : "Project" },
    { label: "Threads", value: String(threadCount) },
    // Only meaningful once the level is actually drawn, which is exactly when
    // it is worth mentioning.
    ...(node.showWorkspaces
      ? [{ label: "Worktrees", value: String(node.workspaces.length) }]
      : []),
    { label: "Project ID", value: node.project.id, mono: true, copy: true },
  ];

  const projectRow = (
    <ProjectRowMenu
      projectId={node.project.id}
      projectName={node.project.name}
      projectPath={projectPath}
      isPersonal={node.project.isPersonal}
      groups={groups}
      currentGroupId={currentGroupId}
      expanded={expanded}
      archivedShelfOn={viewState.isArchivedShelfOn(node.project.id)}
      removeBlockedReason={
        node.foreignClaimProjectIds.length === 0
          ? null
          : `This row contains work claimed by ${node.foreignClaimProjectIds.join(", ")}.`
      }
      onToggleExpanded={() => setExpanded(!expanded)}
      onToggleArchivedShelf={() =>
        viewState.setArchivedShelf(
          node.project.id,
          !viewState.isArchivedShelfOn(node.project.id),
        )
      }
      onNewThread={() =>
        onNewThreadInProject(node.project.id, node.project.name)
      }
      onNewWorktree={() => onNewWorktree(node.project.id, node.project.name)}
      onAssignGroup={(groupId) => onAssignGroup(node.project.id, groupId)}
    >
    <div
      className="group/project relative flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 hover:bg-sidebar-accent/60"
    >
        <button
          type="button"
          draggable={projectReorder.enabled}
          aria-expanded={expanded}
          aria-controls={listId}
          aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
          aria-label={`${expanded ? "Collapse" : "Expand"} ${node.project.name}. ${projectReorder.enabled ? "Drag this header to reorder projects, or press Alt+Up or Alt+Down." : "Project reordering is unavailable."}`}
          title={node.project.name}
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
            if (!projectReorder.enabled) {
              event.preventDefault();
              return;
            }
            dragStarted.current = true;
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData(
              "application/x-nest-project",
              JSON.stringify({ projectId: node.project.id }),
            );
          }}
          onKeyDown={(event) => {
            if (!event.altKey) return;
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              projectReorder.next(
                node.project.id,
                event.key === "ArrowUp" ? -1 : 1,
              );
            }
          }}
          className="absolute inset-0 rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <ProjectBadge
          projectId={node.project.id}
          name={node.project.name}
          badge={badge}
          icon={projectIcons.get(node.project.id)}
        />
        <span className="pointer-events-none relative min-w-0 flex-1 truncate text-xs font-semibold text-foreground/90">
          {node.project.name}
        </span>
        <RowActions>
          <RollupJump
            rollup={node.rollup}
            onJump={(threadId) => {
              actions.open(threadId);
              handlers.onNavigate();
            }}
            onFallback={() => setExpanded(!expanded)}
          />
          {/* Starting a thread is the common move, so it keeps its own button
              rather than hiding behind the menu. */}
          <RowActionButton
            label={`New thread in ${node.project.name}`}
            icon="Plus"
            onClick={() =>
              onNewThreadInProject(node.project.id, node.project.name)
            }
          />
          {/* The arrow says the project is open, and is the way to change it
              without hunting for the name button. */}
          <RowDisclosure
            label={`${expanded ? "Collapse" : "Expand"} ${node.project.name}`}
            expanded={expanded}
            controls={listId}
            onToggle={() => setExpanded(!expanded)}
          />
        </RowActions>
    </div>
    </ProjectRowMenu>
  );

  return (
    <section
      aria-label={node.project.name}
      data-nest-project={node.project.id}
      className="mt-1 first:mt-0"
      onDragOver={(event) => {
        // A project row is a drop target for another project header, and for a
        // thread family dragged in from anywhere in the group.
        const types = event.dataTransfer.types;
        const projectDrag = types.includes("application/x-nest-project");
        const familyDrag = types.includes("application/x-nest-family");
        if (!projectDrag && !familyDrag) return;
        if (projectDrag && !projectReorder.enabled) return;
        // A family only reorders inside its own project, and a project with no
        // threads has none to reorder against — so this is not a drop target
        // for one, and the browser says so instead of accepting a drop that
        // would quietly do nothing.
        if (familyDrag && (!handlers.reorderEnabled || node.families.length === 0)) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => {
        const bounds = event.currentTarget.firstElementChild?.getBoundingClientRect();
        const position =
          bounds && event.clientY >= bounds.top + bounds.height / 2
            ? "after"
            : "before";

        const projectRaw = event.dataTransfer.getData(
          "application/x-nest-project",
        );
        if (projectRaw.length > 0) {
          const dragged = parseDraggedProject(projectRaw);
          if (dragged === null || !projectReorder.enabled) return;
          event.preventDefault();
          event.stopPropagation();
          projectReorder.drop(dragged.projectId, node.project.id, position);
          return;
        }

        // A family dropped on the project header lands at the top or bottom of
        // the project's own family list — the same gesture as dropping it on
        // the first or last row, without needing to aim at a row.
        const dragged = parseDraggedFamily(
          event.dataTransfer.getData("application/x-nest-family"),
        );
        if (dragged === null || !handlers.reorderEnabled) return;
        const target = node.families.at(position === "before" ? 0 : -1);
        if (target === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        handlers.onReorder({
          sourceProjectId: dragged.projectId,
          sourceRootId: dragged.rootId,
          targetProjectId: node.project.id,
          targetRootId: target.root.id,
          position,
        });
      }}
    >
      <InfoCard trigger={projectRow} label={node.project.name} rows={infoRows} />
      {/*
        Every container here stays mounted and its rows come and go inside it,
        so that opening and closing the project plays the very same per-row
        entry and exit a loaded page does. The inset rides on the container
        rather than on its first child: a child's top margin would collapse
        through it, and a collapsed project would keep a gap it no longer earns.
      */}
      {workspaceRows !== null ? (
        <div
          id={listId}
          ref={attachListAutoAnimateRef}
          className={cn("flex flex-col gap-0.5", expanded && "mt-0.5")}
        >
          {expanded ? (
            <>
              {workspaceRows.workspaces.map((workspace) => (
                <WorkspaceCard
                  key={workspace.ref.key}
                  node={workspace}
                  projectId={node.project.id}
                  projectName={node.project.name}
                />
              ))}
              {visibleLoose.map((family) => (
                <CompactThreadRow key={family.root.id} family={family} />
              ))}
              {!handlers.searching && (paged.hasMore || paged.page > 1) ? (
                <PageControls {...paged.controlsProps} className="ml-4" />
              ) : null}
              {workspaceRows.workspaces.length === 0 && workspaceRows.loose.length === 0 ? (
                <p className={EMPTY_PROJECT_CLASS}>No workspaces yet</p>
              ) : null}
            </>
          ) : null}
        </div>
      ) : node.showWorkspaces ? (
        <div
          id={listId}
          ref={attachListAutoAnimateRef}
          className={cn(
            "flex flex-col gap-0.5",
            expanded && "mt-0.5",
          )}
        >
          {expanded
            ? node.workspaces.map((workspace) => (
                <WorkspaceGroup
                  key={workspace.ref.key}
                  node={workspace}
                  projectId={node.project.id}
                  projectName={node.project.name}
                />
              ))
            : null}
        </div>
      ) : node.families.length === 0 ? (
        // A placeholder has no rows to animate, so it is simply here or not.
        expanded ? (
          <p id={listId} className={EMPTY_PROJECT_CLASS}>
            No threads yet
          </p>
        ) : null
      ) : (
        <div id={listId} className={cn(expanded && "mt-0.5")}>
          <FlatFamilies
            families={expanded ? visibleFamilies : []}
            projectId={node.project.id}
          />
          {expanded && !handlers.searching && (paged.hasMore || paged.page > 1) ? (
            <PageControls {...paged.controlsProps} className="ml-4" />
          ) : null}
        </div>
      )}
      {expanded && inFeatures !== null ? (
        <InFeaturesLine
          count={inFeatures.count}
          onReveal={() => handlers.onRevealFeature?.(inFeatures.featureId)}
        />
      ) : null}
      {/*
        The archived shelf sits inside the expanded project — a list under a
        collapsed header is a list nobody asked to see — and beside the container
        above rather than inside it, so the rows the animation owns are never
        asked to carry a second list they do not own.

        Read from `handlers`, which the inbox fills once for every open shelf:
        one read for the list, not one subscription per project row.
      */}
      {expanded && viewState.isArchivedShelfOn(node.project.id) ? (
        <ArchivedShelf
          threads={handlers.archivedByProject.get(node.project.id) ?? []}
          now={handlers.now}
          onOpen={(threadId) => {
            actions.open(threadId);
            handlers.onNavigate();
          }}
          onUnarchive={handlers.onUnarchiveArchived}
        />
      ) : null}
    </section>
  );
});

/**
 * The project's badge: its own icon when its checkout has one, and the colored
 * letter otherwise.
 *
 * The letter is not a placeholder to be replaced — it is what a project looks
 * like before anything has been probed, and what it keeps looking like when
 * there is nothing to find. The image only ever paints over it.
 */
export function ProjectBadge({
  projectId,
  name,
  badge,
  icon,
}: {
  projectId: string;
  name: string;
  badge: ProjectBadgePresentation;
  icon: ProjectIcon | undefined;
}) {
  /**
   * The source that failed to paint, not a boolean.
   *
   * Detection can replace a favicon URL with a file icon under a row that has
   * already drawn once, and a boolean would keep suppressing the replacement:
   * the failure belongs to the string, and dies with it.
   */
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  return (
    <span
      aria-hidden
      data-nest-project-badge={projectId}
      className="pointer-events-none relative flex size-5 shrink-0 items-center justify-center rounded-md border border-black/15 text-2xs font-semibold uppercase shadow-sm"
      style={{
        backgroundColor: badge.backgroundColor,
        color: badge.foregroundColor,
      }}
    >
      {icon !== undefined && icon.src !== failedSrc ? (
        <img
          alt=""
          src={icon.src}
          onError={() => setFailedSrc(icon.src)}
          className="size-full rounded-md object-contain"
        />
      ) : (
        projectBadgeLetter(name)
      )}
    </span>
  );
}

/**
 * Which group this project lives in, plus the escape hatch back to ungrouped.
 * A plain popover rather than a nested menu: there is one decision to make.
 */
function parseDraggedProject(raw: string): { projectId: string } | null {
  if (raw.length === 0 || raw.length > 500) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("projectId" in parsed) ||
      typeof parsed.projectId !== "string"
    ) {
      return null;
    }
    return { projectId: parsed.projectId };
  } catch {
    return null;
  }
}
