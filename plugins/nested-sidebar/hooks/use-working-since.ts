import { createContext, useContext, useEffect, useState } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import {
  EMPTY_WORKING_SINCE,
  readWorkingSince,
  reconcileWorkingSince,
  writeWorkingSince,
  type WorkingSince,
} from "@/lib/working-since";

/**
 * Handed down by context rather than props: the status slot sits under cards
 * and slim rows alike, and each would otherwise thread one more value through
 * three layers to reach it.
 *
 * Ported from BB Sidebar (`src/useWorkingSince.ts`); see
 * THIRD_PARTY_NOTICES.md.
 */
export const WorkingSinceContext =
  createContext<WorkingSince>(EMPTY_WORKING_SINCE);

export function useWorkingSinceContext(): WorkingSince {
  return useContext(WorkingSinceContext);
}

/**
 * Track when each thread in the list started its current run of work.
 *
 * The caller hands over the merged, unfolded list rather than what is drawn:
 * a search or a filter must not be able to clear a stamp, because the thread
 * is still working either way.
 */
export function useWorkingSince(
  threads: readonly PluginSidebarThread[],
): WorkingSince {
  const [workingSince, setWorkingSince] =
    useState<WorkingSince>(readWorkingSince);
  useEffect(() => {
    setWorkingSince((previous) =>
      reconcileWorkingSince(previous, threads, Date.now()),
    );
  }, [threads]);
  useEffect(() => {
    if (workingSince === EMPTY_WORKING_SINCE) return;
    writeWorkingSince(workingSince);
  }, [workingSince]);
  return workingSince;
}
