import type { useNestOrder } from "@/hooks/use-nest-order";
import type { NestViewStateApi } from "@/components/inbox/view-state-context";
import type { ProjectThreadGroup } from "@/lib/inbox";
import { projectWorkspaceRefs } from "@/lib/tree";
import {
  keyboardWorkspaceMove,
  moveProjectWorkspace,
  orderWorkspaces,
  type WorkspaceMoveResult,
} from "@/lib/workspace-order";
import type {
  UnseenOwnedWorkspace,
  WorkspaceOwnershipMap,
} from "@/lib/workspace-ownership";
import type {
  WorkspaceEnvironmentDescriptor,
  WorkspaceProjectDescriptor,
} from "@/lib/workspace";
import { commitReorder } from "@/hooks/reorder/reorder-shared";

export function useWorkspaceReorder(input: {
  readonly enabled: boolean;
  readonly disabledReason: string | null;
  readonly order: ReturnType<typeof useNestOrder>;
  readonly projectGroups: readonly ProjectThreadGroup[];
  readonly paths: {
    readonly environments: Readonly<
      Record<string, WorkspaceEnvironmentDescriptor>
    >;
    readonly projects: Readonly<Record<string, WorkspaceProjectDescriptor>>;
  };
  readonly workspaceOwnership: WorkspaceOwnershipMap | undefined;
  readonly unseenWorkspaces:
    | Readonly<Record<string, readonly UnseenOwnedWorkspace[]>>
    | undefined;
  readonly viewStateApi: NestViewStateApi;
  readonly announce: (message: string) => void;
}) {
  const workspaceOrderInputs = (projectId: string) => {
    const group = input.projectGroups.find(
      (candidate) => candidate.project.id === projectId,
    );
    if (group === undefined) return null;
    const refs = projectWorkspaceRefs(
      projectId,
      group.families,
      new Map(Object.entries(input.paths.environments)),
      new Map(Object.entries(input.paths.projects)),
      input.workspaceOwnership,
      input.unseenWorkspaces?.[projectId] ?? [],
    );
    return {
      keys: orderWorkspaces(
        [...refs.values()].map((ref) => ({ ref })),
        input.order.workspaces[projectId],
      )
        .filter((workspace) => workspace.ref.kind === "git-worktree")
        .map((workspace) => workspace.ref.key),
    };
  };

  const commitWorkspaceOrder = (
    projectId: string,
    keys: readonly string[],
    success: string,
  ) => {
    commitReorder(input.order.reorderWorkspaces(projectId, keys), {
      success,
      failure: "Worktree order could not be saved.",
      announce: input.announce,
    });
  };

  const announceRejectedMove = (result: WorkspaceMoveResult) => {
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
    input.announce(messages[result.reason]);
  };

  const reorderWorkspaceByDrag = (move: {
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
      input.viewStateApi.setWorkspaceExpanded(
        move.targetKey,
        !input.viewStateApi.isWorkspaceExpanded(move.targetKey),
      );
      return;
    }
    if (!input.enabled) {
      input.announce(input.disabledReason ?? "Reordering is unavailable.");
      return;
    }
    const project = workspaceOrderInputs(move.targetProjectId);
    if (project === null) {
      input.announce("That project is no longer available.");
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
    commitWorkspaceOrder(
      move.targetProjectId,
      result.keys,
      "Moved worktree.",
    );
  };

  const reorderWorkspaceByKeyboard = (
    projectId: string,
    workspaceKey: string,
    direction: -1 | 1,
  ) => {
    if (!input.enabled) {
      input.announce(input.disabledReason ?? "Reordering is unavailable.");
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
  };

  return { reorderWorkspaceByDrag, reorderWorkspaceByKeyboard };
}
