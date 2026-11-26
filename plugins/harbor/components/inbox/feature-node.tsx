import { memo, useId, useMemo } from "react";

import type { FeatureHubSection } from "@/components/feature-hub/hub-tab-ref";
import { FlatFamilies } from "@/components/inbox/family-row";
import { PageControls } from "@/components/inbox/page-controls";
import { buildFeatureHoverPreview } from "@/components/inbox/hover-preview-builders";
import { ProjectBadge } from "@/components/inbox/project-node";
import {
  RowActionButton,
  RowActions,
  RowDisclosure,
} from "@/components/inbox/row-actions";
import {
  RowMenu,
  RowMenuButton,
  type RowMenuItem,
} from "@/components/inbox/row-context-menu";
import { RollupJump } from "@/components/inbox/rollup-badge";
import {
  TreeActionsProvider,
  useTreeActions,
  useTreeLiveState,
} from "@/components/inbox/tree-row-handlers-context";
import { useHarborViewState } from "@/components/inbox/view-state-context";
import { WorkspaceRow } from "@/components/inbox/workspace-row";
import { Icon } from "@bb-ui/icon";
import { InfoCard } from "@/components/ui/hover-card";
import { useListAutoAnimate } from "@/hooks/use-list-auto-animate";
import { usePagedRows } from "@/hooks/use-paged-rows";
import { useThreadActions } from "@/hooks/use-thread-actions";
import { copyWithAnnouncement } from "@/lib/ui/clipboard";
import type {
  FeatureNode as FeatureNodeModel,
  FeatureWorkspaceNode,
} from "@/lib/domain/feature-view";
import { visibleRows } from "@/lib/domain/paging";
import { projectBadgePresentation } from "@/lib/domain/project-colors";
import { rollupSignalCount } from "@/lib/domain/rollup";
import { cn } from "@/lib/ui/utils";

/** What a feature row asks of the section it sits in. */
export interface FeatureRowActions {
  /** Why `+` cannot start a conversation here, or null when it can. */
  readonly newThreadBlocker: (featureId: string) => string | null;
  readonly onNewThread: (featureId: string) => void;
  /** Opens the most relevant conversation (or full-screen NewChatPage if none exist). */
  readonly onOpenFeature: (featureId: string) => void;
  readonly onOpenHub: (
    featureId: string,
    section?: FeatureHubSection,
    directory?: string | null,
  ) => void;
  readonly onRename: (featureId: string) => void;
  readonly onPark: (featureId: string) => void;
  readonly onFinish: (featureId: string) => void;
  readonly onDelete: (featureId: string) => void;
}

/**
 * One feature row: the user's primary entry into the feature orchestrator workspace.
 *
 * Across both `Threads` and `Workspaces` sidebar modes:
 * - clicking the row body opens the active/urgent conversation (or root NewChatPage) in 1 click;
 * - `+` opens the full-screen `NewChatPage` bound to the feature root folder;
 * - `Layers` opens Feature Hub directly (right app-panel tab when a thread exists);
 * - the trailing disclosure (`>`) expands member repositories (and root thread rows in `Threads` mode) without duplicating the feature root as a synthetic sub-row.
 */
