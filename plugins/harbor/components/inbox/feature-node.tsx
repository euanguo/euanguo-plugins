import { memo, useId, useMemo } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";

import { NEW_CHAT_PANEL_PATH } from "@/app/new-chat/route";
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
import { Icon, type IconName } from "@bb-ui/icon";
import { InfoCard } from "@/components/ui/hover-card";
import { useListAutoAnimate } from "@/hooks/use-list-auto-animate";
import { usePagedRows } from "@/hooks/use-paged-rows";
import { useThreadActions } from "@/hooks/use-thread-actions";
import { copyWithAnnouncement } from "@/lib/ui/clipboard";
import type {
  FeatureNode as FeatureNodeModel,
  FeatureWorkspaceNode,
} from "@/lib/domain/feature-view";
import type { FeatureMetaSummary } from "@/lib/domain/feature-meta";
import { lastActiveFor } from "@/lib/ui/last-active";
import { visibleRows } from "@/lib/domain/paging";
import { projectBadgePresentation } from "@/lib/domain/project-colors";
import { rollupSignalCount } from "@/lib/domain/rollup";
import { cn } from "@/lib/ui/utils";
import { workspaceOpenTarget } from "@/lib/domain/workspace-view";

/** What a feature row asks of the section it sits in. */
export interface FeatureRowActions {
  /** Why `+` cannot start a conversation here, or null when it can. */
  readonly newThreadBlocker: (featureId: string) => string | null;
  readonly onNewThread: (featureId: string) => void;
  readonly onOpenHub: (
    featureId: string,
    section?: FeatureHubSection,
    directory?: string | null,
  ) => void;
  readonly onRename: (featureId: string) => void;
  readonly onFinish: (featureId: string) => void;
  readonly onDelete: (featureId: string) => void;
}

