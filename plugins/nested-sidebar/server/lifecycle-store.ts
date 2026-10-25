/**
 * The settled / snoozed row, as the database and the shelf both see it.
 *
 * A type module rather than a store: the row's shape is what the RPC handlers
 * and the warm-start cache agree on, and putting it here means neither has to
 * reach into `server.ts` for it. The functions that read and write these rows
 * stay in `server.ts`, where the database handle is.
 */
export interface StoredLifecycleRow {
  threadId: string;
  settledAt: number | null;
  snoozedUntil: number | null;
  snoozedAt: number | null;
  /** Every id the settle's archive took, this thread's own included. */
  archivedThreadIds: string[];
}