export const FeatureNode = memo(function FeatureNode({
  node,
  actions: rowActions,
}: {
  node: FeatureNodeModel;
  actions: FeatureRowActions;
}) {
  const treeActions = useTreeActions();
  const live = useTreeLiveState();
  const actions = useThreadActions();
  const viewState = useHarborViewState();
  const { feature } = node;
  const workspacesMode = treeActions.firstLevel === "workspaces";
  const expanded = viewState.isFeatureExpanded(feature.id);
  const setExpanded = (open: boolean) =>
    viewState.setFeatureExpanded(feature.id, open);
  const pinned = viewState.isFeaturePinned(feature.id);
  const active = live.activeFeatureId === feature.id;
  const listId = useId();
  const attachListAutoAnimateRef = useListAutoAnimate<HTMLDivElement>();
  const paged = usePagedRows({
    total: node.rootFamilies.length,
    pageSize: treeActions.preferences.pageSize,
    searching: live.searching,
  });
  const blocker = rowActions.newThreadBlocker(feature.id);
  const refMembers = node.members.filter((member) => member.role === "ref");
  const visibleRoots = visibleRows(
    node.rootFamilies,
    paged.visibleCount,
    live.activeThreadId,
    (family) => family.root.id,
  );
  const hasExpandableChildren =
    (!workspacesMode && visibleRoots.length > 0) ||
    node.workspaces.length > 0 ||
    refMembers.length > 0;

  const preview = buildFeatureHoverPreview({
    name: feature.name,
    state: feature.state,
    members: node.members,
    workspaces: node.workspaces,
    threadCount: node.threadCount,
    workspaceChanges: live.workspaceChanges,
    rootPath: feature.rootPath,
  });
  const hasCollapsedAttentionWorkspace =
    !workspacesMode &&
    [...(node.root ? [node.root] : []), ...node.workspaces].some(
      (workspace) =>
        rollupSignalCount(workspace.rollup) > 0 &&
        !(
          viewState.isWorkspaceExpanded(workspace.ref.key) ||
          workspace.ref.environmentIds.some((id) =>
            viewState.isWorkspaceExpanded(id),
          )
        ),
    );
  const showRollup =
    !expanded ||
    (workspacesMode
      ? false
      : paged.hasMore || hasCollapsedAttentionWorkspace);
  const hubAttention =
    node.meta.draftCount > 0 || node.meta.blockerCount > 0;
  const preferredHubSection: FeatureHubSection =
    node.meta.draftCount > 0 ? "decisions" : "overview";

  /**
   * Inside a feature, reordering is off. A feature's conversations and
   * worktrees come from several projects, so a drag here would write a project
   * order this section does not read.
   */
  const reorderOverride = useMemo(
    () => ({
      reorderEnabled: false,
      reorderDisabledReason: "Reorder conversations in their project.",
      workspaceReorderEnabled: false,
      workspaceReorderDisabledReason:
        "Worktrees under a feature keep the feature's order.",
    }),
    [],
  );

  const showRepoPrefix =
    node.workspaces.length > 1 ||
    node.members.filter((member) => member.role !== "ref").length > 1;
  const workspaceRow = (workspace: FeatureWorkspaceNode) => {
    const displayPrefix = showRepoPrefix ? workspace.projectName : undefined;
    return (
      <WorkspaceRow
        key={workspace.ref.key}
        node={workspace}
        projectId={workspace.projectId}
        projectName={workspace.projectName}
        variant={workspacesMode ? "card" : "group"}
        displayPrefix={displayPrefix}
      />
    );
  };

  const items: RowMenuItem[] = [
    {
      key: "new-thread",
      icon: "Plus",
      label: "New conversation",
      disabled: blocker !== null,
      hint: blocker ?? undefined,
      onSelect: () => rowActions.onNewThread(feature.id),
    },
    {
      key: "open-hub",
      icon: "Layers",
      label: "Open Feature Hub",
      onSelect: () => rowActions.onOpenHub(feature.id, preferredHubSection),
    },
    {
      key: "pin",
      icon: "Pin",
      label: pinned ? "Unpin feature" : "Pin to top",
      separatorBefore: true,
      onSelect: () => viewState.toggleFeaturePinned(feature.id),
    },
    ...(hasExpandableChildren
      ? [
          {
            key: "disclose",
            icon: "ChevronDown" as const,
            label: expanded ? "Collapse repositories" : "Expand repositories",
            onSelect: () => setExpanded(!expanded),
          },
        ]
      : []),
    {
      key: "rename",
      icon: "Edit",
      label: "Rename…",
      separatorBefore: true,
      onSelect: () => rowActions.onRename(feature.id),
    },
    {
      key: "copy-path",
      icon: "Copy",
      label: "Copy folder path",
      disabled: feature.rootPath === null,
      onSelect: () => {
        if (feature.rootPath !== null) {
          void copyWithAnnouncement(feature.rootPath, "Path");
        }
      },
    },
    {
      key: "park",
      icon: "Clock",
      label: "Park feature…",
      separatorBefore: true,
      onSelect: () => rowActions.onPark(feature.id),
    },
    {
      key: "finish",
      icon: "Archive",
      label: "Finish feature…",
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
      <div
        data-active={active ? "true" : undefined}
        className={cn(
          "group/project relative flex h-7 w-full items-center gap-1.5 rounded-md px-1.5",
          active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60",
        )}
      >
        <button
          type="button"
          aria-current={active ? "page" : undefined}
          aria-label={`Open ${feature.name} conversation`}
          title={feature.name}
          onClick={() => rowActions.onOpenFeature(feature.id)}
          className="absolute inset-0 rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <ProjectBadge
          projectId={feature.id}
          name={feature.name}
          badge={projectBadgePresentation(feature.id, undefined)}
          icon={undefined}
        />
        <span
          className={cn(
            "pointer-events-none relative min-w-0 flex-1 truncate text-xs font-semibold",
            active ? "text-foreground" : "text-foreground/90",
          )}
        >
          {feature.name}
        </span>
        {pinned ? (
          <Icon
            name="Pin"
            aria-label="Pinned"
            className="pointer-events-none relative size-3 shrink-0 text-muted-foreground/70"
          />
        ) : null}
        {node.members.length === 0 ? null : (
          <span
            className="pointer-events-none relative inline-flex shrink-0 items-center gap-0.5 text-2xs tabular-nums text-muted-foreground/75"
            title={`${node.members.length} ${node.members.length === 1 ? "repository" : "repositories"}`}
          >
            <Icon name="FolderGit" className="size-2.5 opacity-70" aria-hidden />
            {node.members.length}
          </span>
        )}
        <RowActions>
          {showRollup ? (
            <RollupJump
              rollup={node.rollup}
              onJump={(threadId) => {
                actions.open(threadId);
                treeActions.onNavigate();
              }}
              onFallback={() => rowActions.onOpenFeature(feature.id)}
            />
          ) : null}
          <RowActionButton
            label={blocker ?? `New conversation in ${feature.name}`}
            icon="Plus"
            disabled={blocker !== null}
            onClick={() => rowActions.onNewThread(feature.id)}
          />
          <RowActionButton
            label={
              hubAttention
                ? `Open Feature Hub for ${feature.name} (attention needed)`
                : `Open Feature Hub for ${feature.name}`
            }
            icon="Layers"
            badge={hubAttention}
            onClick={() =>
              rowActions.onOpenHub(feature.id, preferredHubSection)
            }
          />
          <RowMenuButton label={`Actions for ${feature.name}`} items={items} />
          {hasExpandableChildren ? (
            <RowDisclosure
              label={`${expanded ? "Collapse" : "Expand"} ${feature.name}`}
              expanded={expanded}
              controls={listId}
              onToggle={() => setExpanded(!expanded)}
            />
          ) : null}
        </RowActions>
      </div>
    </RowMenu>
  );

  return (
    <TreeActionsProvider value={treeActions} override={reorderOverride}>
      <section
        aria-label={feature.name}
        data-harbor-feature={feature.id}
        className="mt-1 first:mt-0"
      >
        <InfoCard
          trigger={row}
          label={preview.label}
          subtitle={preview.subtitle}
          summary={preview.summary}
          rows={preview.rows}
        />
        {hasExpandableChildren ? (
          <div
            id={listId}
            ref={attachListAutoAnimateRef}
            className={cn("flex flex-col gap-0.5", expanded && "mt-0.5")}
          >
            {expanded ? (
              <>
                {!workspacesMode && visibleRoots.length > 0 ? (
                  <div key="roots">
                    <FlatFamilies
                      families={visibleRoots}
                      projectId={visibleRoots[0]?.root.projectId ?? ""}
                    />
                    {!live.searching && (paged.hasMore || paged.page > 1) ? (
                      <PageControls
                        {...paged.controlsProps}
                        className="ml-4"
                      />
                    ) : null}
                  </div>
                ) : null}
                {node.workspaces.map(workspaceRow)}
                {refMembers.map((member) => (
                  <div
                    key={member.path}
                    className="flex h-6 items-center gap-1.5 rounded-md pl-4 pr-1.5 text-2xs text-muted-foreground"
                    title={member.repositoryPath}
                  >
                    <Icon
                      name="Link"
                      className="size-3 shrink-0 text-muted-foreground/60"
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {member.directory}
                    </span>
                    <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] leading-none">
                      Ref
                    </span>
                  </div>
                ))}
              </>
            ) : null}
          </div>
        ) : null}
      </section>
    </TreeActionsProvider>
  );
});
