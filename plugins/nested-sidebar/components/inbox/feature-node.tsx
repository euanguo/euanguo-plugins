import { memo, useId, useMemo } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";

import { NEW_CHAT_PANEL_PATH } from "@/app/new-chat/route";
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
import {
  TreeRowHandlersProvider,
  useTreeRowHandlers,
} from "@/components/inbox/tree-row-handlers-context";
import { useNestViewState } from "@/components/inbox/view-state-context";
import { WorkspaceCard } from "@/components/inbox/workspace-card";
import { WorkspaceGroup } from "@/components/inbox/workspace-row";
import { Icon, type IconName } from "@/components/ui/icon";
import { InfoCard } from "@/components/ui/hover-card";
import { useListAutoAnimate } from "@/hooks/use-list-auto-animate";
import { usePagedRows } from "@/hooks/use-paged-rows";
import { useThreadActions } from "@/hooks/use-thread-actions";
import { copyWithAnnouncement } from "@/lib/clipboard";
import type {
  FeatureNode as FeatureNodeModel,
  FeatureWorkspaceNode,
} from "@/lib/feature-view";
import type { FeatureMetaSummary } from "@/lib/feature-meta";
import { lastActiveFor } from "@/lib/last-active";
import { visibleRows } from "@/lib/paging";
import { projectBadgePresentation } from "@/lib/project-colors";
import { cn } from "@/lib/utils";
import { workspaceOpenTarget } from "@/lib/workspace-view";

/** What a feature row asks of the section it sits in. */
export interface FeatureRowActions {
  /** Why `+` cannot start a conversation here, or null when it can. */
  readonly newThreadBlocker: (featureId: string) => string | null;
  readonly onNewThread: (featureId: string) => void;
  readonly onRepositories: (featureId: string) => void;
  readonly onRequirement: (
    featureId: string,
    tab?: "requirement" | "decisions" | "references",
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
  const handlers = useTreeRowHandlers();
  const actions = useThreadActions();
  const navigate = useBbNavigate();
  const viewState = useNestViewState();
  const { feature } = node;
  const workspacesMode = handlers.firstLevel === "workspaces";
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
    pageSize: handlers.preferences.pageSize,
    searching: handlers.searching,
  });
  const blocker = rowActions.newThreadBlocker(feature.id);
  /**
   * The branches actually checked out in the feature, one per repository.
   *
   * Members may follow their own conventions, so there is no single branch to
   * name. Shown as a list on the hover card; the row itself stays about the work.
   */
  const branches = [...new Set(node.members.map((member) => member.branch ?? "detached"))];

  const visibleRoots = visibleRows(
    node.rootFamilies,
    paged.visibleCount,
    handlers.activeThreadId,
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
  const workspaceRow = (workspace: FeatureWorkspaceNode) =>
    handlers.firstLevel === "workspaces" ? (
      <WorkspaceCard
        key={workspace.ref.key}
        node={workspace}
        projectId={workspace.projectId}
        projectName={workspace.projectName}
      />
    ) : (
      <WorkspaceGroup
        key={workspace.ref.key}
        node={workspace}
        projectId={workspace.projectId}
        projectName={workspace.projectName}
      />
    );

  /**
   * Open the feature folder's workspace the way a workspace card does: failed
   * or waiting work first, else the last conversation opened here, else the
   * oldest, else a new conversation bound to the folder. A feature whose
   * folder has no environment yet falls back to its requirement.
   */
  const openFeatureWorkspace = () => {
    const root = node.root;
    if (root === null) {
      rowActions.onRequirement(feature.id);
      return;
    }
    const target = workspaceOpenTarget({
      rollup: root.rollup,
      families: root.families,
      lastActiveThreadId: lastActiveFor(root.ref.key),
    });
    if (target.kind === "thread") {
      actions.open(target.threadId);
      handlers.onNavigate();
      return;
    }
    if (root.ref.canonicalEnvironmentId !== null) {
      navigate.toPluginPanel(NEW_CHAT_PANEL_PATH, {
        subPath: root.ref.canonicalEnvironmentId,
      });
    }
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
      key: "requirement",
      icon: "FileText",
      label: "Requirement & decisions…",
      onSelect: () => rowActions.onRequirement(feature.id),
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
          <RollupJump
            rollup={node.rollup}
            onJump={(threadId) => {
              actions.open(threadId);
              handlers.onNavigate();
            }}
            onFallback={
              workspacesMode ? openFeatureWorkspace : () => setExpanded(!expanded)
            }
          />
          {workspacesMode ? null : (
            <RowActionButton
              label={blocker ?? `New thread in ${feature.name}`}
              icon="Plus"
              disabled={blocker !== null}
              onClick={() => rowActions.onNewThread(feature.id)}
            />
          )}
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
    <TreeRowHandlersProvider value={handlers} override={reorderOverride}>
      <section
        aria-label={feature.name}
        data-nest-feature={feature.id}
        className="mt-1 first:mt-0"
      >
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
            { label: "Decisions", value: decisionSummary(node.meta) },
            {
              label: "Acceptance",
              value: node.meta.acceptanceSet ? "Written" : "Empty",
            },
            { label: "References", value: String(node.meta.refCount) },
          ]}
        />
        <div
          id={listId}
          ref={attachListAutoAnimateRef}
          className={cn("flex flex-col gap-0.5", expanded && "mt-0.5")}
        >
          {expanded ? (
            <>
              {handlers.firstLevel === "workspaces"
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
                      {!handlers.searching && (paged.hasMore || paged.page > 1) ? (
                        <PageControls {...paged.controlsProps} className="ml-4" />
                      ) : null}
                    </div>
                  )}
              {node.workspaces.map(workspaceRow)}
              {workspacesMode ? (
                <FeatureActionsRow
                  meta={node.meta}
                  repositories={node.members.length}
                  onRequirement={() => rowActions.onRequirement(feature.id)}
                  onRepositories={() => rowActions.onRepositories(feature.id)}
                />
              ) : (
                <>
                  <FeatureMetaLine
                    key="requirement"
                    meta={node.meta}
                    onOpen={(tab) => rowActions.onRequirement(feature.id, tab)}
                  />
                  {node.workspaces.length > 0 ? null : (
                    <RepositoriesLine
                      key="repositories"
                      members={node.members.map((member) => member.directory)}
                      empty={node.threadCount === 0}
                      onOpen={() => rowActions.onRepositories(feature.id)}
                    />
                  )}
                </>
              )}
            </>
          ) : null}
        </div>
      </section>
    </TreeRowHandlersProvider>
  );
});

