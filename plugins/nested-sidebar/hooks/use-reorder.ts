/**
 * Dragging a row, and the keyboard path that does the same thing.
 *
 * Three levels — thread families, worktrees, projects — plus pins, and the
 * gates that decide when any of them is allowed. One module because they share
 * one rule set: a reorder writes the *complete* arrangement, so it is only ever
 * offered when the list on screen is the whole list, and every refusal is
 * announced rather than silently dropped.
 *
 * It lived inline in `ThreadInbox`, which meant the component knew which of
 * four sort lenses had to be Manual before a row could move, and how to say
 * "pinned and unpinned thread families cannot cross" — neither of which is
 * about drawing.
 */
import type { ThreadFilterPreset } from "@/lib/thread-management";
import type { ProjectThreadGroup } from "@/lib/inbox";
import type {
  WorkspaceEnvironmentDescriptor,
  WorkspaceProjectDescriptor,
} from "@/lib/workspace";
import type {
  WorkspaceOwnershipMap,
  UnseenOwnedWorkspace,
} from "@/lib/workspace-ownership";
import type { useNestOrder } from "@/hooks/use-nest-order";
import type { useViewPreferences } from "@/hooks/use-view-preferences";
import {
  keyboardFamilyMove,
  moveProjectFamily,
  type FamilyMoveResult,
} from "@/lib/family-order";
import {
  keyboardProjectMove,
  moveProject,
  type ProjectMoveResult,
} from "@/lib/project-order";
import {
  keyboardWorkspaceMove,
  moveProjectWorkspace,
  orderWorkspaces,
  type WorkspaceMoveResult,
} from "@/lib/workspace-order";
import { projectWorkspaceRefs } from "@/lib/tree";
import { orderedProjectIds, projectOrderScope } from "@/lib/ordering";
import type { NestViewStateApi } from "@/components/inbox/view-state-context";

export interface ReorderInputs {
  readonly selectionMode: boolean;
  readonly filterPreset: ThreadFilterPreset;
  readonly searching: boolean;
  readonly viewPreferences: ReturnType<typeof useViewPreferences>;
  readonly order: ReturnType<typeof useNestOrder>;
  /** The complete, unfiltered project list — never what is on screen. */
  readonly unfilteredProjectGroups: readonly ProjectThreadGroup[];
  readonly paths: {
    readonly environments: Readonly<Record<string, WorkspaceEnvironmentDescriptor>>;
    readonly projects: Readonly<Record<string, WorkspaceProjectDescriptor>>;
  };
  readonly workspaceOwnership: WorkspaceOwnershipMap | undefined;
  readonly unseenWorkspaces:
    | Readonly<Record<string, readonly UnseenOwnedWorkspace[]>>
    | undefined;
  readonly setReorderAnnouncement: (message: string) => void;
  /** The tree's remembered shape: a move may have to expand what it touches. */
  readonly viewStateApi: NestViewStateApi;
  /** Thread ids to the title a refusal message should name. */
  readonly rootTitleById: ReadonlyMap<string, string>;
  /** The groups' membership, for the project scope a move is filed under. */
  readonly groupsApi: {
    readonly assignment: Readonly<Record<string, string>>;
  };
}

/**
 * Every reorder path, and the gates that decide which are offered.
 *
 * Written as one hook rather than four, because the gates are shared: a filter,
 * a search, or a bulk selection disables all of them at once, and a row that
 * looks draggable while a gate says no is the failure this exists to prevent.
 */
