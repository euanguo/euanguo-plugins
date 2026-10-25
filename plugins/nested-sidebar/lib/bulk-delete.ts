export const MAX_BULK_DELETE_ROOTS = 50;
export const MAX_BULK_DELETE_THREADS = 500;
export const BULK_DELETE_TOKEN_TTL_MS = 60_000;

export type BulkDeleteSkipReason =
  | "missing"
  | "current"
  | "working"
  | "waiting"
  | "unread"
  | "pinned"
  | "overlap"
  | "scope-changed";

export interface BulkDeleteActivity {
  workflows: number;
  backgroundAgents: number;
  backgroundCommands: number;
  planMode: number;
  goals: number;
}

export interface BulkDeleteThreadSnapshot {
  id: string;
  title: string;
  parentThreadId: string | null;
  status: string;
  hasPendingInteraction: boolean;
  isPinned: boolean;
  isUnread: boolean;
  activity: BulkDeleteActivity;
}

export interface BulkDeleteFamilySnapshot {
  root: BulkDeleteThreadSnapshot;
  /** Every recursive descendant, hidden ones included. */
  descendants: readonly BulkDeleteThreadSnapshot[];
}

export interface BulkDeleteIncludedRoot {
  id: string;
  title: string;
  childCount: number;
}

export interface BulkDeleteSkippedRoot {
  id: string;
  reason: BulkDeleteSkipReason;
  message: string;
}

export interface BulkDeleteFailedRoot {
  id: string;
  message: string;
}

export interface BulkDeletePreview {
  token: string | null;
  expiresAt: number | null;
  included: BulkDeleteIncludedRoot[];
  skipped: BulkDeleteSkippedRoot[];
  rootCount: number;
  childCount: number;
  totalThreadCount: number;
}

export interface BulkDeleteResult {
  deleted: string[];
  skipped: BulkDeleteSkippedRoot[];
  failed: BulkDeleteFailedRoot[];
}

export interface BulkDeleteAdapter {
  readFamily(rootId: string): Promise<BulkDeleteFamilySnapshot | null>;
  deleteRoot(rootId: string, childThreadsConfirmed: boolean): Promise<void>;
  now(): number;
  createToken(): string;
  reportFailure?(rootId: string, error: unknown): void;
}

interface PendingPreview {
  /** Exact cascade scope the user reviewed; any identity drift needs a preview. */
  roots: Array<{
    id: string;
    descendantIds: string[];
  }>;
  protectedThreadId: string | null;
  expiresAt: number;
}

export class BulkDeleteTokenError extends Error {
  readonly code = "invalid_or_expired_token";

  constructor() {
    super("This deletion preview expired or was already used. Review the selection again.");
    this.name = "BulkDeleteTokenError";
  }
}

