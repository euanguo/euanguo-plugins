import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { nestRpcContract } from "@/server";
import { useRetryingRead } from "@/hooks/use-retrying-read";
import { useCoalescedRealtime } from "@/hooks/use-coalesced-realtime";
import { defineStoreSnapshot } from "@/lib/store-snapshot";
import type { ProjectIcon } from "@/lib/project-icons";

/**
 * Which projects have already been asked about, kept with the icons they
 * answered with.
 *
 * The read alone is not enough to decide what to probe: a project with no icon
 * is absent from it, and asking again for every such project on every mount is
 * the whole cost this caching exists to avoid. `asked` is the other half of the
 * answer, and it is the half that has to survive a remount — bb unmounts the
 * sidebar when the settings route is opened.
 *
 * Memory only, like the colour store: these values are base64 images, and the
 * durable tier would be re-parsing them during render on every cold start for a
 * frame that is correct either way.
 */
interface ProjectIconsSnapshot {
  icons: ReadonlyMap<string, ProjectIcon>;
  asked: ReadonlySet<string>;
}

const projectIconsSnapshot =
  defineStoreSnapshot<ProjectIconsSnapshot>("project-icons");

export interface ProjectIconsApi {
  icons: ReadonlyMap<string, ProjectIcon>;
  isLoading: boolean;
}

/**
 * A project's own icon, when its checkout has one and detection is on.
 *
 * Detection is asked for lazily, one project at a time, and only for projects
 * this page has not asked about: the first paint draws letters either way, so
 * nothing here is worth blocking a frame on. A probe that fails — an offline
 * machine, a refused call — leaves the letter badge standing and is not
 * retried until the next mount.
 */
export function useProjectIcons({
  projectIds,
  enabled,
}: {
  projectIds: readonly string[];
  enabled: boolean;
}): ProjectIconsApi {
  const rpc = useRpc<typeof nestRpcContract>();
  const [seed] = useState(() => projectIconsSnapshot.read());
  const [icons, setIcons] = useState<ReadonlyMap<string, ProjectIcon>>(
    () => seed?.icons ?? new Map(),
  );
  const [isLoading, setIsLoading] = useState(seed === undefined);
  const requestSequence = useRef(0);
  const asked = useRef<Set<string>>(new Set(seed?.asked ?? []));
  /**
   * The map as the probe loop last left it.
   *
   * The loop awaits between projects, so the state it started from is stale by
   * the second one, and the snapshot it writes at the end has to be the map it
   * actually built rather than the one its closure captured.
   */
  const currentIcons = useRef(icons);
  const publish = useCallback((next: ReadonlyMap<string, ProjectIcon>) => {
    currentIcons.current = next;
    setIcons(next);
  }, []);

  const read = useCallback(async () => {
    const sequence = ++requestSequence.current;
    const result = await rpc.call("listProjectIcons", {});
    if (sequence !== requestSequence.current) return;
    const next = new Map<string, ProjectIcon>();
    for (const row of result.icons) {
      asked.current.add(row.projectId);
      if (row.icon !== null) next.set(row.projectId, row.icon);
    }
    publish(next);
    setIsLoading(false);
    // After the state, not before it: what is on screen must never depend on
    // the snapshot write having gone through.
    projectIconsSnapshot.write({ icons: next, asked: new Set(asked.current) });
  }, [publish, rpc]);
  const refresh = useRetryingRead(read);

  useEffect(() => refresh(), [refresh]);
  useCoalescedRealtime("project-icons", refresh);

  const connectionState = useRealtimeConnectionState();
  const previousConnectionState = useRef(connectionState);
  useEffect(() => {
    const previous = previousConnectionState.current;
    previousConnectionState.current = connectionState;
    if (previous === "reconnecting" && connectionState === "connected") {
      refresh();
    }
  }, [connectionState, refresh]);

  /**
   * The id list as one string, so the effect below runs when the set of
   * projects changes and not merely because the array was rebuilt.
   */
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
          // The letter badge is the answer for a probe that did not run, and
          // the id stays asked so one bad call does not become a loop.
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
    // `projectIds` is read inside but keyed by value, through `projectKey`.
  }, [enabled, projectKey, publish, rpc]);

  return useMemo(() => ({ icons, isLoading }), [icons, isLoading]);
}