export function useReorder(inputs: ReorderInputs) {
  const {
    selectionMode,
    filterPreset,
    searching,
    viewPreferences,
    order,
    unfilteredProjectGroups,
    paths,
    workspaceOwnership,
    unseenWorkspaces,
    setReorderAnnouncement,
    viewStateApi,
    rootTitleById,
    groupsApi,
  } = inputs;

const sharedReorderBlocker = selectionMode
  ? "Exit bulk selection to reorder."
  : filterPreset !== "all"
    ? "Choose the All filter to reorder."
    : searching
      ? "Clear search to reorder."
      : null;
const familyReorderDisabledReason =
  sharedReorderBlocker ??
  (viewPreferences.threadSort !== "manual"
    ? "Choose the Manual thread sort to drag thread families."
    : null);
const reorderEnabled = familyReorderDisabledReason === null;
/*
 * Worktrees are dragged only under the manual order, for the same reason
 * projects are: the drag writes the *drawn* order as the arrangement, and
 * under a lens what is drawn is the lens's ranking, not the user's. Letting
 * that through both loses their arrangement and leaves a row that looks
 * draggable — the grab cursor is on the whole row — while a click that
 * wobbled is being spent on a reorder instead of on opening the row. The
 * shared blocker still applies on top: a row hidden by search, a filter, or
 * bulk selection must never move implicitly.
 */
const workspaceReorderDisabledReason =
  sharedReorderBlocker ??
  (viewPreferences.worktreeSort !== "manual"
    ? "Choose the Manual worktree sort to drag worktrees."
    : null);
/*
 * The pinned order has no sort lens over it — what bb holds is what is drawn —
 * so only the shared blocker applies, exactly like the worktree arrangement.
 */
const pinnedReorderDisabledReason = sharedReorderBlocker;
const pinnedReorderEnabled = pinnedReorderDisabledReason === null;
const workspaceReorderEnabled = workspaceReorderDisabledReason === null;
const projectReorderDisabledReason =
  sharedReorderBlocker ??
  (viewPreferences.projectSort !== "manual"
    ? "Choose the Manual project sort to drag projects."
    : null);
const projectReorderEnabled = projectReorderDisabledReason === null;

const commitFamilyOrder = (
  projectId: string,
  rootIds: readonly string[],
  announcement: string,
) => {
  void order
    .reorderFamilies(projectId, rootIds)
    .then((ok) =>
      setReorderAnnouncement(
        ok ? announcement : "Thread family order could not be saved.",
      ),
    )
    .catch(() =>
      setReorderAnnouncement("Thread family order could not be saved."),
    );
};

const projectOrderInputs = (projectId: string) => {
  const group = unfilteredProjectGroups.find(
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
  const messages: Record<Exclude<FamilyMoveResult, { ok: true }>["reason"], string> = {
    "cross-project": "Thread families cannot move between projects.",
    "incomplete-order": "Reordering requires the complete project order.",
    "invalid-id": "That reorder request was invalid.",
    "missing-root": "That thread family cannot move farther in this direction.",
    "pinned-boundary": "Pinned and unpinned thread families cannot cross.",
    "same-root": "Thread family order did not change.",
  };
  setReorderAnnouncement(messages[result.reason]);
};

/**
 * The project's worktrees as rows, in the order they are drawn.
 *
 * Taken from the project's complete workspace set rather than from what is on
 * screen, and from the same function the tree uses: a reorder has to write the
 * complete arrangement, or a row hidden by search — or one no thread has
 * reached yet — would drop out of it. The checkout is not in the list, because
 * it leads under every arrangement and there is nothing to move.
 */
const workspaceOrderInputs = (projectId: string) => {
  const group = unfilteredProjectGroups.find(
    (candidate) => candidate.project.id === projectId,
  );
  if (group === undefined) return null;
  const refs = projectWorkspaceRefs(
    projectId,
    group.families,
    new Map(Object.entries(paths.environments)),
    new Map(Object.entries(paths.projects)),
    workspaceOwnership,
    unseenWorkspaces?.[projectId] ?? [],
  );
  return {
    keys: orderWorkspaces(
      [...refs.values()].map((ref) => ({ ref })),
      order.workspaces[projectId],
    )
      .filter((workspace) => workspace.ref.kind === "git-worktree")
      .map((workspace) => workspace.ref.key),
  };
};

const commitWorkspaceOrder = (
  projectId: string,
  keys: readonly string[],
  announcement: string,
) => {
  void order
    .reorderWorkspaces(projectId, keys)
    .then((ok) =>
      setReorderAnnouncement(
        ok ? announcement : "Worktree order could not be saved.",
      ),
    )
    .catch(() =>
      setReorderAnnouncement("Worktree order could not be saved."),
    );
};

const announceRejectedWorkspaceMove = (result: WorkspaceMoveResult) => {
  if (result.ok) return;
  const messages: Record<
    Exclude<WorkspaceMoveResult, { ok: true }>["reason"],
    string
  > = {
    "cross-project": "Worktrees cannot move between projects.",
    "invalid-id": "That reorder request was invalid.",
    "missing-workspace": "That worktree cannot move farther in this direction.",
    "same-workspace": "Worktree order did not change.",
  };
  setReorderAnnouncement(messages[result.reason]);
};

const reorderWorkspaceByDrag = (input: {
  sourceProjectId: string;
  sourceKey: string;
  targetProjectId: string;
  targetKey: string;
  position: "before" | "after";
}) => {
  // A drag that lands on the row it started from is the click that drifted
  // into one. The browser starts a drag after about five pixels of movement
  // and then produces no click at all, so a press with a little wobble in it
  // opened nothing and only announced that the order had not changed;
  // measured on the running app, a click that travelled nine pixels fired
  // `dragstart`, dropped on its own row, and toggled nothing. Toggle it here,
  // which is what the press was for.
  if (
    input.sourceProjectId === input.targetProjectId &&
    input.sourceKey === input.targetKey
  ) {
    viewStateApi.setWorkspaceExpanded(
      input.targetKey,
      !viewStateApi.isWorkspaceExpanded(input.targetKey),
    );
    return;
  }
  if (!workspaceReorderEnabled) {
    setReorderAnnouncement(
      workspaceReorderDisabledReason ?? "Reordering is unavailable.",
    );
    return;
  }
  const project = workspaceOrderInputs(input.targetProjectId);
  if (project === null) {
    setReorderAnnouncement("That project is no longer available.");
    return;
  }
  const result = moveProjectWorkspace({
    projectId: input.targetProjectId,
    ...input,
    keys: project.keys,
  });
  if (!result.ok) {
    announceRejectedWorkspaceMove(result);
    return;
  }
  commitWorkspaceOrder(
    input.targetProjectId,
    result.keys,
    "Moved worktree.",
  );
};

const reorderWorkspaceByKeyboard = (
  projectId: string,
  workspaceKey: string,
  direction: -1 | 1,
) => {
  if (!workspaceReorderEnabled) {
    setReorderAnnouncement(
      workspaceReorderDisabledReason ?? "Reordering is unavailable.",
    );
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
    announceRejectedWorkspaceMove(result);
    return;
  }
  commitWorkspaceOrder(
    projectId,
    result.keys,
    `Moved worktree ${direction < 0 ? "up" : "down"}.`,
  );
};

const reorderByDrag = (input: {
  sourceProjectId: string;
  sourceRootId: string;
  targetProjectId: string;
  targetRootId: string;
  position: "before" | "after";
}) => {
  if (!reorderEnabled) {
    setReorderAnnouncement(
      familyReorderDisabledReason ?? "Reordering is unavailable.",
    );
    return;
  }
  const project = projectOrderInputs(input.targetProjectId);
  if (project === null) {
    setReorderAnnouncement("That project is no longer available.");
    return;
  }
  const result = moveProjectFamily({
    projectId: input.targetProjectId,
    ...input,
    ...project,
  });
  if (!result.ok) {
    announceRejectedMove(result);
    return;
  }
  commitFamilyOrder(
    input.targetProjectId,
    result.order,
    `Moved ${rootTitleById.get(input.sourceRootId) ?? "thread family"}.`,
  );
};

const reorderByKeyboard = (
  projectId: string,
  rootId: string,
  direction: -1 | 1,
) => {
  if (!reorderEnabled) {
    setReorderAnnouncement(
      familyReorderDisabledReason ?? "Reordering is unavailable.",
    );
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
    `Moved ${rootTitleById.get(rootId) ?? "thread family"} ${direction < 0 ? "up" : "down"}.`,
  );
};

const commitProjectOrder = (
  groupId: string,
  projectIds: readonly string[],
  announcement: string,
) => {
  void order
    .reorderProjects(groupId, projectIds)
    .then((ok) =>
      setReorderAnnouncement(
        ok ? announcement : "Project order could not be saved.",
      ),
    )
    .catch(() => setReorderAnnouncement("Project order could not be saved."));
};

const announceRejectedProjectMove = (result: ProjectMoveResult) => {
  if (result.ok) return;
  const messages: Record<Exclude<ProjectMoveResult, { ok: true }>["reason"], string> = {
    "incomplete-order": "Project reordering requires the complete group order.",
    "invalid-id": "That project reorder request was invalid.",
    "missing-project": "That project cannot move farther in this direction.",
    "same-project": "Project order did not change.",
  };
  setReorderAnnouncement(messages[result.reason]);
};

const reorderProjectByDrag = (input: {
  sourceProjectId: string;
  targetProjectId: string;
  position: "before" | "after";
}) => {
  // A header dropped on itself is the click that drifted into a drag — see
  // `reorderWorkspaceByDrag` for the measurement and the reasoning.
  if (input.sourceProjectId === input.targetProjectId) {
    viewStateApi.setProjectCollapsed(
      input.targetProjectId,
      !viewStateApi.isProjectCollapsed(input.targetProjectId),
    );
    return;
  }
  if (!projectReorderEnabled) {
    setReorderAnnouncement(
      projectReorderDisabledReason ?? "Reordering is unavailable.",
    );
    return;
  }
  const sourceScope = projectOrderScope(
    groupsApi.assignment,
    input.sourceProjectId,
  );
  const targetScope = projectOrderScope(
    groupsApi.assignment,
    input.targetProjectId,
  );
  // A project belongs to one group, and the order is stored per group; a
  // cross-group drop would be two decisions at once. Membership has its own
  // command in the row menu, so the drag stays a pure reorder.
  if (sourceScope !== targetScope) {
    setReorderAnnouncement(
      "Projects can only be reordered within their group. Use Move to group to change groups.",
    );
    return;
  }
  const result = moveProject({
    projectIds: orderedProjectIds(
      unfilteredProjectGroups,
      groupsApi.assignment,
      sourceScope,
    ),
    ...input,
  });
  if (!result.ok) {
    announceRejectedProjectMove(result);
    return;
  }
  commitProjectOrder(sourceScope, result.order, "Moved project.");
};

const reorderProjectByKeyboard = (projectId: string, direction: -1 | 1) => {
  if (!projectReorderEnabled) {
    setReorderAnnouncement(
      projectReorderDisabledReason ?? "Reordering is unavailable.",
    );
    return;
  }
  const scope = projectOrderScope(groupsApi.assignment, projectId);
  const result = keyboardProjectMove(
    orderedProjectIds(unfilteredProjectGroups, groupsApi.assignment, scope),
    projectId,
    direction,
  );
  if (!result.ok) {
    announceRejectedProjectMove(result);
    return;
  }
  const projectName = unfilteredProjectGroups.find(
    (group) => group.project.id === projectId,
  )?.project.name;
  commitProjectOrder(
    scope,
    result.order,
    `Moved ${projectName ?? "project"} ${direction < 0 ? "up" : "down"}.`,
  );
};

/**
 * A project header dropped onto another project header. The target decides
 * before/after from the pointer's half of the row; the move itself is the
 * same project order the keyboard path writes.
 */
const reorderProjectDrop = (
  sourceProjectId: string,
  targetProjectId: string,
  position: "before" | "after",
) => {
  reorderProjectByDrag({ sourceProjectId, targetProjectId, position });
};
  return {
    reorderEnabled,
    familyReorderDisabledReason,
    workspaceReorderDisabledReason,
    workspaceReorderEnabled,
    projectReorderDisabledReason,
    projectReorderEnabled,
    pinnedReorderDisabledReason,
    pinnedReorderEnabled,
    reorderByDrag,
    reorderByKeyboard,
    reorderWorkspaceByDrag,
    reorderWorkspaceByKeyboard,
    reorderProjectByDrag,
    reorderProjectByKeyboard,
    reorderProjectDrop,
  };
}
