import type { NestViewStateApi } from "@/components/inbox/view-state-context";
import type { useNestOrder } from "@/hooks/use-nest-order";
import type { useViewPreferences } from "@/hooks/use-view-preferences";
import { useFamilyReorder } from "@/hooks/reorder/use-family-reorder";
import { useProjectReorder } from "@/hooks/reorder/use-project-reorder";
import { useWorkspaceReorder } from "@/hooks/reorder/use-workspace-reorder";
import type { ProjectThreadGroup } from "@/lib/inbox";
import type { ThreadFilterPreset } from "@/lib/thread-management";
import type {
  WorkspaceEnvironmentDescriptor,
  WorkspaceProjectDescriptor,
} from "@/lib/workspace";
import type {
  UnseenOwnedWorkspace,
  WorkspaceOwnershipMap,
} from "@/lib/workspace-ownership";

export interface ReorderInputs {
  readonly selectionMode: boolean;
  readonly filterPreset: ThreadFilterPreset;
  readonly searching: boolean;
  readonly viewPreferences: ReturnType<typeof useViewPreferences>;
  readonly order: ReturnType<typeof useNestOrder>;
  readonly unfilteredProjectGroups: readonly ProjectThreadGroup[];
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
  readonly setReorderAnnouncement: (message: string) => void;
  readonly viewStateApi: NestViewStateApi;
  readonly rootTitleById: ReadonlyMap<string, string>;
  readonly groupsApi: {
    readonly assignment: Readonly<Record<string, string>>;
  };
}

export function useReorder(input: ReorderInputs) {
  const sharedBlocker = input.selectionMode
    ? "Exit bulk selection to reorder."
    : input.filterPreset !== "all"
      ? "Choose the All filter to reorder."
      : input.searching
        ? "Clear search to reorder."
        : null;
  const familyDisabledReason =
    sharedBlocker ??
    (input.viewPreferences.threadSort !== "manual"
      ? "Choose the Manual thread sort to drag thread families."
      : null);
  const workspaceDisabledReason =
    sharedBlocker ??
    (input.viewPreferences.worktreeSort !== "manual"
      ? "Choose the Manual worktree sort to drag worktrees."
      : null);
  const projectDisabledReason =
    sharedBlocker ??
    (input.viewPreferences.projectSort !== "manual"
      ? "Choose the Manual project sort to drag projects."
      : null);

  const family = useFamilyReorder({
    enabled: familyDisabledReason === null,
    disabledReason: familyDisabledReason,
    order: input.order,
    projectGroups: input.unfilteredProjectGroups,
    rootTitleById: input.rootTitleById,
    announce: input.setReorderAnnouncement,
  });
  const workspace = useWorkspaceReorder({
    enabled: workspaceDisabledReason === null,
    disabledReason: workspaceDisabledReason,
    order: input.order,
    projectGroups: input.unfilteredProjectGroups,
    paths: input.paths,
    workspaceOwnership: input.workspaceOwnership,
    unseenWorkspaces: input.unseenWorkspaces,
    viewStateApi: input.viewStateApi,
    announce: input.setReorderAnnouncement,
  });
  const project = useProjectReorder({
    enabled: projectDisabledReason === null,
    disabledReason: projectDisabledReason,
    order: input.order,
    projectGroups: input.unfilteredProjectGroups,
    groupAssignment: input.groupsApi.assignment,
    viewStateApi: input.viewStateApi,
    announce: input.setReorderAnnouncement,
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
    reorderWorkspaceByDrag: workspace.reorderWorkspaceByDrag,
    reorderWorkspaceByKeyboard: workspace.reorderWorkspaceByKeyboard,
    reorderProjectByDrag: project.reorderProjectByDrag,
    reorderProjectByKeyboard: project.reorderProjectByKeyboard,
    reorderProjectDrop: project.reorderProjectDrop,
  };
}
