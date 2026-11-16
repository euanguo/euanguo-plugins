import { useState } from "react";
import {
  ThreadTitle,
  experimental_useSidebarThreads as useSidebarThreads,
  useBbNavigate,
  type ExperimentalThreadHeaderTitleProps,
} from "@get-bb/plugin-sdk/app";

import { Icon } from "@/components/ui/icon";
import { Menu, MenuLabel, MenuRow } from "@/components/ui/menu";
import { ThreadRenameDialog } from "@/components/inbox/thread-rename-dialog";
import { NEW_CHAT_PANEL_PATH } from "@/app/new-chat/route";
import { useSidebarMode } from "@/hooks/use-sidebar-mode";
import { useWorkspaceIndex } from "@/hooks/use-workspace-index";
import { lastActiveFor } from "@/lib/ui/last-active";
import type { Workspace } from "@/lib/domain/workspace-index";
import {
  featureTitle,
  siblingWorkspaces,
  workspaceKindIcon,
  workspaceSwitchTarget,
} from "@/lib/domain/workspace-tabs";

/**
 * Where the thread is, and the way to its neighbours.
 *
 * A plain workspace reads `project › workspace`; a feature root reads
 * `feature`; a feature member reads `feature › member`. The last segment is a
 * switcher over the other workspaces the user is likely to want next: the
 * other repositories of the same feature, or the project's other workspaces.
 * Choosing one opens the conversation last read there, else its oldest one,
 * else a new conversation bound to it.
 *
 * Only the Workspaces mode draws this. Threads mode hands the header back to
 * bb, which is the same title a thread with no workspace gets. bb does not
 * start a rename on a plugin title, so both modes keep the double-click that
 * opens Nest's rename dialog.
 */
export function WorkspaceBreadcrumb({
  threadId,
  projectId,
  environment,
}: ExperimentalThreadHeaderTitleProps) {
  const index = useWorkspaceIndex();
  const mode = useSidebarMode();
  const { threads, projects } = useSidebarThreads();
  const navigate = useBbNavigate();
  const [renaming, setRenaming] = useState(false);
  const environmentId = environment?.id ?? null;
  const key =
    environmentId === null ? undefined : index.byEnvironmentId.get(environmentId);
  const workspace = key === undefined ? undefined : index.byKey?.get(key);
  const project = projects.find((entry) => entry.id === projectId);
  const thread = threads.find((entry) => entry.id === threadId);
  const startRename = () => {
    if (thread !== undefined) setRenaming(true);
  };
  const renameDialog =
    renaming && thread !== undefined ? (
      <ThreadRenameDialog
        threadId={thread.id}
        currentTitle={thread.displayTitle}
        onClose={() => setRenaming(false)}
      />
    ) : null;

  if (mode === "threads" || workspace === undefined) {
    return (
      <>
        <span
          className="flex min-w-0 items-center text-sm"
          title="Double-click to rename"
          onDoubleClick={startRename}
        >
          <ThreadTitle threadId={threadId} />
        </span>
        {renameDialog}
      </>
    );
  }

  const projectName = project?.isPersonal ? "Personal" : project?.name ?? projectId;
  const isFeature = workspace.featureId !== null;
  const featureName = isFeature ? featureTitle(workspace, index) : null;
  const isMember =
    isFeature &&
    (workspace.parentKey !== null ||
      (featureName !== null && workspace.label !== featureName));
  const first = isFeature ? featureName ?? workspace.label : projectName;
  const showSecond = isFeature ? isMember && featureName !== null : true;
  const siblings = siblingWorkspaces(workspace, index);

  const open = (sibling: Workspace) => {
    const target = workspaceSwitchTarget(
      sibling,
      threads,
      index,
      lastActiveFor(sibling.key),
    );
    if (target.kind === "thread") {
      navigate.toThread(target.threadId);
    } else if (target.kind === "new-chat") {
      navigate.toPluginPanel(NEW_CHAT_PANEL_PATH, {
        subPath: target.environmentId,
      });
    }
  };

  const content = (
    <>
      <span className="shrink-0 truncate text-muted-foreground">{first}</span>
      {showSecond ? (
        <>
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
        </>
      ) : null}
    </>
  );

  if (siblings.length === 0) {
    return (
      <>
        <span
          data-nest-breadcrumb=""
          className="flex min-w-0 items-center gap-1.5 text-sm"
          title="Double-click to rename"
          onDoubleClick={startRename}
        >
          {content}
        </span>
        {renameDialog}
      </>
    );
  }

  return (
    <>
      <Menu
        label={
          isFeature
            ? "Switch to another workspace in this feature"
            : "Switch to another workspace in this project"
        }
        align="start"
        trigger={
          <button
            type="button"
            data-nest-breadcrumb=""
            title="Switch workspace"
            className="flex min-w-0 items-center gap-1.5 rounded-md px-0.5 text-sm hover:bg-state-hover"
            onDoubleClick={startRename}
          >
            {content}
            <Icon
              name="ChevronDown"
              aria-hidden="true"
              className="size-3.5 shrink-0 text-subtle-foreground"
            />
          </button>
        }
      >
        <MenuLabel>
          {isFeature ? "In this feature" : "In this project"}
        </MenuLabel>
        {siblings.map((sibling) => (
          <MenuRow key={sibling.key} onSelect={() => open(sibling)}>
            <Icon
              name={workspaceKindIcon(sibling.kind)}
              className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate">{sibling.label}</span>
            {sibling.branch === null ? null : (
              <span className="max-w-28 shrink-0 truncate font-mono text-2xs text-muted-foreground">
                {sibling.branch}
              </span>
            )}
          </MenuRow>
        ))}
      </Menu>
      {renameDialog}
    </>
  );
}
