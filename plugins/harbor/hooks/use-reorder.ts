import { useCallback } from "react";
import type { HarborViewStateApi } from "@/components/inbox/view-state-context";
import type { useHarborOrder } from "@/hooks/use-harbor-order";
import type { useViewPreferences } from "@/hooks/use-view-preferences";
import { useScopedReorder, type ScopedMovePlan } from "@/hooks/use-scoped-reorder";
import {
  keyboardFamilyMove,
  moveProjectFamily,
  type FamilyMoveResult,
} from "@/lib/domain/family-order";
import type { ProjectThreadGroup } from "@/lib/domain/inbox";
import { orderedProjectIds, projectOrderScope } from "@/lib/domain/ordering";
import {
  keyboardProjectMove,
  moveProject,
  type ProjectMoveResult,
} from "@/lib/domain/project-order";
import type { ThreadFilterPreset } from "@/lib/domain/thread-management";
import type { WorkspaceIndex } from "@/lib/domain/workspace-index";
import {
  keyboardWorkspaceMove,
  moveProjectWorkspace,
  orderWorkspaces,
  type WorkspaceMoveResult,
} from "@/lib/domain/workspace-order";

export interface ReorderInputs {
  readonly selectionMode: boolean;
  readonly filterPreset: ThreadFilterPreset;
  readonly searching: boolean;
  readonly viewPreferences: ReturnType<typeof useViewPreferences>;
  readonly order: ReturnType<typeof useHarborOrder>;
  readonly unfilteredProjectGroups: readonly ProjectThreadGroup[];
  readonly workspaceIndex: WorkspaceIndex;
  readonly setReorderAnnouncement: (message: string) => void;
  readonly viewStateApi: HarborViewStateApi;
  readonly rootTitleById: ReadonlyMap<string, string>;
  readonly groupsApi: {
    readonly assignment: Readonly<Record<string, string>>;
  };
}

const FAMILY_MESSAGES: Record<Exclude<FamilyMoveResult, { ok: true }>["reason"], string> = {
  "cross-project": "Thread families cannot move between projects.",
  "incomplete-order": "Reordering requires the complete project order.",
  "invalid-id": "That reorder request was invalid.",
  "missing-root": "That thread family cannot move farther in this direction.",
  "pinned-boundary": "Pinned and unpinned thread families cannot cross.",
  "same-root": "Thread family order did not change.",
};

const WORKSPACE_MESSAGES: Record<Exclude<WorkspaceMoveResult, { ok: true }>["reason"], string> = {
  "cross-project": "Worktrees cannot move between projects.",
  "invalid-id": "That reorder request was invalid.",
  "missing-workspace": "That worktree cannot move farther in this direction.",
  "same-workspace": "Worktree order did not change.",
};

const PROJECT_MESSAGES: Record<Exclude<ProjectMoveResult, { ok: true }>["reason"], string> = {
  "incomplete-order": "Project reordering requires the complete group order.",
  "invalid-id": "That project reorder request was invalid.",
  "missing-project": "That project cannot move farther in this direction.",
  "same-project": "Project order did not change.",
};

