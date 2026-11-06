import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

import {
  FeatureTree,
  NewFeatureRow,
  type FeatureTreeProps,
} from "@/components/inbox/feature-tree-panel";
import { GroupSection } from "@/components/inbox/group-section";
import { ParkedShelf } from "@/components/inbox/parked-shelf";
import {
  OrderChangedNotice,
  ThreadLoadFailure,
  ThreadViewNotice,
} from "@/components/inbox/thread-view-status";
import { TREE_SCROLL_CLASS } from "@/components/inbox/inbox-layout";
import type {
  TreeRowHandlers,
  WorkspaceLaunch,
} from "@/components/inbox/tree-rows";
import { useLifecycle } from "@/hooks/use-lifecycle";
import { useListAutoAnimate } from "@/hooks/use-list-auto-animate";
import type { ProjectGroup } from "@/lib/groups";
import type { ProjectIcon } from "@/lib/project-icons";
import type { ThreadFilterPreset } from "@/lib/thread-management";
import type { GroupNode } from "@/lib/tree";
import type { ThreadViewSource } from "@/lib/thread-snapshot";

export interface InboxTreePanelProps {
  readonly panelId: string;
  readonly activeScopeKey: string;
  readonly notice: {
    readonly text: string | null;
    readonly source: ThreadViewSource;
    readonly status: "loading" | "ready" | "error";
    readonly recovering: boolean;
    readonly error: string | null;
    readonly onRetry: () => void;
    readonly onUseOriginal: () => void;
  };
  readonly ordering: {
    readonly changedElsewhere: boolean;
    readonly reload: () => void;
  };
  readonly empty: {
    readonly lifecycleReady: boolean;
    readonly nothingToShow: boolean;
    readonly searching: boolean;
    readonly filter: ThreadFilterPreset;
    readonly projectCount: number;
  };
  /**
   * The feature view's rows. Present means the first level is features: the
   * panel keeps its notices, empty state and shelves, and draws these where the
   * project groups would be.
   */
  readonly features?: FeatureTreeProps;
  readonly tree: {
    readonly nodes: readonly GroupNode[];
    readonly handlers: TreeRowHandlers;
    readonly groups: readonly ProjectGroup[];
    readonly assignGroup: (projectId: string, groupId: string | null) => void;
    readonly seedFromProject: (
      projectId: string,
      projectName: string,
    ) => void;
    readonly seedNewWorktree: (
      projectId: string,
      projectName: string,
    ) => void;
    readonly seedFromWorkspace: (launch: WorkspaceLaunch) => void;
    readonly projectColorOverrides: ReadonlyMap<string, string>;
    readonly projectIcons: ReadonlyMap<string, ProjectIcon>;
    readonly projectReorder: {
      readonly enabled: boolean;
      readonly next: (projectId: string, delta: -1 | 1) => void;
      readonly drop: (
        sourceProjectId: string,
        targetProjectId: string,
        position: "before" | "after",
      ) => void;
    };
  };
  readonly shelves: {
    readonly shown: boolean;
    readonly snoozed: readonly PluginSidebarThread[];
    readonly settled: readonly PluginSidebarThread[];
    readonly pendingSettled: number;
    readonly showSnoozed: boolean;
    readonly showSettled: boolean;
    readonly activeThreadId: string | null;
    readonly lifecycle: ReturnType<typeof useLifecycle>;
    readonly navigate: () => void;
    readonly now: number;
    readonly settledLimit: number;
    readonly settledPageSize: number;
    readonly searching: boolean;
    readonly settledPages: number;
    readonly toggleSnoozed: () => void;
    readonly toggleSettled: () => void;
    readonly loadMoreSettled: () => void;
    readonly showLessSettled: () => void;
  };
}

export function InboxTreePanel({
  panelId,
  activeScopeKey,
  notice,
  ordering,
  empty,
  features,
  tree,
  shelves,
}: InboxTreePanelProps) {
  const attachTreeAutoAnimateRef = useListAutoAnimate<HTMLDivElement>();

  return (
    <div
      data-nest-scroll=""
      id={panelId}
      role="tabpanel"
      aria-labelledby={`${panelId}-tab-${encodeURIComponent(activeScopeKey)}`}
      tabIndex={-1}
      className={TREE_SCROLL_CLASS}
    >
      {notice.text === null ? null : <ThreadViewNotice text={notice.text} />}
      {ordering.changedElsewhere ? (
        <OrderChangedNotice onReload={ordering.reload} />
      ) : null}
      {notice.source === "none" ? (
        notice.status === "error" ? (
          <ThreadLoadFailure
            recovering={notice.recovering}
            error={notice.error}
            onRetry={notice.onRetry}
            onUseOriginal={notice.onUseOriginal}
          />
        ) : null
      ) : !empty.lifecycleReady ? null : empty.nothingToShow ? (
        <div role="status" className="px-2 py-6 text-center text-xs text-muted-foreground">
          {empty.searching
            ? features === undefined
              ? "No threads found"
              : "No features found"
            : features !== undefined
              ? empty.filter === "all"
                ? "No features yet. A feature gathers the repositories one piece of work touches, in one folder you can talk in."
                : "No feature has threads that match this filter"
              : empty.filter === "all" && empty.projectCount === 0
                ? "No projects yet"
                : "No threads match this filter"}
          {features !== undefined && !empty.searching && empty.filter === "all" ? (
            <div className="mx-auto mt-3 max-w-52">
              <NewFeatureRow onCreate={features.onCreate} />
            </div>
          ) : null}
        </div>
      ) : (
        <div ref={attachTreeAutoAnimateRef}>
          {features !== undefined ? (
            <FeatureTree {...features} handlers={tree.handlers} />
          ) : tree.nodes.map((node) => (
            <GroupSection
              key={node.groupId ?? "__ungrouped__"}
              node={node}
              handlers={tree.handlers}
              groups={tree.groups}
              onAssignGroup={tree.assignGroup}
              onNewThreadInProject={tree.seedFromProject}
              onNewWorktree={tree.seedNewWorktree}
              onNewThreadInWorkspace={tree.seedFromWorkspace}
              projectColorOverrides={tree.projectColorOverrides}
              projectIcons={tree.projectIcons}
              projectReorder={tree.projectReorder}
            />
          ))}
          {shelves.shown ? (
            <>
              <ParkedShelf
                label="Snoozed"
                threads={shelves.snoozed}
                expanded={shelves.showSnoozed}
                onToggle={shelves.toggleSnoozed}
                shelf="snoozed"
                activeThreadId={shelves.activeThreadId}
                lifecycle={shelves.lifecycle}
                onNavigate={shelves.navigate}
                now={shelves.now}
              />
              <ParkedShelf
                label="Settled"
                threads={shelves.settled}
                pendingCount={shelves.pendingSettled}
                expanded={shelves.showSettled}
                onToggle={shelves.toggleSettled}
                shelf="settled"
                activeThreadId={shelves.activeThreadId}
                lifecycle={shelves.lifecycle}
                onNavigate={shelves.navigate}
                now={shelves.now}
                settledLimit={shelves.settledLimit}
                settledPageSize={shelves.settledPageSize}
                searching={shelves.searching}
                page={shelves.settledPages}
                onLoadMore={shelves.loadMoreSettled}
                onShowLess={shelves.showLessSettled}
              />
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
