import { useCallback } from "react";

import type { useHarborOrder } from "@/hooks/use-harbor-order";
import type { HarborViewStateApi } from "@/components/inbox/view-state-context";
import type { ProjectThreadGroup } from "@/lib/domain/inbox";
import {
  keyboardWorkspaceMove,
  moveProjectWorkspace,
  orderWorkspaces,
  type WorkspaceMoveResult,
} from "@/lib/domain/workspace-order";
import type { WorkspaceIndex } from "@/lib/domain/workspace-index";
import { commitReorder } from "@/hooks/reorder/reorder-shared";

export function useWorkspaceReorder(input: {
  readonly enabled: boolean;
  readonly disabledReason: string | null;
  readonly order: ReturnType<typeof useHarborOrder>;
  readonly projectGroups: readonly ProjectThreadGroup[];
  readonly workspaceIndex: WorkspaceIndex;
  readonly viewStateApi: HarborViewStateApi;
  readonly announce: (message: string) => void;
}) {
  const {
    enabled,
    disabledReason,
    order,
    projectGroups,
    workspaceIndex,
    viewStateApi,
    announce,
  } = input;
  const { reorderWorkspaces, workspaces } = order;
  const workspaceIndexByProject = workspaceIndex.byProject;

  const workspaceOrderInputs = useCallback(
    (projectId: string) => {
      const group = projectGroups.find(
        (candidate) => candidate.project.id === projectId,
      );
      if (group === undefined) return null;
      const refs = workspaceIndexByProject.get(projectId) ?? [];
      return {
        keys: orderWorkspaces(
          refs.map((ref) => ({ ref })),
          workspaces[projectId],
        )
          .filter((workspace) => workspace.ref.kind === "git-worktree")
          .map((workspace) => workspace.ref.key),
      };
    },
    [projectGroups, workspaceIndexByProject, workspaces],
  );

  const commitWorkspaceOrder = useCallback(
    (
      projectId: string,
      keys: readonly string[],
      success: string,
    ) => {
      commitReorder(reorderWorkspaces(projectId, keys), {
        success,
        failure: "Worktree order could not be saved.",
        announce,
      });
    },
    [announce, reorderWorkspaces],
  );

  const announceRejectedMove = useCallback(
    (result: WorkspaceMoveResult) => {
      if (result.ok) return;
      const messages: Record<
        Exclude<WorkspaceMoveResult, { ok: true }>["reason"],
        string
      > = {
        "cross-project": "Worktrees cannot move between projects.",
        "invalid-id": "That reorder request was invalid.",
        "missing-workspace":
          "That worktree cannot move farther in this direction.",
        "same-workspace": "Worktree order did not change.",
      };
      announce(messages[result.reason]);
    },
    [announce],
  );

  const reorderWorkspaceByDrag = useCallback(
    (move: {
      sourceProjectId: string;
      sourceKey: string;
      targetProjectId: string;
      targetKey: string;
      position: "before" | "after";
    }) => {
      if (
        move.sourceProjectId === move.targetProjectId &&
        move.sourceKey === move.targetKey
      ) {
        viewStateApi.setWorkspaceExpanded(
          move.targetKey,
          !viewStateApi.isWorkspaceExpanded(move.targetKey),
        );
        return;
      }
      if (!enabled) {
        announce(disabledReason ?? "Reordering is unavailable.");
        return;
      }
      const project = workspaceOrderInputs(move.targetProjectId);
      if (project === null) {
        announce("That project is no longer available.");
        return;
      }
      const result = moveProjectWorkspace({
        projectId: move.targetProjectId,
        ...move,
        keys: project.keys,
      });
      if (!result.ok) {
        announceRejectedMove(result);
        return;
      }
      commitWorkspaceOrder(move.targetProjectId, result.keys, "Moved worktree.");
    },
    [
      announce,
      announceRejectedMove,
      commitWorkspaceOrder,
      disabledReason,
      enabled,
      viewStateApi,
      workspaceOrderInputs,
    ],
  );

  const reorderWorkspaceByKeyboard = useCallback(
    (projectId: string, workspaceKey: string, direction: -1 | 1) => {
      if (!enabled) {
        announce(disabledReason ?? "Reordering is unavailable.");
        return;
      }
      const project = workspaceOrderInputs(projectId);
      if (project === null) return;
      const result = keyboardWorkspaceMove(
        projectId,
        project.keys,
        workspaceKey,
        direction,
      );
      if (!result.ok) {
        announceRejectedMove(result);
        return;
      }
      commitWorkspaceOrder(
        projectId,
        result.keys,
        `Moved worktree ${direction < 0 ? "up" : "down"}.`,
      );
    },
    [
      announce,
      announceRejectedMove,
      commitWorkspaceOrder,
      disabledReason,
      enabled,
      workspaceOrderInputs,
    ],
  );

  return { reorderWorkspaceByDrag, reorderWorkspaceByKeyboard };
}
