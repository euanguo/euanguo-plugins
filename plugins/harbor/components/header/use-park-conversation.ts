import { useCallback, useMemo } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";

import type { harborRpcContract } from "@/server/contract";
import { resolveSnoozePresets } from "@/lib/domain/lifecycle";

/**
 * The two ways a header can park a conversation.
 *
 * Closing a tab is a Settle, not an archive: the conversation goes onto Harbor's
 * Settled shelf, where the user can take it back, instead of into bb's archive
 * where the sidebar cannot show it. The header calls the same RPC the sidebar
 * does, so the row moves everywhere the lifecycle store is read.
 */
export function useParkConversation(): {
  settle(threadId: string): void;
  snoozeUntilTomorrow(threadId: string): void;
} {
  const rpc = useRpc<typeof harborRpcContract>();

  const settle = useCallback(
    (threadId: string) => {
      void rpc
        .call("settle", { threadId })
        .then((result) => {
          if (!result.archived) {
            toast.error(
              "Settled, but bb could not archive this conversation. It stays on the shelf here.",
            );
          }
        })
        .catch(() => toast.error("Could not settle this conversation."));
    },
    [rpc],
  );

  const snoozeUntilTomorrow = useCallback(
    (threadId: string) => {
      const tomorrow = resolveSnoozePresets(new Date()).find(
        (preset) => preset.id === "tomorrow",
      );
      if (tomorrow === undefined) return;
      void rpc
        .call("snooze", { threadId, snoozedUntil: tomorrow.snoozedUntil })
        .then((result) => {
          if (!result.ok) {
            toast.error(
              `Could not snooze this conversation: ${result.message ?? "the archive could not be taken back"}.`,
            );
          }
        })
        .catch(() => toast.error("Could not snooze this conversation."));
    },
    [rpc],
  );

  return useMemo(
    () => ({ settle, snoozeUntilTomorrow }),
    [settle, snoozeUntilTomorrow],
  );
}
