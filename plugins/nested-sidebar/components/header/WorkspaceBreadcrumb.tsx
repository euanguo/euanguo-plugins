import {
  ThreadTitle,
  experimental_useSidebarThreads as useSidebarThreads,
  type ExperimentalThreadHeaderTitleProps,
} from "@get-bb/plugin-sdk/app";

import { Icon } from "@/components/ui/icon";
import { useSidebarMode } from "@/hooks/use-sidebar-mode";
import { useWorkspaceIndex } from "@/hooks/use-workspace-index";

/**
 * Where the thread is, instead of the thread's own title.
 *
 * `project › workspace`, named the way the workspace row is named: the
 * environment's alias first, then its branch, then the directory.
 *
 * Only the Workspaces mode draws it. Threads mode hands the header back to bb
 * untouched, which is the same title a thread with no workspace gets.
 */
export function WorkspaceBreadcrumb({
  threadId,
  projectId,
  environment,
}: ExperimentalThreadHeaderTitleProps) {
  const index = useWorkspaceIndex();
  const mode = useSidebarMode();
  const { projects } = useSidebarThreads();
  const environmentId = environment?.id ?? null;
  const key =
    environmentId === null ? undefined : index.byEnvironmentId.get(environmentId);
  const workspace = key === undefined ? undefined : index.byKey.get(key);
  const project = projects.find((entry) => entry.id === projectId);

  if (mode === "threads" || workspace === undefined) {
    return (
      <span className="flex min-w-0 items-center text-sm">
        <ThreadTitle threadId={threadId} />
      </span>
    );
  }

  const projectName = project?.isPersonal ? "Personal" : project?.name ?? projectId;
  return (
    <span
      data-nest-breadcrumb=""
      className="flex min-w-0 items-center gap-1.5 text-sm"
    >
      <span className="shrink-0 truncate text-muted-foreground">
        {projectName}
      </span>
      <Icon
        name="ChevronRight"
        aria-hidden="true"
        className="size-3.5 shrink-0 text-subtle-foreground"
      />
      <span
        className="min-w-0 truncate text-foreground"
        title={workspace.branch ?? undefined}
      >
        {workspace.label}
      </span>
    </span>
  );
}