export function createBulkDeleteCoordinator(adapter: BulkDeleteAdapter) {
  const previews = new Map<string, PendingPreview>();

  const pruneExpired = () => {
    const now = adapter.now();
    for (const [token, preview] of previews) {
      if (preview.expiresAt <= now) previews.delete(token);
    }
  };

  const preview = async (
    threadIds: readonly string[],
    protectedThreadId: string | null,
  ): Promise<BulkDeletePreview> => {
    pruneExpired();
    validateRootIds(threadIds);

    const requested = new Set(threadIds);
    const included: BulkDeleteIncludedRoot[] = [];
    const boundRoots: PendingPreview["roots"] = [];
    const skipped: BulkDeleteSkippedRoot[] = [];
    let totalObserved = 0;

    for (const threadId of threadIds) {
      const family = await adapter.readFamily(threadId);
      if (family === null) {
        skipped.push(skippedRoot(threadId, "missing"));
        continue;
      }

      totalObserved += 1 + family.descendants.length;
      if (totalObserved > MAX_BULK_DELETE_THREADS) {
        throw new RangeError(
          `Bulk deletion is limited to ${MAX_BULK_DELETE_THREADS} total threads.`,
        );
      }

      if (family.descendants.some((thread) => requested.has(thread.id))) {
        skipped.push(skippedRoot(threadId, "overlap"));
        continue;
      }

      const protection = familyProtection(family, protectedThreadId);
      if (protection !== null) {
        skipped.push(skippedRoot(threadId, protection));
        continue;
      }

      included.push({
        id: family.root.id,
        title: family.root.title,
        childCount: family.descendants.length,
      });
      boundRoots.push({
        id: family.root.id,
        descendantIds: sortedDescendantIds(family),
      });
    }

    const childCount = included.reduce(
      (total, root) => total + root.childCount,
      0,
    );
    if (included.length === 0) {
      return {
        token: null,
        expiresAt: null,
        included,
        skipped,
        rootCount: 0,
        childCount: 0,
        totalThreadCount: 0,
      };
    }

    const token = adapter.createToken();
    const expiresAt = adapter.now() + BULK_DELETE_TOKEN_TTL_MS;
    previews.set(token, {
      roots: boundRoots,
      protectedThreadId,
      expiresAt,
    });
    return {
      token,
      expiresAt,
      included,
      skipped,
      rootCount: included.length,
      childCount,
      totalThreadCount: included.length + childCount,
    };
  };

  const confirm = async (token: string): Promise<BulkDeleteResult> => {
    pruneExpired();
    const pending = previews.get(token);
    if (pending === undefined || pending.expiresAt <= adapter.now()) {
      previews.delete(token);
      throw new BulkDeleteTokenError();
    }
    // Consume before the first irreversible call. A network retry must preview
    // the current state again instead of repeating an ambiguous delete.
    previews.delete(token);

    const deleted: string[] = [];
    const skipped: BulkDeleteSkippedRoot[] = [];
    const failed: BulkDeleteFailedRoot[] = [];

    for (const boundRoot of pending.roots) {
      const threadId = boundRoot.id;
      const family = await adapter.readFamily(threadId);
      if (family === null) {
        skipped.push(skippedRoot(threadId, "missing"));
        continue;
      }
      const protection = familyProtection(
        family,
        pending.protectedThreadId,
      );
      if (protection !== null) {
        skipped.push(skippedRoot(threadId, protection));
        continue;
      }
      if (
        !arraysEqual(
          sortedDescendantIds(family),
          boundRoot.descendantIds,
        )
      ) {
        skipped.push(skippedRoot(threadId, "scope-changed"));
        continue;
      }
      try {
        await adapter.deleteRoot(threadId, family.descendants.length > 0);
        deleted.push(threadId);
      } catch (error) {
        adapter.reportFailure?.(threadId, error);
        failed.push({
          id: threadId,
          message: "Deletion failed. Review the thread and try again.",
        });
      }
    }

    return { deleted, skipped, failed };
  };

  return { preview, confirm };
}

export function familyProtection(
  family: BulkDeleteFamilySnapshot,
  protectedThreadId: string | null,
): Exclude<BulkDeleteSkipReason, "missing"> | null {
  const members = [family.root, ...family.descendants];
  if (family.root.parentThreadId !== null) return "overlap";
  if (
    protectedThreadId !== null &&
    members.some((thread) => thread.id === protectedThreadId)
  ) {
    return "current";
  }
  if (members.some(threadHasLiveWork)) return "working";
  if (members.some((thread) => thread.hasPendingInteraction)) return "waiting";
  if (members.some((thread) => thread.isUnread)) return "unread";
  if (members.some((thread) => thread.isPinned)) return "pinned";
  return null;
}

function threadHasLiveWork(thread: BulkDeleteThreadSnapshot): boolean {
  const activity = thread.activity;
  return (
    (thread.status !== "idle" && thread.status !== "error") ||
    activity.workflows > 0 ||
    activity.backgroundAgents > 0 ||
    activity.backgroundCommands > 0 ||
    activity.planMode > 0 ||
    activity.goals > 0
  );
}

function validateRootIds(threadIds: readonly string[]): void {
  if (threadIds.length === 0 || threadIds.length > MAX_BULK_DELETE_ROOTS) {
    throw new RangeError(
      `Select between 1 and ${MAX_BULK_DELETE_ROOTS} root threads.`,
    );
  }
  if (new Set(threadIds).size !== threadIds.length) {
    throw new TypeError("A root thread can be selected only once.");
  }
}

function skippedRoot(
  id: string,
  reason: BulkDeleteSkipReason,
): BulkDeleteSkippedRoot {
  return { id, reason, message: skipMessage(reason) };
}

function skipMessage(reason: BulkDeleteSkipReason): string {
  switch (reason) {
    case "missing":
      return "Thread no longer exists.";
    case "current":
      return "Thread is currently open.";
    case "working":
      return "Thread or one of its agents is working.";
    case "waiting":
      return "Thread or one of its agents needs your input.";
    case "unread":
      return "Thread or one of its agents is unread.";
    case "pinned":
      return "Thread or one of its agents is pinned.";
    case "overlap":
      return "Selection contains both a root and one of its descendants.";
    case "scope-changed":
      return "Thread tree changed since preview. Review the selection again.";
  }
}

function sortedDescendantIds(family: BulkDeleteFamilySnapshot): string[] {
  return family.descendants.map((thread) => thread.id).sort();
}

function arraysEqual(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
