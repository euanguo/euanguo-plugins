import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { harborRpcContract } from "@/server/contract";
import { useRealtimeRpcStore } from "@/hooks/use-realtime-rpc-store";
import { defineStoreSnapshot } from "@/lib/persistence/snapshot";
import type { ProjectIcon } from "@/lib/domain/project-icons";

interface ProjectIconsSnapshot {
  icons: ReadonlyMap<string, ProjectIcon>;
  asked: ReadonlySet<string>;
}

const projectIconsSnapshot = defineStoreSnapshot<ProjectIconsSnapshot>("project-icons");

export interface ProjectIconsApi {
  icons: ReadonlyMap<string, ProjectIcon>;
  isLoading: boolean;
}

/**
 * Lazily detects each project's repository icon and stays synced over realtime.
 */
export function useProjectIcons({
  projectIds,
  enabled,
}: {
  projectIds: readonly string[];
  enabled: boolean;
}): ProjectIconsApi {
  const rpc = useRpc<typeof harborRpcContract>();
  const [seed] = useState(() => projectIconsSnapshot.read());
  const [icons, setIcons] = useState<ReadonlyMap<string, ProjectIcon>>(
    () => seed?.icons ?? new Map(),
  );
  const [isLoading, setIsLoading] = useState(seed === undefined);
  const asked = useRef<Set<string>>(new Set(seed?.asked ?? []));
  const currentIcons = useRef(icons);
  const publish = useCallback((next: ReadonlyMap<string, ProjectIcon>) => {
    currentIcons.current = next;
    setIcons(next);
  }, []);

  const read = useCallback(
    async (isCurrent: () => boolean) => {
      const result = await rpc.call("listProjectIcons", {});
      if (!isCurrent()) return;
      const next = new Map<string, ProjectIcon>();
      for (const row of result.icons) {
        asked.current.add(row.projectId);
        if (row.icon !== null) next.set(row.projectId, row.icon);
      }
      publish(next);
      setIsLoading(false);
      projectIconsSnapshot.write({ icons: next, asked: new Set(asked.current) });
    },
    [publish, rpc],
  );
  useRealtimeRpcStore({ channel: "project-icons", read });

  const projectKey = useMemo(() => projectIds.join("\u0000"), [projectIds]);

  useEffect(() => {
    if (!enabled) return;
    const pending = projectIds.filter((id) => !asked.current.has(id));
    if (pending.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const projectId of pending) {
        if (cancelled) return;
        asked.current.add(projectId);
        try {
          const entry = await rpc.call("detectProjectIcon", { projectId });
          if (cancelled) return;
          if (entry.icon !== null) {
            publish(new Map(currentIcons.current).set(projectId, entry.icon));
          }
        } catch {
          // Leave letter badge standing without retrying until the next mount.
        }
      }
      projectIconsSnapshot.write({
        icons: currentIcons.current,
        asked: new Set(asked.current),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, projectKey, publish, rpc]);

  return useMemo(() => ({ icons, isLoading }), [icons, isLoading]);
}
