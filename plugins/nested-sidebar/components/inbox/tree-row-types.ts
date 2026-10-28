import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

import type { ProviderGlyphInfo } from "@/components/inbox/provider-glyph";
import type { LifecycleApi } from "@/hooks/use-lifecycle";
import type { WorkspacePaths } from "@/hooks/use-workspace-paths";
import type { NestPreferences } from "@/lib/preferences";
import type { RootSelectionIntent } from "@/lib/thread-management";
import type { WorkspaceNode } from "@/lib/tree";

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
  readonly providerInfoById: ReadonlyMap<string, ProviderGlyphInfo>;
  readonly activeThreadId: string | null;
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
}
