import type { BbPluginApi } from "@get-bb/plugin-sdk";

import type {
  AuthoritativeThreadRow,
  RecoverySdkThreadRow,
  RecoveryThreadWireRow,
} from "./thread-rows.ts";

const ARCHIVED_PAGE_SIZE = 200;
const ARCHIVED_PAGE_LIMIT = 50;
const BULK_PAGE_SIZE = 200;
const BULK_PAGE_LIMIT = 25;

export interface ThreadListFilters {
  archived: boolean;
  projectId?: string;
  parentThreadId?: string;
}

export interface ThreadPage {
  readonly rows: readonly RecoverySdkThreadRow[];
  readonly truncated: boolean;
}

export interface ThreadReader {
  listArchivedThreads(): Promise<ThreadPage>;
  listThreadRows(
    filters: ThreadListFilters,
  ): Promise<ThreadPage>;
  listBothArchiveStates(filters: {
    projectId?: string;
    parentThreadId?: string;
  }): Promise<ThreadPage>;
  listVisibleThreadRows(): Promise<ThreadPage>;
  readThreadRow(threadId: string): Promise<AuthoritativeThreadRow | null>;
  hostNamesById(): Promise<Map<string, string>>;
}

/** Fields shared by every thread row this backend sends to the frontend. */
export function toThreadWireFields(thread: RecoverySdkThreadRow) {
  return {
    id: thread.id,
    projectId: thread.projectId,
    title: thread.title,
    titleFallback: thread.titleFallback,
    parentThreadId: thread.parentThreadId,
    sectionId: thread.sectionId,
    originKind: thread.originKind,
    originPluginId: thread.originPluginId,
    providerId: thread.providerId,
    status: thread.status,
    hasPendingInteraction: thread.hasPendingInteraction,
    isPinned: thread.pinnedAt !== null,
    activity: {
      workflows: thread.activity.activeWorkflowCount,
      backgroundAgents: thread.activity.activeBackgroundAgentCount,
      backgroundCommands: thread.activity.activeBackgroundCommandCount,
      planMode: thread.activity.activePlanModeCount,
    },
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    lastReadAt: thread.lastReadAt,
    latestAttentionAt: thread.latestAttentionAt,
  };
}

export function toThreadWireRow(
  thread: RecoverySdkThreadRow,
  hostNameById: ReadonlyMap<string, string>,
): RecoveryThreadWireRow {
  const hostId = thread.environmentHostId;
  const hostName = hostId === null ? undefined : hostNameById.get(hostId);
  return {
    ...toThreadWireFields(thread),
    environment:
      thread.environmentId === null
        ? null
        : {
            id: thread.environmentId,
            name: thread.environmentName,
            branchName: thread.environmentBranchName,
            providerId: thread.environmentProviderId,
            workspaceDisplayKind: thread.environmentWorkspaceDisplayKind,
          },
    host:
      hostId === null || hostName === undefined
        ? null
        : { id: hostId, name: hostName },
  };
}

export function createThreadReader(bb: BbPluginApi): ThreadReader {
  const listArchivedThreads = async (): Promise<ThreadPage> => {
    const collected: RecoverySdkThreadRow[] = [];
    for (let page = 0; page < ARCHIVED_PAGE_LIMIT; page += 1) {
      const rows = await bb.sdk.threads.list({
        archived: true,
        limit: ARCHIVED_PAGE_SIZE,
        offset: page * ARCHIVED_PAGE_SIZE,
      });
      collected.push(...rows);
      if (rows.length < ARCHIVED_PAGE_SIZE) break;
    }
    return {
      rows: collected,
      truncated: collected.length >= ARCHIVED_PAGE_LIMIT * ARCHIVED_PAGE_SIZE,
    };
  };

  const listThreadRows = async (
    filters: ThreadListFilters,
  ): Promise<ThreadPage> => {
    const collected: RecoverySdkThreadRow[] = [];
    for (let page = 0; page < BULK_PAGE_LIMIT; page += 1) {
      const rows = await bb.sdk.threads.list({
        ...filters,
        // Bulk deletion needs the full family, including rows bb hides.
        includeHidden: true,
        limit: BULK_PAGE_SIZE,
        offset: page * BULK_PAGE_SIZE,
      });
      collected.push(...rows);
      if (rows.length < BULK_PAGE_SIZE) {
        return { rows: collected, truncated: false };
      }
    }
    return {
      rows: collected,
      truncated: collected.length >= BULK_PAGE_LIMIT * BULK_PAGE_SIZE,
    };
  };

  const listBothArchiveStates = async (filters: {
    projectId?: string;
    parentThreadId?: string;
  }): Promise<ThreadPage> => {
    const [active, archived] = await Promise.all([
      listThreadRows({ ...filters, archived: false }),
      listThreadRows({ ...filters, archived: true }),
    ]);
    // There is one logical thread. If both reads return it, the archived row is
    // the newer answer and replaces the active one.
    const byId = new Map<string, RecoverySdkThreadRow>();
    for (const thread of [...active.rows, ...archived.rows]) {
      byId.set(thread.id, thread);
    }
    return {
      rows: [...byId.values()],
      truncated: active.truncated || archived.truncated,
    };
  };

  const listVisibleThreadRows = async (): Promise<ThreadPage> => {
    const collected: RecoverySdkThreadRow[] = [];
    let scanned = 0;
    for (let page = 0; page < BULK_PAGE_LIMIT; page += 1) {
      const rows: RecoverySdkThreadRow[] = await bb.sdk.threads.list({
        archived: false,
        limit: BULK_PAGE_SIZE,
        offset: page * BULK_PAGE_SIZE,
      });
      scanned += rows.length;
      collected.push(...rows.filter((row) => row.visibility === "visible"));
      // Stop on the raw page size. Hidden rows still count toward pagination.
      if (rows.length < BULK_PAGE_SIZE) {
        return { rows: collected, truncated: false };
      }
    }
    return {
      rows: collected,
      truncated: scanned >= BULK_PAGE_LIMIT * BULK_PAGE_SIZE,
    };
  };

  const readThreadRow = async (
    threadId: string,
  ): Promise<AuthoritativeThreadRow | null> => {
    const read = async (
      archived: boolean,
    ): Promise<RecoverySdkThreadRow | null> => {
      try {
        const rows = await bb.sdk.threads.list({
          threadIds: [threadId],
          archived,
          includeHidden: true,
          limit: 1,
        });
        return rows.find((row) => row.id === threadId) ?? null;
      } catch {
        return null;
      }
    };
    // The list row is the one read that carries `activity`; `threads.get`
    // returns the identity without it, which would turn a live background
    // command into a deletable "idle" root.
    const row = (await read(false)) ?? (await read(true));
    if (row === null || row.deletedAt !== null) return null;
    return {
      id: row.id,
      projectId: row.projectId,
      title: row.title,
      titleFallback: row.titleFallback,
      parentThreadId: row.parentThreadId,
      status: row.status,
      hasPendingInteraction: row.hasPendingInteraction,
      pinnedAt: row.pinnedAt,
      lastReadAt: row.lastReadAt,
      latestAttentionAt: row.latestAttentionAt,
      deletedAt: row.deletedAt,
      activity: row.activity,
      runtime: row.runtime,
    };
  };

  const hostNamesById = async (): Promise<Map<string, string>> => {
    const hosts = await bb.sdk.hosts.list();
    return new Map(hosts.map((host) => [host.id, host.name]));
  };

  return {
    listArchivedThreads,
    listThreadRows,
    listBothArchiveStates,
    listVisibleThreadRows,
    readThreadRow,
    hostNamesById,
  };
}
