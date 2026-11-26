import { useState } from "react";
import {
  ThreadTitle,
  experimental_useSidebarThreads as useSidebarThreads,
  useBbNavigate,
  type ExperimentalThreadHeaderTitleProps,
} from "@get-bb/plugin-sdk/app";

import { Icon } from "@bb-ui/icon";
import { Menu, MenuItem, MenuLabel, MenuRow, MenuSeparator } from "@/components/ui/menu";
import { RenameDialog } from "@/components/inbox/rename-dialog";
import { NEW_CHAT_PANEL_PATH } from "@/app/new-chat/route";
import { useSidebarMode } from "@/hooks/use-sidebar-mode";
import { useThreadActions } from "@/hooks/use-thread-actions";
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
 * Rendered across both modes for Features (so single-repo/root cross-repo
 * switching is always one click away), and in Workspaces mode for Projects.
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
  const threadActions = useThreadActions();
  const [renaming, setRenaming] = useState(false);
  const thread = threads.find((entry) => entry.id === threadId);
  // The host may omit the environment prop; the thread row still carries it.
  const environmentId = environment?.id ?? thread?.environment?.id ?? null;
  const key =
    environmentId === null ? undefined : index.byEnvironmentId.get(environmentId);
  const workspace = key === undefined ? undefined : index.byKey?.get(key);
  const resolvedProjectId = projectId || thread?.projectId || "";
  const project = projects.find((entry) => entry.id === resolvedProjectId);
  const startRename = () => {
    if (thread !== undefined) setRenaming(true);
  };
  const renameDialog =
    renaming && thread !== undefined ? (
      <RenameDialog
        open
        title="Rename thread"
        fieldLabel="Thread title"
        currentName={thread.displayTitle}
        maxLength={200}
        errorFallback="Could not rename the thread."
        onClose={() => setRenaming(false)}
        onSubmit={(next) => threadActions.rename(thread.id, next)}
      />
    ) : null;

  if (workspace === undefined || (mode === "threads" && workspace.featureId === null)) {
    return (
      <>
        <button
          type="button"
          className="flex min-w-0 items-center bg-transparent text-left text-sm"
          title="Double-click to rename"
          onDoubleClick={startRename}
          onKeyDown={(event) => {
            if (event.key === "F2") startRename();
          }}
        >
          <ThreadTitle threadId={threadId} />
        </button>
        {renameDialog}
      </>
    );
  }

  const projectName = project?.isPersonal ? "Personal" : project?.name ?? resolvedProjectId;
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
      <span className="min-w-0 max-w-[45%] shrink truncate text-muted-foreground">{first}</span>
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
        <button
          type="button"
          data-harbor-breadcrumb=""
          className="flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden bg-transparent text-left text-sm"
          title="Double-click to rename"
          onDoubleClick={startRename}
          onKeyDown={(event) => {
            if (event.key === "F2") startRename();
          }}
        >
          {content}
        </button>
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
            data-harbor-breadcrumb=""
            title="Switch workspace"
            className="flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden rounded-md px-0.5 text-sm hover:bg-state-hover"
            onKeyDown={(event) => {
              if (event.key === "F2") {
                event.preventDefault();
                startRename();
              }
            }}
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
        {siblings.map((sibling) => {
          const isFeatureRootSibling = isFeature && sibling.parentKey === null;
          return (
            <MenuRow key={sibling.key} onSelect={() => open(sibling)}>
              <Icon
                name={workspaceKindIcon(sibling.kind)}
                className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">
                {isFeatureRootSibling ? "Feature root" : sibling.label}
              </span>
              {isFeatureRootSibling ? (
                <span className="shrink-0 text-2xs text-muted-foreground">
                  All repos
                </span>
              ) : sibling.branch === null ? null : (
                <span className="max-w-28 shrink-0 truncate font-mono text-2xs text-muted-foreground">
                  {sibling.branch}
                </span>
              )}
            </MenuRow>
          );
        })}
        {thread === undefined ? null : (
          <>
            <MenuSeparator />
            <MenuItem
              icon="Edit"
              label="Rename thread…"
              onSelect={startRename}
            />
          </>
        )}
      </Menu>
      {renameDialog}
    </>
  );
}
