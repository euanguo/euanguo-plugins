import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

import type { ProviderGlyphInfo } from "@/components/inbox/provider-glyph";
import type { LifecycleApi } from "@/hooks/use-lifecycle";
import type { WorkspacePaths } from "@/lib/domain/workspace";
import type { HarborPreferences } from "@/lib/domain/preferences";
import type { RootSelectionIntent } from "@/lib/domain/thread-management";
import type { WorkspaceNode } from "@/lib/domain/tree";
import type { WorkspaceChangeCount } from "@/lib/ui/workspace-change-counts";
import type { WorkspacePullRequest } from "@/lib/domain/pull-request";

export interface FamilyReorderInput {
  readonly sourceProjectId: string;
  readonly sourceRootId: string;
  readonly targetProjectId: string;
  readonly targetRootId: string;
  readonly position: "before" | "after";
}

export interface WorkspaceLaunch {
  readonly node: WorkspaceNode;
  readonly projectId: string;
  readonly projectName: string;
}

/** Stable callbacks and presentation metadata for the inbox tree. */
export interface TreeActions {
  /**
   * How far down the tree draws: Threads opens a workspace onto its
   * conversations, Workspaces stops at the workspace row.
   */
  readonly firstLevel: "threads" | "workspaces";
  readonly providerInfoById: ReadonlyMap<string, ProviderGlyphInfo>;
  /** Human-readable host name keyed by host ID, when known. */
  readonly hostNameById?: ReadonlyMap<string, string>;
  /** Physical repository metadata keyed by project ID. */
  readonly repoByProject?: ReadonlyMap<
    string,
    { readonly repoKey: string; readonly remoteUrl: string | null }
  >;
  readonly preferences: HarborPreferences;
  readonly onNavigate: () => void;
  readonly selectionHintId: string;
  readonly onToggleRoot: (
    threadId: string,
    intent: RootSelectionIntent,
  ) => void;
  readonly onNewThreadInWorkspace: (launch: WorkspaceLaunch) => void;
  readonly reorderEnabled: boolean;
  readonly reorderDisabledReason: string | null;
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
  readonly pinnedReorderEnabled: boolean;
  readonly pinnedReorderDisabledReason: string | null;
  readonly onPinnedKeyboardMove: (
    rootId: string,
    direction: -1 | 1,
  ) => void;
  readonly onUnarchiveArchived: (threadId: string) => void;
  readonly onGroupMove?: (groupId: string, delta: -1 | 1) => void;
  readonly onRenameGroup: (groupId: string, name: string) => void;
  readonly onRemoveGroup: (groupId: string) => void;
  readonly onRenameWorktree: (environmentId: string, name: string) => void;
  readonly featureOfWorkspace?: (ref: WorkspaceNode["ref"]) => {
    readonly id: string;
    readonly name: string;
    /** True when the path puts it there; false when it was adopted from outside. */
    readonly byPath: boolean;
  } | null;
  /** Open a feature in the Features section and scroll to it. */
  readonly onRevealFeature?: (featureId: string) => void;
  readonly onAdoptWorkspace?: (environmentId: string, featureId: string | null) => void;
  readonly adoptableFeatures?: readonly { readonly id: string; readonly name: string }[];
  readonly onPromoteWorkspace?: (input: {
    readonly environmentId: string;
    readonly workspaceLabel: string;
    readonly branch: string | null;
    readonly projectId: string;
  }) => void;
  readonly onActivateOrphanWorktree?: (input: {
    readonly hostId: string;
    readonly projectId: string;
    readonly path: string;
    readonly branch: string | null;
  }) => void;
}

/** Frequently-changing live state read by rows across the inbox tree. */
export interface TreeLiveState {
  readonly activeThreadId: string | null;
  readonly activeWorkspaceKey: string | null;
  readonly searching: boolean;
  readonly forceExpanded: boolean;
  readonly now: number;
  readonly lifecycle: LifecycleApi;
  readonly paths: WorkspacePaths;
  readonly pullRequests: ReadonlyMap<string, WorkspacePullRequest>;
  readonly workspaceChanges: ReadonlyMap<string, WorkspaceChangeCount>;
  readonly selectionMode: boolean;
  readonly selectedRootIds: ReadonlySet<string>;
  readonly archivedByProject: ReadonlyMap<
    string,
    readonly PluginSidebarThread[]
  >;
}