/**
 * One feature, drawn with the project row's own skeleton.
 *
 * In Threads the row keeps the project row's rule: clicking it opens and
 * closes the conversations under it. In Workspaces the row is a workspace
 * card's peer: clicking it opens the feature folder's workspace, nothing
 * folds, and the two things a feature records (its requirement, its
 * repositories) sit on two buttons instead of two full-width lines.
 *
 * Below it, the feature's workspaces, drawn to the depth the mode draws. In
 * Threads the folder's conversations come first and flat, because they are
 * where the work is planned, then one row per member that opens onto its
 * conversations. In Workspaces every workspace is one card, the folder first,
 * and a card opens on click rather than folding.
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
  const navigate = useBbNavigate();
  const viewState = useHarborViewState();
  const { feature } = node;
  const metaParts = metaSummaryParts(node.meta);
  const repoNames = node.members.filter((m) => m.role !== "ref").map((m) => m.directory);
  const workspacesMode = treeActions.firstLevel === "workspaces";
  const expanded = workspacesMode
    ? viewState.isFeatureExpanded(feature.id)
    : !viewState.isProjectCollapsed(feature.id);
  const setExpanded = (open: boolean) =>
    workspacesMode
      ? viewState.setFeatureExpanded(feature.id, open)
      : viewState.setProjectCollapsed(feature.id, !open);
  const listId = useId();
  const attachListAutoAnimateRef = useListAutoAnimate<HTMLDivElement>();
  const paged = usePagedRows({
    total: node.rootFamilies.length,
    pageSize: treeActions.preferences.pageSize,
    searching: live.searching,
  });
  const blocker = rowActions.newThreadBlocker(feature.id);
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
          workspace.ref.environmentIds.some((id) => viewState.isWorkspaceExpanded(id))
        ),
    );
  const showRollup =
    !expanded ||
    (workspacesMode
      ? false
      : paged.hasMore || hasCollapsedAttentionWorkspace);

  const visibleRoots = visibleRows(
    node.rootFamilies,
    paged.visibleCount,
    live.activeThreadId,
    (family) => family.root.id,
  );

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
  /**
   * One workspace below the feature, drawn to the depth the mode draws. In
   * Threads a workspace opens onto its conversations; in Workspaces the row is
   * the whole of it, and the conversations are the header's tabs.
   */
  const showRepoPrefix =
    node.workspaces.length > 1 ||
    node.members.filter((member) => member.role !== "ref").length > 1;
  const workspaceRow = (workspace: FeatureWorkspaceNode) => {
    const isRoot = node.root?.ref.key === workspace.ref.key;
    const displayLabelOverride = isRoot ? "Feature workspace" : undefined;
    const displayPrefix =
      !isRoot && showRepoPrefix ? workspace.projectName : undefined;
    return (
      <WorkspaceRow
        key={workspace.ref.key}
        node={workspace}
        projectId={workspace.projectId}
        projectName={workspace.projectName}
        variant={treeActions.firstLevel === "workspaces" ? "card" : "group"}
        displayPrefix={displayPrefix}
        displayLabelOverride={displayLabelOverride}
      />
    );
  };

  /**
   * Open the feature's work the way a workspace card does: failed or waiting
   * work first, else the last conversation opened here, else the oldest, else
   * a new conversation.
   *
   * The feature's own folder is only the first candidate. Its work usually
   * lives in the member checkouts, and a folder with no environment of its own
   * used to send the click to the requirement dialog while a member held every
   * conversation the feature has. So the row looks across all of them, and the
   * requirement dialog is what is left when there is nothing to open anywhere.
   */
  const openFeatureWorkspace = () => {
    const root = node.root;
    const workspaces = root === null ? node.workspaces : [root, ...node.workspaces];
    const target = workspaceOpenTarget({
      rollup: node.rollup,
      families: workspaces.flatMap((workspace) => workspace.families),
      lastActiveThreadId:
        workspaces
          .map((workspace) => lastActiveFor(workspace.ref.key))
          .find((id) => id !== null) ?? null,
    });
    if (target.kind === "thread") {
      actions.open(target.threadId);
      treeActions.onNavigate();
      return;
    }
    // No conversation anywhere: open a new one in the first workspace that has
    // an environment, the folder's own first.
    for (const workspace of workspaces) {
      const environmentId = workspace.ref.canonicalEnvironmentId;
      if (environmentId === null) continue;
      navigate.toPluginPanel(NEW_CHAT_PANEL_PATH, { subPath: environmentId });
      return;
    }
    rowActions.onOpenHub(feature.id, "overview");
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
      key: "open-hub",
      icon: "Layers",
      label: "Open Feature Hub",
      onSelect: () => rowActions.onOpenHub(feature.id, "overview"),
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
          aria-expanded={workspacesMode ? undefined : expanded}
          aria-controls={workspacesMode ? undefined : listId}
          aria-label={
            workspacesMode
              ? `Open ${feature.name} workspace`
              : `${expanded ? "Collapse" : "Expand"} ${feature.name}`
          }
          title={feature.name}
          onClick={
            workspacesMode ? openFeatureWorkspace : () => setExpanded(!expanded)
          }
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
        {node.members.length === 0 ? null : (
          <span
            className="pointer-events-none relative shrink-0 text-2xs tabular-nums text-muted-foreground/70"
            title={`${node.members.length} ${node.members.length === 1 ? "repository" : "repositories"}`}
          >
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
              onFallback={
                workspacesMode ? openFeatureWorkspace : () => setExpanded(!expanded)
              }
            />
          ) : null}
          {workspacesMode ? null : (
            <RowActionButton
              label={blocker ?? `New thread in ${feature.name}`}
              icon="Plus"
              disabled={blocker !== null}
              onClick={() => rowActions.onNewThread(feature.id)}
            />
          )}
          <RowMenuButton label={`Actions for ${feature.name}`} items={items} />
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
        <div
          id={listId}
          ref={attachListAutoAnimateRef}
          className={cn("flex flex-col gap-0.5", expanded && "mt-0.5")}
        >
          {expanded ? (
            <>
              {treeActions.firstLevel === "workspaces"
                ? node.root === null
                  ? null
                  : workspaceRow(node.root)
                : visibleRoots.length === 0
                  ? null
                  : (
                    <div key="roots">
                      <FlatFamilies
                        families={visibleRoots}
                        projectId={visibleRoots[0]?.root.projectId ?? ""}
                      />
                      {!live.searching && (paged.hasMore || paged.page > 1) ? (
                        <PageControls {...paged.controlsProps} className="ml-4" />
                      ) : null}
                    </div>
                  )}
              {node.workspaces.map(workspaceRow)}
              {node.members
                .filter((member) => member.role === "ref")
                .map((member) => (
                  <div
                    key={member.path}
                    className="flex h-6 items-center gap-1.5 rounded-md pl-4 pr-1.5 text-2xs text-muted-foreground"
                    title={member.repositoryPath}
                  >
                    <Icon name="Link" className="size-3 shrink-0 text-muted-foreground/60" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{member.directory}</span>
                    <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] leading-none">
                      Ref
                    </span>
                  </div>
                ))}
              {workspacesMode ? (
                <FeatureActionsRow
                  meta={node.meta}
                  repositories={node.members.length}
                  onOpenSection={(section) => rowActions.onOpenHub(feature.id, section)}
                />
              ) : (
                <>
                  <FeatureFooterLine
                    icon="Layers"
                    label={
                      metaParts.length === 0
                        ? "Open Feature Hub — brief, decisions & delivery"
                        : metaParts.join(" · ")
                    }
                    title="Open Feature Hub"
                    actionLabel={node.meta.draftCount > 0 ? "Confirm" : "Hub"}
                    onClick={() =>
                      rowActions.onOpenHub(
                        feature.id,
                        node.meta.draftCount > 0 ? "decisions" : "overview",
                      )
                    }
                  />
                  {node.workspaces.length > 0 ||
                  (repoNames.length === 0 && node.members.some((m) => m.role === "ref")) ? null : (
                    <FeatureFooterLine
                      icon="FolderGit"
                      label={
                        repoNames.length === 0
                          ? node.threadCount === 0
                            ? "No repositories yet — add one, or start a thread to plan"
                            : "No repositories yet"
                          : repoNames.join(" · ")
                      }
                      title={
                        repoNames.length === 0
                          ? "Add repositories"
                          : `Repositories: ${repoNames.join(", ")}`
                      }
                      actionLabel={repoNames.length === 0 ? "Add" : "Manage"}
                      onClick={() => rowActions.onOpenHub(feature.id, "repos")}
                    />
                  )}
                </>
              )}
            </>
          ) : null}
        </div>
      </section>
    </TreeActionsProvider>
  );
});

