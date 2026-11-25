import { useEffect, useRef } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

import {
  forgetHarborActions,
  publishHarborActions,
  type PublishedHarborActions,
} from "@/lib/ui/palette-bridge";
import { resolveSnoozePresets } from "@/lib/domain/lifecycle";
import type { LifecycleApi } from "@/hooks/use-lifecycle";
import type { HarborViewState } from "@/lib/ui/view-state";

export function useInboxPalette(input: {
  readonly lifecycle: LifecycleApi;
  readonly threads: readonly PluginSidebarThread[];
  readonly patchViewState: (patch: Partial<HarborViewState>) => void;
}): void {
  const paletteRef = useRef(input);
  paletteRef.current = input;

  useEffect(() => {
    const canParkFromPalette = (threadId: string): boolean => {
      const { lifecycle, threads } = paletteRef.current;
      const thread = threads.find((candidate) => candidate.id === threadId);
      return thread !== undefined && lifecycle.canPark(thread);
    };

    const actions: PublishedHarborActions = {
      settle(threadId) {
        if (!canParkFromPalette(threadId)) return;
        paletteRef.current.lifecycle.settle(threadId);
      },
      snoozeUntilTomorrow(threadId) {
        if (!canParkFromPalette(threadId)) return;
        const tomorrow = resolveSnoozePresets(new Date()).find(
          (preset) => preset.id === "tomorrow",
        );
        if (tomorrow === undefined) return;
        paletteRef.current.lifecycle.snooze(
          threadId,
          tomorrow.snoozedUntil,
        );
      },
      wake(threadId) {
        const row = paletteRef.current.lifecycle.parkedRows.get(threadId);
        if (row === undefined) return;
        if (row.snoozedUntil !== null) {
          paletteRef.current.lifecycle.unsnooze(threadId);
        } else if (row.settledAt !== null) {
          paletteRef.current.lifecycle.unsettle(threadId);
        }
      },
      canPark: canParkFromPalette,
      isParked(threadId) {
        const row = paletteRef.current.lifecycle.parkedRows.get(threadId);
        return (
          row !== undefined &&
          (row.snoozedUntil !== null || row.settledAt !== null)
        );
      },
      showNeedsYou() {
        paletteRef.current.patchViewState({ filter: "needs-you" });
      },
    };
    publishHarborActions(actions);
    return () => forgetHarborActions(actions);
  }, []);
}