export function useReorder(input: ReorderInputs) {
  const {
    selectionMode,
    filterPreset,
    searching,
    viewPreferences,
    order,
    unfilteredProjectGroups,
    workspaceIndex,
    setReorderAnnouncement,
    viewStateApi,
    rootTitleById,
    groupsApi,
  } = input;

  const sharedBlocker = selectionMode
    ? "Exit bulk selection to reorder."
    : filterPreset !== "all"
      ? "Choose the All filter to reorder."
      : searching
        ? "Clear search to reorder."
        : null;
  const familyDisabledReason =
    sharedBlocker ??
    (viewPreferences.threadSort !== "manual"
      ? "Choose the Manual thread sort to drag thread families."
      : null);
  const workspaceDisabledReason =
    sharedBlocker ??
    (viewPreferences.worktreeSort !== "manual"
      ? "Choose the Manual worktree sort to drag worktrees."
      : null);
  const projectDisabledReason =
    sharedBlocker ??
    (viewPreferences.projectSort !== "manual"
      ? "Choose the Manual project sort to drag projects."
      : null);

  const familyInputsFor = useCallback(
    (projectId: string) => {
      const group = unfilteredProjectGroups.find((c) => c.project.id === projectId);
      if (group === undefined) return null;
      return {
        rootIds: group.families.map((f) => f.root.id),
        pinnedRootIds: group.families.filter((f) => f.root.isPinned).map((f) => f.root.id),
      };
    },
    [unfilteredProjectGroups],
  );

  const family = useScopedReorder<
    {
      sourceProjectId: string;
      sourceRootId: string;
      targetProjectId: string;
      targetRootId: string;
      position: "before" | "after";
    },
    [projectId: string, rootId: string, direction: -1 | 1]
  >({
    enabled: familyDisabledReason === null,
    disabledReason: familyDisabledReason,
    failureMessage: "Thread family order could not be saved.",
    announce: setReorderAnnouncement,
    persist: order.reorderFamilies,
    planDrag: useCallback(
      (move): ScopedMovePlan => {
        const project = familyInputsFor(move.targetProjectId);
        if (project === null) return { ok: false, message: "That project is no longer available." };
        const result = moveProjectFamily({ projectId: move.targetProjectId, ...move, ...project });
        if (!result.ok) return { ok: false, message: FAMILY_MESSAGES[result.reason] };
        return {
          ok: true,
          scopeId: move.targetProjectId,
          ids: result.order,
          successMessage: `Moved ${rootTitleById.get(move.sourceRootId) ?? "thread family"}.`,
        };
      },
      [familyInputsFor, rootTitleById],
    ),
    planKeyboard: useCallback(
      (projectId, rootId, direction): ScopedMovePlan => {
        const project = familyInputsFor(projectId);
        if (project === null) return { ok: false, message: null };
        const result = keyboardFamilyMove(projectId, project.rootIds, project.pinnedRootIds, rootId, direction);
        if (!result.ok) return { ok: false, message: FAMILY_MESSAGES[result.reason] };
        return {
          ok: true,
          scopeId: projectId,
          ids: result.order,
          successMessage: `Moved ${rootTitleById.get(rootId) ?? "thread family"} ${direction < 0 ? "up" : "down"}.`,
        };
      },
      [familyInputsFor, rootTitleById],
    ),
  });

  const workspaceKeysFor = useCallback(
    (projectId: string) => {
      if (!unfilteredProjectGroups.some((c) => c.project.id === projectId)) return null;
      const refs = workspaceIndex.byProject.get(projectId) ?? [];
      return orderWorkspaces(
        refs.map((ref) => ({ ref })),
        order.workspaces[projectId],
      )
        .filter((workspace) => workspace.ref.kind === "git-worktree")
        .map((workspace) => workspace.ref.key);
    },
    [order.workspaces, unfilteredProjectGroups, workspaceIndex.byProject],
  );

  const workspace = useScopedReorder<
    {
      sourceProjectId: string;
      sourceKey: string;
      targetProjectId: string;
      targetKey: string;
      position: "before" | "after";
    },
    [projectId: string, workspaceKey: string, direction: -1 | 1]
  >({
    enabled: workspaceDisabledReason === null,
    disabledReason: workspaceDisabledReason,
    failureMessage: "Worktree order could not be saved.",
    announce: setReorderAnnouncement,
    persist: order.reorderWorkspaces,
    onSelfDrop: useCallback(
      (move) => {
        if (move.sourceProjectId !== move.targetProjectId || move.sourceKey !== move.targetKey) {
          return false;
        }
        viewStateApi.setWorkspaceExpanded(move.targetKey, !viewStateApi.isWorkspaceExpanded(move.targetKey));
        return true;
      },
      [viewStateApi],
    ),
    planDrag: useCallback(
      (move): ScopedMovePlan => {
        const keys = workspaceKeysFor(move.targetProjectId);
        if (keys === null) return { ok: false, message: "That project is no longer available." };
        const result = moveProjectWorkspace({ projectId: move.targetProjectId, ...move, keys });
        if (!result.ok) return { ok: false, message: WORKSPACE_MESSAGES[result.reason] };
        return { ok: true, scopeId: move.targetProjectId, ids: result.keys, successMessage: "Moved worktree." };
      },
      [workspaceKeysFor],
    ),
    planKeyboard: useCallback(
      (projectId, workspaceKey, direction): ScopedMovePlan => {
        const keys = workspaceKeysFor(projectId);
        if (keys === null) return { ok: false, message: null };
        const result = keyboardWorkspaceMove(projectId, keys, workspaceKey, direction);
        if (!result.ok) return { ok: false, message: WORKSPACE_MESSAGES[result.reason] };
        return {
          ok: true,
          scopeId: projectId,
          ids: result.keys,
          successMessage: `Moved worktree ${direction < 0 ? "up" : "down"}.`,
        };
      },
      [workspaceKeysFor],
    ),
  });

  const project = useScopedReorder<
    { sourceProjectId: string; targetProjectId: string; position: "before" | "after" },
    [projectId: string, direction: -1 | 1]
  >({
    enabled: projectDisabledReason === null,
    disabledReason: projectDisabledReason,
    failureMessage: "Project order could not be saved.",
    announce: setReorderAnnouncement,
    persist: order.reorderProjects,
    onSelfDrop: useCallback(
      (move) => {
        if (move.sourceProjectId !== move.targetProjectId) return false;
        viewStateApi.setProjectCollapsed(move.targetProjectId, !viewStateApi.isProjectCollapsed(move.targetProjectId));
        return true;
      },
      [viewStateApi],
    ),
    planDrag: useCallback(
      (move): ScopedMovePlan => {
        const sourceScope = projectOrderScope(groupsApi.assignment, move.sourceProjectId);
        const targetScope = projectOrderScope(groupsApi.assignment, move.targetProjectId);
        if (sourceScope !== targetScope) {
          return {
            ok: false,
            message: "Projects can only be reordered within their group. Use Move to group to change groups.",
          };
        }
        const projectIds = orderedProjectIds(unfilteredProjectGroups, groupsApi.assignment, sourceScope);
        const result = moveProject({ projectIds, ...move });
        if (!result.ok) return { ok: false, message: PROJECT_MESSAGES[result.reason] };
        return { ok: true, scopeId: sourceScope, ids: result.order, successMessage: "Moved project." };
      },
      [groupsApi.assignment, unfilteredProjectGroups],
    ),
    planKeyboard: useCallback(
      (projectId, direction): ScopedMovePlan => {
        const scope = projectOrderScope(groupsApi.assignment, projectId);
        const result = keyboardProjectMove(
          orderedProjectIds(unfilteredProjectGroups, groupsApi.assignment, scope),
          projectId,
          direction,
        );
        if (!result.ok) return { ok: false, message: PROJECT_MESSAGES[result.reason] };
        const projectName = unfilteredProjectGroups.find((g) => g.project.id === projectId)?.project.name;
        return {
          ok: true,
          scopeId: scope,
          ids: result.order,
          successMessage: `Moved ${projectName ?? "project"} ${direction < 0 ? "up" : "down"}.`,
        };
      },
      [groupsApi.assignment, unfilteredProjectGroups],
    ),
  });

  return {
    reorderEnabled: familyDisabledReason === null,
    familyReorderDisabledReason: familyDisabledReason,
    workspaceReorderDisabledReason: workspaceDisabledReason,
    workspaceReorderEnabled: workspaceDisabledReason === null,
    projectReorderDisabledReason: projectDisabledReason,
    projectReorderEnabled: projectDisabledReason === null,
    pinnedReorderDisabledReason: sharedBlocker,
    pinnedReorderEnabled: sharedBlocker === null,
    reorderByDrag: family.reorderByDrag,
    reorderByKeyboard: family.reorderByKeyboard,
    reorderWorkspaceByDrag: workspace.reorderByDrag,
    reorderWorkspaceByKeyboard: workspace.reorderByKeyboard,
    reorderProjectByDrag: project.reorderByDrag,
    reorderProjectByKeyboard: project.reorderByKeyboard,
  };
}
