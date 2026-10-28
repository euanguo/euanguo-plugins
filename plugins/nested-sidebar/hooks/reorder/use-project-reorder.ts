import type { useNestOrder } from "@/hooks/use-nest-order";
import type { NestViewStateApi } from "@/components/inbox/view-state-context";
import type { ProjectThreadGroup } from "@/lib/inbox";
import { orderedProjectIds, projectOrderScope } from "@/lib/ordering";
import {
  keyboardProjectMove,
  moveProject,
  type ProjectMoveResult,
} from "@/lib/project-order";
import { commitReorder } from "@/hooks/reorder/reorder-shared";

export function useProjectReorder(input: {
  readonly enabled: boolean;
  readonly disabledReason: string | null;
  readonly order: ReturnType<typeof useNestOrder>;
  readonly projectGroups: readonly ProjectThreadGroup[];
  readonly groupAssignment: Readonly<Record<string, string>>;
  readonly viewStateApi: NestViewStateApi;
  readonly announce: (message: string) => void;
}) {
  const commitProjectOrder = (
    groupId: string,
    projectIds: readonly string[],
    success: string,
  ) => {
    commitReorder(input.order.reorderProjects(groupId, projectIds), {
      success,
      failure: "Project order could not be saved.",
      announce: input.announce,
    });
  };

  const announceRejectedMove = (result: ProjectMoveResult) => {
    if (result.ok) return;
    const messages: Record<
      Exclude<ProjectMoveResult, { ok: true }>["reason"],
      string
    > = {
      "incomplete-order":
        "Project reordering requires the complete group order.",
      "invalid-id": "That project reorder request was invalid.",
      "missing-project":
        "That project cannot move farther in this direction.",
      "same-project": "Project order did not change.",
    };
    input.announce(messages[result.reason]);
  };

  const reorderProjectByDrag = (move: {
    sourceProjectId: string;
    targetProjectId: string;
    position: "before" | "after";
  }) => {
    if (move.sourceProjectId === move.targetProjectId) {
      input.viewStateApi.setProjectCollapsed(
        move.targetProjectId,
        !input.viewStateApi.isProjectCollapsed(move.targetProjectId),
      );
      return;
    }
    if (!input.enabled) {
      input.announce(input.disabledReason ?? "Reordering is unavailable.");
      return;
    }
    const sourceScope = projectOrderScope(
      input.groupAssignment,
      move.sourceProjectId,
    );
    const targetScope = projectOrderScope(
      input.groupAssignment,
      move.targetProjectId,
    );
    if (sourceScope !== targetScope) {
      input.announce(
        "Projects can only be reordered within their group. Use Move to group to change groups.",
      );
      return;
    }
    const result = moveProject({
      projectIds: orderedProjectIds(
        input.projectGroups,
        input.groupAssignment,
        sourceScope,
      ),
      ...move,
    });
    if (!result.ok) {
      announceRejectedMove(result);
      return;
    }
    commitProjectOrder(sourceScope, result.order, "Moved project.");
  };

  const reorderProjectByKeyboard = (
    projectId: string,
    direction: -1 | 1,
  ) => {
    if (!input.enabled) {
      input.announce(input.disabledReason ?? "Reordering is unavailable.");
      return;
    }
    const scope = projectOrderScope(input.groupAssignment, projectId);
    const result = keyboardProjectMove(
      orderedProjectIds(
        input.projectGroups,
        input.groupAssignment,
        scope,
      ),
      projectId,
      direction,
    );
    if (!result.ok) {
      announceRejectedMove(result);
      return;
    }
    const projectName = input.projectGroups.find(
      (group) => group.project.id === projectId,
    )?.project.name;
    commitProjectOrder(
      scope,
      result.order,
      `Moved ${projectName ?? "project"} ${direction < 0 ? "up" : "down"}.`,
    );
  };

  const reorderProjectDrop = (
    sourceProjectId: string,
    targetProjectId: string,
    position: "before" | "after",
  ) => {
    reorderProjectByDrag({ sourceProjectId, targetProjectId, position });
  };

  return {
    reorderProjectByDrag,
    reorderProjectByKeyboard,
    reorderProjectDrop,
  };
}
