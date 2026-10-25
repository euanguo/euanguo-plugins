/**
 * The writes Nest offers an agent, as one seam.
 *
 * These are the same four operations the sidebar's own RPC already performs —
 * the row menus, the group manager and the rename dialog all reach them — so
 * this exists to make sure an agent's write and a click go through the same
 * code. Two implementations of "file this project under that group" is two
 * places for the publish to be forgotten, and the symptom is the one thing a
 * user will not forgive: a sidebar that changes without being asked, or a click
 * that appears to do nothing until a reload.
 *
 * Every method answers with whether it changed anything, because a tool has to
 * tell the model what happened, and `false` is a real answer — an id that no
 * longer exists is a stale map, not a failure.
 */

import type { ProjectGroup } from "../groups.ts";
import type { SidebarIndex } from "./index-cache.ts";

export interface NestAgentActions {
  /** Moves a project into a group, or out of one when `groupId` is null. */
  assignProjectToGroup(projectId: string, groupId: string | null): Promise<boolean>;
  /** Creates a group, or null when the name or the limit refuses it. */
  createGroup(name: string, icon: string | undefined): Promise<ProjectGroup | null>;
  /** Renames a group, or false when it is gone. */
  renameGroup(groupId: string, name: string, icon?: string): Promise<boolean>;
  /**
   * Sets a worktree's display name, or clears it with null.
   *
   * Returns the stored name, which is the trimmed one bb kept rather than the
   * one that was asked for, so a reply can quote what is actually there.
   */
  setWorkspaceAlias(environmentId: string, alias: string | null): Promise<string | null>;
}

/**
 * What a tool needs from the plugin to do its job.
 *
 * Passed in rather than imported so the tools have no dependency on the server
 * entry: they are testable with a stub index and stub actions, and the server
 * stays the only place that knows about bb's SDK.
 */
export interface AgentToolDeps {
  /** The freshest materialized index, or null before the first read. */
  readonly index: () => SidebarIndex | null;
  /** Recompute the index after a write, so the next read is not stale. */
  readonly refreshIndex: () => Promise<unknown>;
  readonly actions: NestAgentActions;
}
