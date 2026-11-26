import { useCallback, useMemo, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { harborRpcContract } from "@/server/contract";
import { useRealtimeRpcStore } from "@/hooks/use-realtime-rpc-store";
import { defineStoreSnapshot } from "@/lib/persistence/snapshot";

const projectColorsSnapshot = defineStoreSnapshot<ReadonlyMap<string, string>>("project-colors");

export interface ProjectColorsApi {
  overrides: ReadonlyMap<string, string>;
  isLoading: boolean;
  reload(): void;
  setProjectColor(projectId: string, color: string): Promise<string>;
  resetProjectColor(projectId: string): Promise<void>;
}

export function useProjectColors(): ProjectColorsApi {
  const rpc = useRpc<typeof harborRpcContract>();
  const [seed] = useState(() => projectColorsSnapshot.read());
  const [overrides, setOverrides] = useState<ReadonlyMap<string, string>>(
    () => seed ?? new Map(),
  );
  const [isLoading, setIsLoading] = useState(seed === undefined);

  const read = useCallback(
    async (isCurrent: () => boolean) => {
      const result = await rpc.call("listProjectColors", {});
      if (!isCurrent()) return;
      const next = new Map(result.colors.map(({ projectId, color }) => [projectId, color]));
      setOverrides(next);
      setIsLoading(false);
      projectColorsSnapshot.write(next);
    },
    [rpc],
  );
  const refresh = useRealtimeRpcStore({ channel: "project-colors", read });

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
