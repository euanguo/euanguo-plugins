import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

import {
  FeaturesSection,
  FinishedShelf,
  type FeaturesSectionProps,
} from "@/components/inbox/feature-tree-panel";
import { ParkedFeaturesShelf } from "@/components/inbox/feature-parked-shelf";
import { GroupSection } from "@/components/inbox/group-section";
import { ParkedShelf } from "@/components/inbox/parked-shelf";
import {
  OrderChangedNotice,
  ThreadLoadFailure,
  ThreadViewNotice,
} from "@/components/inbox/thread-view-status";
import { TREE_SCROLL_CLASS } from "@/components/inbox/inbox-layout";
// The host's scrollport is turned off here, so the stylesheet travels with the
// element that owns the scrolling.
import "@/components/inbox/sidebar-geometry.css";
import type { useLifecycle } from "@/hooks/use-lifecycle";
import { useListAutoAnimate } from "@/hooks/use-list-auto-animate";
import type { Feature } from "@/lib/domain/features";
import type { ProjectGroup } from "@/lib/domain/groups";
import type { ProjectIcon } from "@/lib/domain/project-icons";
import type { ThreadFilterPreset } from "@/lib/domain/thread-management";
import type { GroupNode } from "@/lib/domain/tree";
import type { ThreadViewSource } from "@/lib/domain/thread-snapshot";

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
  /** The section above the groups, and the shelves its parked/finished features go to. */
  readonly features: FeaturesSectionProps & {
    readonly parked: readonly Feature[];
    readonly archived: readonly Feature[];
    readonly onUnpark: (featureId: string) => void;
    readonly onReopen: (featureId: string) => void;
  };
  readonly tree: {
    readonly nodes: readonly GroupNode[];
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
      data-harbor-scroll=""
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
            ? "No threads found"
            : empty.filter === "all" && empty.projectCount === 0
              ? "No projects yet"
              : "No threads match this filter"}
        </div>
      ) : (
        <div ref={attachTreeAutoAnimateRef}>
          <FeaturesSection {...features} />
          <ParkedFeaturesShelf
            parked={features.parked}
            now={shelves.now}
            onUnpark={features.onUnpark}
            onFinish={features.actions.onFinish}
            onDelete={features.actions.onDelete}
          />
          {tree.nodes.map((node) => (
            <GroupSection
              key={node.groupId ?? "__ungrouped__"}
              node={node}
              groups={tree.groups}
              onAssignGroup={tree.assignGroup}
              onNewThreadInProject={tree.seedFromProject}
              onNewWorktree={tree.seedNewWorktree}
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
              <FinishedShelf
                archived={features.archived}
                onReopen={features.onReopen}
                onDelete={features.actions.onDelete}
              />
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