/**
 * What the feature has recorded, on one line, and the way in.
 *
 * It sits beside the repositories because both answer "what is in this
 * feature" — one about folders, one about intent. A draft is called out because
 * it is the one state that waits for the person reading the sidebar.
 */
function FeatureFooterLine({
  icon,
  label,
  title,
  actionLabel,
  onClick,
}: {
  icon: IconName;
  label: string;
  title: string;
  actionLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="group/footer-line flex h-6 w-full min-w-0 items-center gap-1.5 rounded-md pl-4 pr-1.5 text-left text-2xs text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <Icon name={icon} className="size-3 shrink-0 text-muted-foreground/60" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 opacity-0 transition-opacity duration-150 group-hover/footer-line:opacity-100 group-focus-visible/footer-line:opacity-100 motion-reduce:transition-none">
        {actionLabel}
      </span>
    </button>
  );
}

/**
 * The counts behind the requirement line, shared by the line and the two
 * buttons the Workspaces mode draws instead.
 */
function metaSummaryParts(meta: FeatureMetaSummary): string[] {
  const parts: string[] = [];
  if (meta.activeDecisionCount > 0) {
    parts.push(
      `${meta.activeDecisionCount} decision${meta.activeDecisionCount === 1 ? "" : "s"}`,
    );
  }
  if (meta.draftCount > 0) {
    parts.push(`${meta.draftCount} draft${meta.draftCount === 1 ? "" : "s"}`);
  }
  if (meta.openQuestionCount > 0) {
    parts.push(
      `${meta.openQuestionCount} open question${meta.openQuestionCount === 1 ? "" : "s"}`,
    );
  }
  if (meta.blockerCount > 0) {
    parts.push(
      `${meta.blockerCount} blocker${meta.blockerCount === 1 ? "" : "s"}`,
    );
  }
  if (meta.refCount > 0) {
    parts.push(
      `${meta.refCount} reference${meta.refCount === 1 ? "" : "s"}`,
    );
  }
  return parts;
}

/**
 * The two things a feature records, on two buttons.
 *
 * In Workspaces the feature row does not fold, so these cannot wait behind an
 * expansion. They are always drawn side by side; the requirement button keeps
 * the counts that used to sit on the line.
 */
function FeatureActionsRow({
  meta,
  repositories,
  onOpenSection,
}: {
  meta: FeatureMetaSummary;
  repositories: number;
  onOpenSection: (section: FeatureHubSection) => void;
}) {
  const parts = metaSummaryParts(meta);
  return (
    <div className="flex items-center gap-1 py-0.5 pl-4 pr-1.5">
      <CompactButton
        icon="Layers"
        label={parts.length === 0 ? "Overview" : parts.join(" · ")}
        title="Open Feature Hub Overview"
        grow
        onClick={() =>
          onOpenSection(meta.draftCount > 0 ? "decisions" : "overview")
        }
      />
      <CompactButton
        icon="FolderGit"
        label={repositories > 0 ? `Repos (${repositories})` : "Repos"}
        title={`${repositories} ${repositories === 1 ? "repository" : "repositories"}`}
        onClick={() => onOpenSection("repos")}
      />
      <CompactButton
        icon="GitBranch"
        label="Matrix"
        title="Cross-Repo Delivery Matrix"
        onClick={() => onOpenSection("changes")}
      />
    </div>
  );
}

function CompactButton({
  icon,
  label,
  title,
  grow = false,
  onClick,
}: {
  icon: IconName;
  label: string;
  title: string;
  grow?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "flex h-6 min-w-0 items-center justify-center gap-1 rounded-md border border-sidebar-border/80 px-2 text-2xs text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        grow ? "flex-1" : "shrink-0",
      )}
    >
      <Icon
        name={icon}
        className="size-3 shrink-0 text-muted-foreground/60"
        aria-hidden
      />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}
