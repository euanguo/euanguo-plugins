import type {
  ExperimentalPanelTab,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";

import type { WorkspaceIndex } from "./workspace-index.ts";

const GIT_PLUGIN_ID = "bb--git";
const GIT_DIFF_TAB_ID = "diff";

/**
 * The conversations the strip shows for one workspace.
 *
 * Every visible top-level thread in the workspace, oldest first, plus the
 * thread the pane is showing when it is a subagent or a hidden side chat. A
 * child runs where its parent does, so the family stays in the workspace it
 * was started in even though only the root is drawn on the strip.
 */
export function workspaceChats(
  threads: readonly PluginSidebarThread[],
  workspaceKey: string,
  currentThreadId: string,
  index: WorkspaceIndex,
): PluginSidebarThread[] {
  return threads
    .filter((thread) => {
      if (thread.isArchived) return false;
      const workspace = index.workspaceOfThread(thread);
      if (workspace?.key !== workspaceKey) return false;
      return (
        thread.id === currentThreadId ||
        (!thread.isHidden && thread.parentThreadId === null)
      );
    })
    .sort(
      (left, right) =>
        left.createdAt - right.createdAt || left.id.localeCompare(right.id),
    );
}

export function tabAfterClose(
  chats: readonly PluginSidebarThread[],
  closingId: string,
): PluginSidebarThread | null {
  const index = chats.findIndex((chat) => chat.id === closingId);
  if (index === -1) return null;
  return chats[index + 1] ?? chats[index - 1] ?? null;
}

export function findDiffTabKey(
  tabs: readonly ExperimentalPanelTab[],
): string | null {
  return (
    tabs.find(
      (tab) =>
        tab.detail.kind === "plugin" &&
        tab.detail.pluginId === GIT_PLUGIN_ID &&
        tab.detail.tab.id === GIT_DIFF_TAB_ID,
    )?.key ?? null
  );
}
