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

import type { BulkDeletePreview, BulkDeleteResult } from "../bulk-delete.ts";
import type { ProjectGroup } from "../groups.ts";
import type { SidebarIndex } from "./index-cache.ts";
import type { WorkspaceRemovalOutcome } from "../worktree-removal.ts";

/** How a spawned thread gets its workspace. */
export type SpawnEnvironment =
  | { readonly type: "reuse"; readonly environmentId: string }
  | {
      readonly type: "host";
      readonly hostId: string;
      readonly workspace: { readonly type: "unmanaged"; readonly path: string };
    };

export interface SpawnThreadInput {
  readonly projectId: string;
  readonly prompt: string;
  readonly title?: string;
  /** The calling thread's id, when the new thread should be its worker. */
  readonly parentThreadId?: string;
  readonly environment?: SpawnEnvironment;
}

export interface DeleteThreadsOutcome {
  readonly preview: BulkDeletePreview;
  /** Null until the caller acknowledges; then the deletion result. */
  readonly result: BulkDeleteResult | null;
}

export interface NestAgentActions {
  /** Renames a project's display name; null when bb refused or it is gone. */
  renameProject(projectId: string, name: string): Promise<string | null>;
  /**
   * Settles or unsettles one thread.
   *
   * Settling archives it in bb and parks it on the shelf; it is reversible from
   * the sidebar, which is what makes it an agent action rather than a
   * destructive one.
   */
  settleThread(threadId: string, settled: boolean): Promise<{ ok: boolean; message: string | null }>;
  /** Snoozes until an epoch-ms moment, or unsnoozes with null. */
  snoozeThread(threadId: string, snoozedUntil: number | null): Promise<{ ok: boolean; message: string | null }>;
  /** Pins or unpins a thread in bb's own sidebar order. */
  setThreadPinned(threadId: string, pinned: boolean): Promise<boolean>;
  /** Replaces a thread's title; false when bb refused. */
  renameThread(threadId: string, title: string): Promise<boolean>;
  /**
   * Deletes thread families, preview first.
   *
   * Without `acknowledged` it only previews — what would go, what is protected
   * — so the model can show the user before anything is destroyed. With it,
   * the preview's token is confirmed immediately.
   */
  deleteThreads(input: {
    threadIds: readonly string[];
    /** The calling thread, which can never delete itself out from under the turn. */
    protectedThreadId: string | null;
    acknowledged: boolean;
  }): Promise<DeleteThreadsOutcome>;
  /** Deletes a project after the caller names it; false on a name mismatch. */
  removeProject(projectId: string, expectedName: string): Promise<boolean>;
  /** Deletes a group; its projects fall back to Ungrouped. */
  deleteGroup(groupId: string): Promise<boolean>;
  /** Removes a workspace, or releases it while keeping the directory. */
  removeWorkspace(input: {
    environmentId: string;
    deleteDirectory: boolean;
    acknowledged: boolean;
  }): Promise<WorkspaceRemovalOutcome>;
  /**
   * Starts a thread. `plugin` origin, so it does not overwrite the user's
   * remembered model and reasoning defaults.
   */
  spawnThread(input: SpawnThreadInput): Promise<string | null>;
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
