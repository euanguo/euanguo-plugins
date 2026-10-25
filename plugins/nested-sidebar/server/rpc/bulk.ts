/**
 * Bulk deletion: a preview, then a token.
 *
 * Two calls rather than one because deleting a thread family is recursive and
 * irreversible. The preview answers with what would go and what would be
 * skipped; the token is what proves the confirmation was given for that
 * answer and not for a list that has since changed.
 */
import type { PluginRpcHandlers } from "@get-bb/plugin-sdk";
import type { nestRpcContract } from "../contract.ts";

/** This module's slice of the contract, with every other method omitted. */
type Handlers<Method extends keyof typeof nestRpcContract> = Pick<
  PluginRpcHandlers<typeof nestRpcContract>,
  Method
>;
import type { createBulkDeleteCoordinator } from "../../lib/bulk-delete.ts";

export interface BulkHandlerDeps {
  readonly bulkDelete: ReturnType<typeof createBulkDeleteCoordinator>;
}

export function bulkHandlers(
  deps: BulkHandlerDeps,
): Handlers<"previewBulkDelete" | "confirmBulkDelete"> {
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
