/**
 * Subscribe to a realtime channel and collapse a burst of publishes into at most
 * two reads.
 *
 * A drop-in for `useRealtime(channel, () => refresh())` wherever the handler's
 * only job is to re-read. The policy — and why it has a leading edge — is in
 * `lib/realtime-coalesce.ts`.
 *
 * Two things are deliberate:
 *
 * - `refresh` is read through a ref, so a caller whose `refresh` changes identity
 *   on every render (a `useRetryingRead` result, or an inline arrow) does not
 *   tear the subscription down and rebuild it per render.
 * - The timer is cleared on unmount. A trailing read that fires after the
 *   component is gone would set state on a dead tree.
 */

import { useEffect, useRef } from "react";
import { useRealtime } from "@get-bb/plugin-sdk/app";
import {
  coalesceDecision,
  REALTIME_COALESCE_MS,
} from "@/lib/realtime-coalesce";

export function useCoalescedRealtime(
  channel: string,
  refresh: () => void,
  windowMs: number = REALTIME_COALESCE_MS,
): void {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const windowRef = useRef(windowMs);
  windowRef.current = windowMs;
  const trailing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRunAt = useRef(0);

  useEffect(
    () => () => {
      if (trailing.current !== null) clearTimeout(trailing.current);
      trailing.current = null;
    },
    [],
  );

  useRealtime(channel, () => {
    const decision = coalesceDecision({
      now: Date.now(),
      lastRunAt: lastRunAt.current,
      windowMs: windowRef.current,
      trailingScheduled: trailing.current !== null,
    });
    if (decision.kind === "swallow") return;
    if (decision.kind === "run-now") {
      lastRunAt.current = Date.now();
      refreshRef.current();
      return;
    }
    trailing.current = setTimeout(() => {
      trailing.current = null;
      lastRunAt.current = Date.now();
      refreshRef.current();
    }, decision.delayMs);
  });
}