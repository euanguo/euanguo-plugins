import type { useNestOrder } from "@/hooks/use-nest-order";
import {
  keyboardFamilyMove,
  moveProjectFamily,
  type FamilyMoveResult,
} from "@/lib/family-order";
import type { ProjectThreadGroup } from "@/lib/inbox";
import { commitReorder } from "@/hooks/reorder/reorder-shared";

export function useFamilyReorder(input: {
  readonly enabled: boolean;
  readonly disabledReason: string | null;
  readonly order: ReturnType<typeof useNestOrder>;
  readonly projectGroups: readonly ProjectThreadGroup[];
  readonly rootTitleById: ReadonlyMap<string, string>;
  readonly announce: (message: string) => void;
}) {
  const projectOrderInputs = (projectId: string) => {
    const group = input.projectGroups.find(
      (candidate) => candidate.project.id === projectId,
    );
    if (group === undefined) return null;
    return {
      rootIds: group.families.map((family) => family.root.id),
      pinnedRootIds: group.families
        .filter((family) => family.root.isPinned)
        .map((family) => family.root.id),
    };
  };

  const announceRejectedMove = (result: FamilyMoveResult) => {
    if (result.ok) return;
    const messages: Record<
      Exclude<FamilyMoveResult, { ok: true }>["reason"],
      string
    > = {
      "cross-project": "Thread families cannot move between projects.",
      "incomplete-order": "Reordering requires the complete project order.",
      "invalid-id": "That reorder request was invalid.",
      "missing-root":
        "That thread family cannot move farther in this direction.",
      "pinned-boundary": "Pinned and unpinned thread families cannot cross.",
      "same-root": "Thread family order did not change.",
    };
    input.announce(messages[result.reason]);
  };

  const commitFamilyOrder = (
    projectId: string,
    rootIds: readonly string[],
    success: string,
  ) => {
    commitReorder(input.order.reorderFamilies(projectId, rootIds), {
      success,
      failure: "Thread family order could not be saved.",
      announce: input.announce,
    });
  };

  const reorderByDrag = (move: {
    sourceProjectId: string;
    sourceRootId: string;
    targetProjectId: string;
    targetRootId: string;
    position: "before" | "after";
  }) => {
    if (!input.enabled) {
      input.announce(input.disabledReason ?? "Reordering is unavailable.");
      return;
    }
    const project = projectOrderInputs(move.targetProjectId);
    if (project === null) {
      input.announce("That project is no longer available.");
      return;
    }
    const result = moveProjectFamily({
      projectId: move.targetProjectId,
      ...move,
      ...project,
    });
    if (!result.ok) {
      announceRejectedMove(result);
      return;
    }
    commitFamilyOrder(
      move.targetProjectId,
      result.order,
      `Moved ${input.rootTitleById.get(move.sourceRootId) ?? "thread family"}.`,
    );
  };

  const reorderByKeyboard = (
    projectId: string,
    rootId: string,
    direction: -1 | 1,
  ) => {
    if (!input.enabled) {
      input.announce(input.disabledReason ?? "Reordering is unavailable.");
      return;
    }
    const project = projectOrderInputs(projectId);
    if (project === null) return;
    const result = keyboardFamilyMove(
      projectId,
      project.rootIds,
      project.pinnedRootIds,
      rootId,
      direction,
    );
    if (!result.ok) {
      announceRejectedMove(result);
      return;
    }
    commitFamilyOrder(
      projectId,
      result.order,
      `Moved ${input.rootTitleById.get(rootId) ?? "thread family"} ${direction < 0 ? "up" : "down"}.`,
    );
  };

  return { reorderByDrag, reorderByKeyboard };
}