/**
 * What the feature has recorded, on one line, and the way in.
 *
 * It sits beside the repositories because both answer "what is in this
 * feature" — one about folders, one about intent. A draft is called out because
 * it is the one state that waits for the person reading the sidebar.
 */
function FeatureMetaLine({
  meta,
  onOpen,
}: {
  meta: FeatureMetaSummary;
  onOpen: (tab: "requirement" | "decisions" | "references") => void;
}) {
  const parts = metaSummaryParts(meta);
  const label =
    parts.length === 0
      ? "Add a requirement, decisions and references"
      : parts.join(" · ");
  return (
    <button
      type="button"
      onClick={() => onOpen(meta.draftCount > 0 ? "decisions" : "requirement")}
      title="Requirement and decisions"
      className="group/requirement flex h-6 w-full min-w-0 items-center gap-1.5 rounded-md pl-4 pr-1.5 text-left text-2xs text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <Icon
        name="FileText"
        className="size-3 shrink-0 text-muted-foreground/60"
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 opacity-0 transition-opacity duration-150 group-hover/requirement:opacity-100 group-focus-visible/requirement:opacity-100 motion-reduce:transition-none">
        {meta.draftCount > 0 ? "Confirm" : parts.length === 0 ? "Add" : "Open"}
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
  onRequirement,
  onRepositories,
}: {
  meta: FeatureMetaSummary;
  repositories: number;
  onRequirement: () => void;
  onRepositories: () => void;
}) {
  const parts = metaSummaryParts(meta);
  return (
    <div className="flex items-center gap-1 pl-4 pr-1.5 py-0.5">
      <CompactButton
        icon="FileText"
        label={parts.length === 0 ? "Requirement" : parts.join(" · ")}
        title="Requirement and decisions"
        onClick={onRequirement}
      />
      <CompactButton
        icon="FolderGit"
        label="Repositories"
        title={`${repositories} ${repositories === 1 ? "repository" : "repositories"}`}
        onClick={onRepositories}
      />
    </div>
  );
}

function CompactButton({
  icon,
  label,
  title,
  onClick,
}: {
  icon: IconName;
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="flex h-6 min-w-0 flex-1 items-center justify-center gap-1 rounded-md border border-sidebar-border/70 px-1.5 text-2xs text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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

function decisionSummary(meta: FeatureMetaSummary): string {
  const parts: string[] = [];
  if (meta.activeDecisionCount > 0) {
    parts.push(`${meta.activeDecisionCount} standing`);
  }
  if (meta.draftCount > 0) parts.push(`${meta.draftCount} draft`);
  return parts.length === 0 ? "—" : parts.join(" · ");
}

/**
 * The feature's repositories on one line, and the way in to manage them.
 *
 * Drawn only while no member workspace has a row of its own: once one does,
 * the rows name the repositories and the menu manages them.
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
