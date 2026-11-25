/**
 * Park & automatic wake lifecycle for long-running multi-repo features.
 *
 * Parking hides a feature into the Parked collapsible group with optional
 * reason/note/wake criteria without deleting worktrees or archiving threads.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { featureForPath, type Feature } from "../../lib/domain/features.ts";
import type { FeatureStore } from "../../lib/stores/feature-store.ts";
import { FeatureError, type FeatureSnapshot } from "./types.ts";

const MAX_TIMER_DELAY_MS = 24 * 60 * 60 * 1000;

export function createFeatureParkController(input: {
  readonly bb: BbPluginApi;
  readonly store: FeatureStore;
  readonly getCached: () => FeatureSnapshot;
  readonly refresh: () => Promise<FeatureSnapshot>;
  readonly publish: () => void;
  readonly invalidate: (tags: readonly string[]) => void;
}) {
  const { bb, store, getCached, refresh, publish, invalidate } = input;
  let wakeTimer: NodeJS.Timeout | null = null;
  let disposed = false;

  const clearTimer = () => {
    if (wakeTimer !== null) {
      clearTimeout(wakeTimer);
      wakeTimer = null;
    }
  };

  const notify = (featureId: string) => {
    publish();
    invalidate(["features", `feature:${featureId}`]);
  };

  const park = async (input: {
    readonly featureId: string;
    readonly reason?: string | null;
    readonly note?: string | null;
    readonly wakeAt?: number | null;
    readonly wakeOnActivity?: boolean;
  }): Promise<Feature> => {
    const existing = store.find(input.featureId);
    if (existing === undefined) {
      throw new FeatureError("That feature no longer exists.", "not-found");
    }
    if (existing.state === "archived") {
      throw new FeatureError(
        "Archived features must be reopened before parking.",
        "conflict",
      );
    }
    const ok = store.park(input.featureId, {
      reason: input.reason ?? null,
      note: input.note ?? null,
      wakeAt: input.wakeAt ?? null,
      wakeOnActivity: input.wakeOnActivity ?? false,
    });
    if (!ok) {
      throw new FeatureError("Could not park feature.", "unavailable");
    }
    await refresh();
    const updated = store.find(input.featureId);
    if (updated === undefined) {
      throw new FeatureError("That feature no longer exists.", "not-found");
    }
    notify(updated.id);
    scheduleNextWake();
    return updated;
  };

  const unpark = async (featureId: string): Promise<Feature> => {
    const existing = store.find(featureId);
    if (existing === undefined) {
      throw new FeatureError("That feature no longer exists.", "not-found");
    }
    if (existing.state === "archived") {
      throw new FeatureError(
        "Use reopen to restore a finished feature.",
        "conflict",
      );
    }
    if (existing.state === "active") return existing;
    const ok = store.unpark(featureId);
    if (!ok) {
      throw new FeatureError("Could not wake feature.", "unavailable");
    }
    await refresh();
    const updated = store.find(featureId);
    if (updated === undefined) {
      throw new FeatureError("That feature no longer exists.", "not-found");
    }
    notify(updated.id);
    scheduleNextWake();
    return updated;
  };

  const processDueWakes = async (): Promise<void> => {
    if (disposed) return;
    const due = store.dueParkedWakes(Date.now());
    if (due.length === 0) {
      scheduleNextWake();
      return;
    }
    for (const item of due) {
      store.unpark(item.id);
    }
    await refresh().catch(() => undefined);
    publish();
    invalidate(["features", ...due.map((item) => `feature:${item.id}`)]);
    scheduleNextWake();
  };

  const scheduleNextWake = (): void => {
    clearTimer();
    if (disposed) return;
    const now = Date.now();
    const parkedWithWake = store
      .list()
      .filter(
        (feature) =>
          feature.state === "parked" &&
          feature.wakeAt !== null &&
          feature.wakeAt !== undefined,
      );
    if (parkedWithWake.length === 0) return;

    const minWakeAt = Math.min(
      ...parkedWithWake.map((feature) => feature.wakeAt ?? Number.MAX_SAFE_INTEGER),
    );
    const delayMs = Math.max(0, Math.min(minWakeAt - now, MAX_TIMER_DELAY_MS));
    wakeTimer = setTimeout(() => {
      wakeTimer = null;
      void processDueWakes();
    }, delayMs);
    wakeTimer.unref?.();
  };

  const handleThreadActivity = async (threadId: string): Promise<void> => {
    if (disposed) return;
    const autoWakeCandidates = store
      .list()
      .filter(
        (feature) =>
          feature.state === "parked" && feature.wakeOnActivity === true,
      );
    if (autoWakeCandidates.length === 0) return;

    try {
      const thread = await bb.sdk.threads.get({ threadId });
      const environmentId =
        "environmentId" in thread && typeof thread.environmentId === "string"
          ? thread.environmentId
          : null;
      if (environmentId === null) return;

      const adoptedFeatureId = getCached().adoptions[environmentId];
      if (adoptedFeatureId !== undefined) {
        const adoptedMatch = autoWakeCandidates.find(
          (candidate) => candidate.id === adoptedFeatureId,
        );
        if (adoptedMatch !== undefined) {
          await unpark(adoptedMatch.id);
          return;
        }
      }

      const environment = await bb.sdk.environments.get({ environmentId });
      const matched = featureForPath(autoWakeCandidates, environment.path ?? null);
      if (matched !== null) {
        await unpark(matched.id);
      }
    } catch {
      // Thread/environment lookup errors must never crash host event listeners.
    }
  };

  const dispose = (): void => {
    disposed = true;
    clearTimer();
  };

  return {
    park,
    unpark,
    processDueWakes,
    scheduleNextWake,
    handleThreadActivity,
    dispose,
  };
}
