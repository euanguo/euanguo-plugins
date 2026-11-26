import { useCallback, useEffect, useRef } from "react";
import { useRealtimeConnectionState } from "@get-bb/plugin-sdk/app";
import { useCoalescedRealtime } from "@/hooks/use-coalesced-realtime";
import { useRetryingRead } from "@/hooks/use-retrying-read";

/**
 * Shared RPC-backed realtime store lifecycle: monotonic sequence guard against
 * out-of-order responses, retrying initial read, coalesced realtime refreshes,
 * and re-read on socket reconnect.
 */
export function useRealtimeRpcStore({
  channel,
  read,
}: {
  readonly channel: string;
  readonly read: (isCurrent: () => boolean) => Promise<void>;
}): () => void {
  const requestSeq = useRef(0);
  const runRead = useCallback(async () => {
    const seq = ++requestSeq.current;
    await read(() => seq === requestSeq.current);
  }, [read]);
  const refresh = useRetryingRead(runRead);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useCoalescedRealtime(channel, refresh);

  const connectionState = useRealtimeConnectionState();
  const previousConnectionState = useRef(connectionState);
  useEffect(() => {
    const previous = previousConnectionState.current;
    previousConnectionState.current = connectionState;
    if (previous === "reconnecting" && connectionState === "connected") {
      refresh();
    }
  }, [connectionState, refresh]);

  return refresh;
}
