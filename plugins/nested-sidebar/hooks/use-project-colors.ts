import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { nestRpcContract } from "@/server";
import { useRetryingRead } from "@/hooks/use-retrying-read";
import { useCoalescedRealtime } from "@/hooks/use-coalesced-realtime";
import { defineStoreSnapshot } from "@/lib/store-snapshot";

// A color an override is not there yet reads as "none", so an empty seed drops
// every custom color off its row until the read lands. Memory only, unlike the
// stores that persist: these values are interpolated into CSS, so a durable
// copy needs a decode at the strength of `warm-start.ts`'s logo guard — parsed
// back to a base and re-serialized from the parse — and that is its own change
// rather than a line added here.
const projectColorsSnapshot =
  defineStoreSnapshot<ReadonlyMap<string, string>>("project-colors");

export interface ProjectColorsApi {
  overrides: ReadonlyMap<string, string>;
  isLoading: boolean;
  reload(): void;
  setProjectColor(projectId: string, color: string): Promise<string>;
  resetProjectColor(projectId: string): Promise<void>;
}

export function useProjectColors(): ProjectColorsApi {
  const rpc = useRpc<typeof nestRpcContract>();
  const [seed] = useState(() => projectColorsSnapshot.read());
  const [overrides, setOverrides] = useState<ReadonlyMap<string, string>>(
    () => seed ?? new Map(),
  );
  const [isLoading, setIsLoading] = useState(seed === undefined);
  const requestSequence = useRef(0);

  const read = useCallback(async () => {
    const sequence = ++requestSequence.current;
    const result = await rpc.call("listProjectColors", {});
    if (sequence !== requestSequence.current) return;
    const next = new Map(
      result.colors.map(({ projectId, color }) => [projectId, color]),
    );
    setOverrides(next);
    setIsLoading(false);
    // After the state, not before it: what is on screen must never depend on
    // the snapshot write having gone through.
    projectColorsSnapshot.write(next);
  }, [rpc]);
  const refresh = useRetryingRead(read);

  useEffect(() => refresh(), [refresh]);
  useCoalescedRealtime("project-colors", refresh);

  const connectionState = useRealtimeConnectionState();
  const previousConnectionState = useRef(connectionState);
  useEffect(() => {
    const previous = previousConnectionState.current;
    previousConnectionState.current = connectionState;
    if (previous === "reconnecting" && connectionState === "connected") {
      refresh();
    }
  }, [connectionState, refresh]);

  const setProjectColor = useCallback(
    async (projectId: string, color: string) => {
      const stored = await rpc.call("setProjectColor", { projectId, color });
      setOverrides((current) => {
        const next = new Map(current);
        next.set(stored.projectId, stored.color);
        return next;
      });
      return stored.color;
    },
    [rpc],
  );

  const resetProjectColor = useCallback(
    async (projectId: string) => {
      await rpc.call("resetProjectColor", { projectId });
      setOverrides((current) => {
        if (!current.has(projectId)) return current;
        const next = new Map(current);
        next.delete(projectId);
        return next;
      });
    },
    [rpc],
  );

  return useMemo(
    () => ({
      overrides,
      isLoading,
      reload: refresh,
      resetProjectColor,
      setProjectColor,
    }),
    [isLoading, overrides, refresh, resetProjectColor, setProjectColor],
  );
}
