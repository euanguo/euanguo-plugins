import type { useRpc } from "@get-bb/plugin-sdk/app";

import type { nestRpcContract } from "@/server/contract";
import type { useGroups } from "@/hooks/use-groups";
import type { useViewPreferences } from "@/hooks/use-view-preferences";
import { errorMessage } from "@/lib/errors";
import type { ProjectThreadGroup } from "@/lib/inbox";
import { DEFAULT_ORGANIZATION_MODE } from "@/lib/organization";
import {
  UNGROUPED_SCOPE_KEY,
  type NestViewState,
} from "@/lib/view-state";

export interface InboxActions {
  assignGroup(projectId: string, groupId: string | null): void;
  renameGroup(groupId: string, name: string): void;
  removeGroup(groupId: string): void;
  moveGroup(groupId: string, delta: -1 | 1): void;
  renameProject(projectId: string, name: string): void;
  renameWorktree(environmentId: string, name: string): void;
  collapseAll(): void;
  resetView(): void;
}

export function useInboxActions(input: {
  readonly rpc: ReturnType<typeof useRpc<typeof nestRpcContract>>;
  readonly groupsApi: ReturnType<typeof useGroups>;
  readonly viewPreferences: ReturnType<typeof useViewPreferences>;
  readonly unfilteredProjectGroups: readonly ProjectThreadGroup[];
  readonly patchViewState: (patch: Partial<NestViewState>) => void;
  readonly announce: (message: string) => void;
}): InboxActions {
  const {
    rpc,
    groupsApi,
    viewPreferences,
    unfilteredProjectGroups,
    patchViewState,
    announce,
  } = input;

  const report = (fallback: string) => (error: unknown) =>
    announce(errorMessage(error, fallback));

  const assignGroup = (projectId: string, groupId: string | null) => {
    void rpc
      .call("assignProjectToGroup", { projectId, groupId })
      .then(() => groupsApi.refresh())
      .catch(report("Could not file the project."));
  };

  const renameGroup = (groupId: string, name: string) => {
    void rpc
      .call("renameGroup", { groupId, name })
      .then(() => groupsApi.refresh())
      .catch(report("Could not rename the group."));
  };

  const removeGroup = (groupId: string) => {
    void rpc
      .call("deleteGroup", { groupId })
      .then(() => groupsApi.refresh())
      .catch(report("Could not delete the group."));
  };

  const moveGroup = (groupId: string, delta: -1 | 1) => {
    const ids = groupsApi.groups.map((group) => group.id);
    const from = ids.indexOf(groupId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, groupId);
    void rpc
      .call("reorderGroups", { groupIds: next })
      .then(() => groupsApi.refresh())
      .catch(report("Could not reorder groups."));
  };

  const renameProject = (projectId: string, name: string) => {
    void rpc
      .call("renameProject", { projectId, name })
      .catch(report("Could not rename the project."));
  };

  const renameWorktree = (environmentId: string, name: string) => {
    void rpc
      .call("renameEnvironment", { environmentId, name })
      .catch(report("Could not rename the workspace."));
  };

  const collapseAll = () => {
    patchViewState({
      collapsedGroups: [
        ...groupsApi.groups.map((group) => group.id),
        UNGROUPED_SCOPE_KEY,
      ],
      collapsedProjects: unfilteredProjectGroups.map(
        (group) => group.project.id,
      ),
    });
  };

  const resetView = () => {
    patchViewState({ filter: "all" });
    viewPreferences.setProjectSort("manual");
    viewPreferences.setThreadSort("manual");
    viewPreferences.setWorktreeSort("manual");
    viewPreferences.setOrganizationMode(DEFAULT_ORGANIZATION_MODE);
  };

  return {
    assignGroup,
    renameGroup,
    removeGroup,
    moveGroup,
    renameProject,
    renameWorktree,
    collapseAll,
    resetView,
  };
}
