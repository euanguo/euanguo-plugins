import { useId, useState } from "react";

import { FlatFamilies } from "@/components/inbox/family-row";
import { PageControls } from "@/components/inbox/page-controls";
import { ProjectBadge } from "@/components/inbox/project-node";
import {
  RowActionButton,
  RowActions,
  RowDisclosure,
} from "@/components/inbox/row-actions";
import { RowMenu, type RowMenuItem } from "@/components/inbox/row-context-menu";
import { RollupJump } from "@/components/inbox/rollup-badge";
import type { TreeRowHandlers } from "@/components/inbox/tree-row-types";
import { useNestViewState } from "@/components/inbox/view-state-context";
import { WorkspaceGroup } from "@/components/inbox/workspace-row";
import { Icon } from "@/components/ui/icon";
import { InfoCard } from "@/components/ui/hover-card";
import { useListAutoAnimate } from "@/hooks/use-list-auto-animate";
import { useThreadActions } from "@/hooks/use-thread-actions";
import { copyWithAnnouncement } from "@/lib/clipboard";
import type { FeatureNode as FeatureNodeModel } from "@/lib/feature-view";

import { hasMoreRows, nextPageSize, visibleRows } from "@/lib/paging";
import { projectBadgePresentation } from "@/lib/project-colors";
import { cn } from "@/lib/utils";

/** What a feature row asks of the panel it sits in. */
export interface FeatureRowActions {
  /** Why `+` cannot start a conversation here, or null when it can. */
  readonly newThreadBlocker: (featureId: string) => string | null;
  readonly onNewThread: (featureId: string) => void;
  readonly onRepositories: (featureId: string) => void;
  readonly onRename: (featureId: string) => void;
  readonly onFinish: (featureId: string) => void;
  readonly onDelete: (featureId: string) => void;
}

/**
 * One feature, drawn with the project row's own skeleton.
 *
 * Same height, same badge, same three trailing controls in the same order —
 * merged status, `+`, disclosure — and the same rule for the row itself:
 * clicking it opens and closes it, nothing else. `+` always means "start a
 * conversation in this feature", whatever state the feature is in; adding a
 * repository is its own action, on the repositories line and in the menu.
 *
 * Below it, conversations first. A member worktree gets the project view's own
 * worktree row only once a conversation runs in it; every repository is also
 * named on one line at the bottom, which is where they are managed.
 */
