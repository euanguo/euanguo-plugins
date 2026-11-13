import { useCallback } from "react";

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
  const { call } = rpc;
  const { groups, refresh } = groupsApi;

  const report = useCallback(
    (fallback: string) => (error: unknown) =>
      announce(errorMessage(error, fallback)),
    [announce],
  );

  const assignGroup = useCallback(
    (projectId: string, groupId: string | null) => {
      void call("assignProjectToGroup", { projectId, groupId })
        .then(() => refresh())
        .catch(report("Could not file the project."));
    },
    [call, refresh, report],
  );

  const renameGroup = useCallback(
    (groupId: string, name: string) => {
      void call("renameGroup", { groupId, name })
        .then(() => refresh())
        .catch(report("Could not rename the group."));
    },
    [call, refresh, report],
  );

  const removeGroup = useCallback(
    (groupId: string) => {
      void call("deleteGroup", { groupId })
        .then(() => refresh())
        .catch(report("Could not delete the group."));
    },
    [call, refresh, report],
  );

  const moveGroup = useCallback(
    (groupId: string, delta: -1 | 1) => {
      const ids = groups.map((group) => group.id);
      const from = ids.indexOf(groupId);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= ids.length) return;
      const next = [...ids];
      next.splice(from, 1);
      next.splice(to, 0, groupId);
      void call("reorderGroups", { groupIds: next })
        .then(() => refresh())
        .catch(report("Could not reorder groups."));
    },
    [call, groups, refresh, report],
  );

  const renameProject = useCallback(
    (projectId: string, name: string) => {
      void call("renameProject", { projectId, name })
        .catch(report("Could not rename the project."));
    },
    [call, report],
  );

  const renameWorktree = useCallback(
    (environmentId: string, name: string) => {
      void call("renameEnvironment", { environmentId, name })
        .catch(report("Could not rename the workspace."));
    },
    [call, report],
  );

  const collapseAll = useCallback(() => {
    patchViewState({
      collapsedGroups: [
        ...groups.map((group) => group.id),
        UNGROUPED_SCOPE_KEY,
      ],
      collapsedProjects: unfilteredProjectGroups.map(
        (group) => group.project.id,
      ),
    });
  }, [groups, patchViewState, unfilteredProjectGroups]);

  const resetView = useCallback(() => {
    patchViewState({ filter: "all" });
    viewPreferences.setProjectSort("manual");
    viewPreferences.setThreadSort("manual");
    viewPreferences.setWorktreeSort("manual");
    viewPreferences.setOrganizationMode(DEFAULT_ORGANIZATION_MODE);
  }, [
    patchViewState,
    viewPreferences.setOrganizationMode,
    viewPreferences.setProjectSort,
    viewPreferences.setThreadSort,
    viewPreferences.setWorktreeSort,
  ]);

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
