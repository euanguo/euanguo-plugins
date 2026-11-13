import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

import type { ProviderGlyphInfo } from "@/components/inbox/provider-glyph";
import type { LifecycleApi } from "@/hooks/use-lifecycle";
import type { WorkspacePaths } from "@/hooks/use-workspace-paths";
import type { NestPreferences } from "@/lib/preferences";
import type { RootSelectionIntent } from "@/lib/thread-management";
import type { WorkspaceNode } from "@/lib/tree";
import type { WorkspaceChangeCount } from "@/lib/workspace-change-counts";
import type { WorkspacePullRequest } from "@/lib/workspace-pull-requests";

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

export interface WorkspaceLaunch {
  readonly node: WorkspaceNode;
  readonly projectId: string;
  readonly projectName: string;
}

export interface TreeRowHandlers {
  /**
   * How far down the tree draws: Threads opens a workspace onto its
   * conversations, Workspaces stops at the workspace row.
   */
  readonly firstLevel: "threads" | "workspaces";
  readonly providerInfoById: ReadonlyMap<string, ProviderGlyphInfo>;
  /** Pull request per environment id, read once for the whole list. */
  readonly pullRequests: ReadonlyMap<string, WorkspacePullRequest>;
  /** Uncommitted line counts per environment id, read once for the whole list. */
  readonly workspaceChanges: ReadonlyMap<string, WorkspaceChangeCount>;
  readonly activeThreadId: string | null;
  /** The workspace the open thread runs in, for the row it highlights. */
  readonly activeWorkspaceKey: string | null;
  readonly searching: boolean;
  readonly forceExpanded: boolean;
  readonly lifecycle: LifecycleApi;
  readonly onNavigate: () => void;
  readonly now: number;
  readonly selectionMode: boolean;
  readonly selectedRootIds: ReadonlySet<string>;
  readonly selectionHintId: string;
  readonly onToggleRoot: (
    threadId: string,
    intent: RootSelectionIntent,
  ) => void;
  readonly onNewThreadInWorkspace: (launch: WorkspaceLaunch) => void;
  readonly preferences: NestPreferences;
  readonly paths: WorkspacePaths;
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
  readonly archivedByProject: ReadonlyMap<
    string,
    readonly PluginSidebarThread[]
  >;
  readonly onUnarchiveArchived: (threadId: string) => void;
  readonly projectReorderEnabled: boolean;
  readonly projectReorderDisabledReason: string | null;
  readonly onProjectReorder: (input: ProjectReorderInput) => void;
  readonly onProjectKeyboardMove: (
    projectId: string,
    direction: -1 | 1,
  ) => void;
  readonly onGroupMove?: (groupId: string, delta: -1 | 1) => void;
  readonly onRenameGroup: (groupId: string, name: string) => void;
  readonly onRemoveGroup: (groupId: string) => void;
  readonly onRenameProject: (projectId: string, name: string) => void;
  readonly onRenameWorktree: (environmentId: string, name: string) => void;
  /**
   * The feature a worktree row belongs to, by path or by adoption, for the
   * row's menu. Absent in tests and the flat fallback.
   */
  readonly featureOfWorkspace?: (ref: WorkspaceNode["ref"]) => {
    readonly id: string;
    readonly name: string;
    /** True when the path puts it there; false when it was adopted from outside. */
    readonly byPath: boolean;
  } | null;
  /** Open a feature in the Features section and scroll to it. */
  readonly onRevealFeature?: (featureId: string) => void;
  /**
   * Adopting a worktree from outside any feature folder, or releasing it.
   * Only offered for a worktree no feature folder contains.
   */
  readonly onAdoptWorkspace?: (environmentId: string, featureId: string | null) => void;
  readonly adoptableFeatures?: readonly { readonly id: string; readonly name: string }[];
}