export function FeatureNode({
  node,
  handlers,
  actions: rowActions,
}: {
  node: FeatureNodeModel;
  handlers: TreeRowHandlers;
  actions: FeatureRowActions;
}) {
  const actions = useThreadActions();
  const viewState = useNestViewState();
  const { feature } = node;
  const expanded = !viewState.isProjectCollapsed(feature.id);
  const setExpanded = (open: boolean) => viewState.setProjectCollapsed(feature.id, !open);
  const listId = useId();
  const attachListAutoAnimateRef = useListAutoAnimate<HTMLDivElement>();
  const [rootPages, setRootPages] = useState(1);
  const blocker = rowActions.newThreadBlocker(feature.id);
  /**
   * The branches actually checked out in the feature, one per repository.
   *
   * Members may follow their own conventions, so there is no single branch to
   * name. Shown as a list on the hover card; the row itself stays about the work.
   */
  const branches = [...new Set(node.members.map((member) => member.branch ?? "detached"))];

  const rootLimit =
    (handlers.searching ? Number.MAX_SAFE_INTEGER : rootPages) * handlers.preferences.pageSize;
  const visibleRoots = visibleRows(
    node.rootFamilies,
    rootLimit,
    handlers.activeThreadId,
    (family) => family.root.id,
  );
  const rootsHaveMore = hasMoreRows(node.rootFamilies.length, rootLimit);

  /**
   * Inside a feature, reordering is off and the worktree rows draw no feature
   * pill. A feature's conversations come from several projects, so a drag here
   * would write a project order this view does not read; and a pill naming the
   * feature the row is already under says nothing.
   */
  const inner: TreeRowHandlers = {
    ...handlers,
    reorderEnabled: false,
    reorderDisabledReason: "Reorder conversations in the project view.",
    workspaceReorderEnabled: false,
    workspaceReorderDisabledReason: "Reorder worktrees in the project view.",
    featureOfWorkspace: undefined,
  };

  const items: RowMenuItem[] = [
    {
      key: "new-thread",
      icon: "Plus",
      label: "New thread",
      disabled: blocker !== null,
      hint: blocker ?? undefined,
      onSelect: () => rowActions.onNewThread(feature.id),
    },
    {
      key: "repositories",
      icon: "FolderGit",
      label: "Repositories…",
      onSelect: () => rowActions.onRepositories(feature.id),
    },
    {
      key: "disclose",
      icon: "ChevronDown",
      label: expanded ? "Collapse" : "Expand",
      separatorBefore: true,
      onSelect: () => setExpanded(!expanded),
    },
    {
      key: "rename",
      icon: "Edit",
      label: "Rename…",
      onSelect: () => rowActions.onRename(feature.id),
    },
    {
      key: "copy-path",
      icon: "Copy",
      label: "Copy folder path",
      disabled: feature.rootPath === null,
      onSelect: () => {
        if (feature.rootPath !== null) void copyWithAnnouncement(feature.rootPath, "Path");
      },
    },
    {
      key: "finish",
      icon: "Archive",
      label: "Finish feature…",
      separatorBefore: true,
      onSelect: () => rowActions.onFinish(feature.id),
    },
    {
      key: "delete",
      icon: "Trash2",
      label: "Delete feature…",
      destructive: true,
      onSelect: () => rowActions.onDelete(feature.id),
    },
  ];

  const row = (
    <RowMenu label={`Actions for ${feature.name}`} items={items}>
      <div className="group/project relative flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 hover:bg-sidebar-accent/60">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${feature.name}`}
          title={feature.name}
          onClick={() => setExpanded(!expanded)}
          className="absolute inset-0 rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <ProjectBadge
          projectId={feature.id}
          name={feature.name}
          badge={projectBadgePresentation(feature.id, undefined)}
          icon={undefined}
        />
        <span className="pointer-events-none relative min-w-0 flex-1 truncate text-xs font-semibold text-foreground/90">
          {feature.name}
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
          <RowActionButton
            label={blocker ?? `New thread in ${feature.name}`}
            icon="Plus"
            disabled={blocker !== null}
            onClick={() => rowActions.onNewThread(feature.id)}
          />
          <RowDisclosure
            label={`${expanded ? "Collapse" : "Expand"} ${feature.name}`}
            expanded={expanded}
            controls={listId}
            onToggle={() => setExpanded(!expanded)}
          />
        </RowActions>
      </div>
    </RowMenu>
  );

  return (
    <section aria-label={feature.name} data-nest-feature={feature.id} className="mt-1 first:mt-0">
      <InfoCard
        trigger={row}
        label={feature.name}
        rows={[
          { label: "Kind", value: "Feature" },
          ...(feature.rootPath === null
            ? []
            : [{ label: "Folder", value: feature.rootPath, mono: true, copy: true }]),
          {
            label: "Branches",
            value: branches.length === 0 ? "—" : branches.join(" · "),
            mono: true,
            copy: branches.length > 0,
          },
          { label: "Repositories", value: String(node.members.length) },
          { label: "Threads", value: String(node.threadCount) },
        ]}
      />
      <div
        id={listId}
        ref={attachListAutoAnimateRef}
        className={cn("flex flex-col gap-0.5", expanded && "mt-0.5")}
      >
        {expanded ? (
          <>
            {visibleRoots.length === 0 ? null : (
              <div key="roots">
                <FlatFamilies
                  families={visibleRoots}
                  projectId={visibleRoots[0]?.root.projectId ?? ""}
                  handlers={inner}
                />
                {!handlers.searching && (rootsHaveMore || rootPages > 1) ? (
                  <PageControls
                    hasMore={rootsHaveMore}
                    remaining={nextPageSize(
                      node.rootFamilies.length,
                      rootLimit,
                      handlers.preferences.pageSize,
                    )}
                    page={rootPages}
                    onLoadMore={() => setRootPages((pages) => pages + 1)}
                    onShowLess={() => setRootPages(1)}
                    className="ml-4"
                  />
                ) : null}
              </div>
            )}
            {node.workspaces.map((workspace) => (
              <WorkspaceGroup
                key={workspace.ref.key}
                node={workspace}
                projectId={workspace.projectId}
                projectName={workspace.projectName}
                handlers={inner}
              />
            ))}
            <RepositoriesLine
              key="repositories"
              members={node.members.map((member) => member.directory)}
              empty={node.threadCount === 0}
              onOpen={() => rowActions.onRepositories(feature.id)}
            />
          </>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Every repository in the feature, on one line, and the way in to manage them.
 *
 * One line whatever the count: the names are what a person scans for, and the
 * worktree rows above already carry the detail for the ones in use.
 */
function RepositoriesLine({
  members,
  empty,
  onOpen,
}: {
  members: readonly string[];
  /** Nothing else is under the feature yet, so this line says how to start. */
  empty: boolean;
  onOpen: () => void;
}) {
  const label =
    members.length === 0
      ? empty
        ? "No repositories yet — add one, or start a thread to plan"
        : "No repositories yet"
      : members.join(" · ");
  return (
    <button
      type="button"
      onClick={onOpen}
      title={members.length === 0 ? "Add repositories" : `Repositories: ${members.join(", ")}`}
      className="group/repos flex h-6 w-full min-w-0 items-center gap-1.5 rounded-md pl-4 pr-1.5 text-left text-2xs text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <Icon name="FolderGit" className="size-3 shrink-0 text-muted-foreground/60" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 opacity-0 transition-opacity duration-150 group-hover/repos:opacity-100 group-focus-visible/repos:opacity-100 motion-reduce:transition-none">
        {members.length === 0 ? "Add" : "Manage"}
      </span>
    </button>
  );
}
