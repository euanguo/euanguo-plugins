/**
 * Bulk deletion: a preview, then a token.
 *
 * Two calls rather than one because deleting a thread family is recursive and
 * irreversible. The preview answers with what would go and what would be
 * skipped; the token is what proves the confirmation was given for that
 * answer and not for a list that has since changed.
 */
import type { HarborRpcHandlers } from "../contract.ts";
import type { createBulkDeleteCoordinator } from "../../lib/domain/bulk-delete.ts";

export interface BulkHandlerDeps {
  readonly bulkDelete: ReturnType<typeof createBulkDeleteCoordinator>;
}

export function bulkHandlers(
  deps: BulkHandlerDeps,
): HarborRpcHandlers<"previewBulkDelete" | "confirmBulkDelete"> {
  const { bulkDelete } = deps;

  return {
    async previewBulkDelete({ threadIds, protectedThreadId }) {
      return bulkDelete.preview(threadIds, protectedThreadId);
    },

    async confirmBulkDelete({ token }) {
      return bulkDelete.confirm(token);
    },
  };
}
