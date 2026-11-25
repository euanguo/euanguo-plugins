/**
 * The settled / snoozed row, as the database and the shelf both see it.
 *
 * A type module rather than a store: the row's shape is what the RPC handlers
 * and the warm-start cache agree on, and putting it here means neither has to
 * reach into `server.ts` for it. The one reader and writer is
 * `server/lifecycle-service.ts`, which owns the database handle's lifecycle
 * rows.
 */
export interface StoredLifecycleRow {
  threadId: string;
  settledAt: number | null;
  snoozedUntil: number | null;
  snoozedAt: number | null;
  /** Every id the settle's archive took, this thread's own included. */
  archivedThreadIds: string[];
}
