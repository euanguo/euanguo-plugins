import type { nestRpcContract } from "./contract.ts";

/**
 * The two thread rows this backend reads from bb.
 *
 * Deliberate subsets, the way the RPC contract is: the SDK read is the source
 * and these are the shapes this plugin promises to hand on, so a field bb stops
 * returning becomes a compile error here rather than an `undefined` on the wire.
 * They live in their own module because both the RPC handlers and the index
 * builder take them as arguments, and neither should have to reach into
 * `server.ts` for a type.
 */

export interface AuthoritativeThreadRow {
  id: string;
  projectId: string;
  title: string | null;
  titleFallback: string | null;
  parentThreadId: string | null;
  status: "active" | "error" | "idle" | "pending" | "starting" | "stopping";
  hasPendingInteraction: boolean;
  pinnedAt: number | null;
  lastReadAt: number | null;
  latestAttentionAt: number;
  deletedAt: number | null;
  activity: {
    activeWorkflowCount: number;
    activeBackgroundAgentCount: number;
    activeBackgroundCommandCount: number;
    activePlanModeCount: number;
    activeGoalCount: number;
  };
  runtime: {
      displayStatus:
        | "active"
        | "error"
        | "host-reconnecting"
        | "idle"
        | "pending"
        | "provisioning"
        | "starting"
        | "stopping"
        | "waiting-for-host";
  };
}

/**
 * The fields the recovery read needs from `bb.sdk.threads.list`.
 *
 * A deliberate subset, the way `AuthoritativeThreadRow` is: the SDK read is the
 * source and this is the shape the backend promises to hand on, so a field bb
 * stops returning is a compile error here rather than an `undefined` on the
 * wire. Unlike the bulk-delete subset this one carries the environment, the
 * host, and the origin, because a recovery row has to draw a workspace level.
 */
export interface RecoverySdkThreadRow {
  id: string;
  projectId: string;
  title: string | null;
  titleFallback: string | null;
  parentThreadId: string | null;
  sectionId: string | null;
  originKind: "fork" | null;
  originPluginId: string | null;
  providerId: string;
  status: "active" | "error" | "idle" | "pending" | "starting" | "stopping";
  hasPendingInteraction: boolean;
  pinnedAt: number | null;
  /**
   * bb's own ordering key for a pinned thread, compared as a string by codepoint
   * — which is why it is a string and not a number. Null for a thread pinned
   * before the key existed, and for every unpinned thread.
   */
  pinSortKey: string | null;
  /** When bb archived this thread. Null while it is live. */
  archivedAt: number | null;
  deletedAt: number | null;
  /**
   * Read by the bulk-delete preview and by nothing else here. It is on this
   * interface so the one paged read can serve every caller: a second read with a
   * narrower type would be a second place for the paging to be wrong.
   */
  runtime: {
    displayStatus:
      | "active"
      | "error"
      | "host-reconnecting"
      | "idle"
      | "pending"
      | "provisioning"
      | "starting"
      | "stopping"
      | "waiting-for-host";
  };
  visibility: "hidden" | "visible";
  environmentId: string | null;
  environmentName: string | null;
  environmentBranchName: string | null;
  environmentProviderId: string | null;
  environmentHostId: string | null;
  environmentWorkspaceDisplayKind:
    | "managed-worktree"
    | "unmanaged-worktree"
    | "other";
  lastReadAt: number | null;
  latestAttentionAt: number;
  createdAt: number;
  updatedAt: number;
  activity: {
    activeWorkflowCount: number;
    activeBackgroundAgentCount: number;
    activeBackgroundCommandCount: number;
    activePlanModeCount: number;
    activeGoalCount: number;
  };
}

/**
 * One recovery row as the wire carries it.
 *
 * Derived from the contract rather than restated: the RPC validates this shape
 * on the way out, so a field added to the schema and forgotten here would be a
 * compile error in the mapper instead of a silent omission.
 */
export type RecoveryThreadWireRow =
  typeof nestRpcContract.listThreadsForRecovery.output extends
    { readonly _output: { readonly threads: readonly (infer Row)[] } }
    ? Row
    : never;
