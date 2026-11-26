import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { harborRpcContract } from "@/server/contract";
import { APPEARANCE_CHANNEL } from "@/lib/realtime-channels";
import {
  APPEARANCE_DEFAULTS,
  resolveAppearance,
  type AppearanceKey,
  type AppearanceValues,
} from "@/lib/domain/appearance";
import { errorMessage } from "@/lib/domain/rpc-error";
import {
  resolveHarborPreferences,
  type HarborPreferences,
} from "@/lib/domain/preferences";
import { defineStoreSnapshot } from "@/lib/persistence/snapshot";
import { useCoalescedRealtime } from "@/hooks/use-coalesced-realtime";

/**
 * The last `appearance:v2` record this page read, held across unmount/remount
 * transitions (e.g. navigating between sidebar and settings) so first paint
 * matches the user's stored preset and density.
 */
const appearanceSnapshot = defineStoreSnapshot<AppearanceValues>(
  "appearance:v2",
  {
    persist: {
      encode: (value) => JSON.stringify(value),
      decode: (stored) => {
        try {
          return resolveAppearance(JSON.parse(stored));
        } catch {
          return null;
        }
      },
    },
  },
);

export interface AppearanceApi {
  /** The stored record, merged over `APPEARANCE_DEFAULTS`. */
  readonly values: AppearanceValues;
  /** Resolved preferences consumed by sidebar and settings views. */
  readonly preferences: HarborPreferences;
  readonly ready: boolean;
  /** Last read/write failure message, or null when clean. */
  readonly error: string | null;
  clearError: () => void;
  set: (
    patch: Partial<Record<AppearanceKey, unknown>>,
  ) => Promise<AppearanceValues | null>;
}

/**
 * Appearance settings, read once on mount and refreshed on plugin realtime
 * notifications, with error propagation and optimistic write tracking.
 */
export function useAppearance(): AppearanceApi {
  const rpc = useRpc<typeof harborRpcContract>();
  const [seed] = useState(() => appearanceSnapshot.read());
  const [values, setValues] = useState<AppearanceValues>(
    () => seed ?? { ...APPEARANCE_DEFAULTS },
  );
  const [ready, setReady] = useState(seed !== undefined);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const writeSeqRef = useRef(0);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);
  const clearError = useCallback(() => setError(null), []);

  useEffect(() => {
    let cancelled = false;
    rpc
      .call("getAppearance", {})
      .then((result) => {
        if (cancelled) return;
        const resolved = resolveAppearance(result);
        appearanceSnapshot.write(resolved);
        setValues(resolved);
        setError(null);
        setReady(true);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(errorMessage(caught, "Could not load appearance settings."));
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [nonce, rpc]);

  useCoalescedRealtime(APPEARANCE_CHANNEL, refresh);

  const set = useCallback(
    async (
      patch: Partial<Record<AppearanceKey, unknown>>,
    ): Promise<AppearanceValues | null> => {
      const seq = ++writeSeqRef.current;
      setError(null);
      setValues((current) => resolveAppearance({ ...current, ...patch }));
      try {
        const result = await rpc.call("setAppearance", patch as never);
        const resolved = resolveAppearance(result);
        if (seq === writeSeqRef.current) {
          appearanceSnapshot.write(resolved);
          setValues(resolved);
        }
        return resolved;
      } catch (caught) {
        setError(errorMessage(caught, "Could not save appearance settings."));
        refresh();
        return null;
      }
    },
    [rpc, refresh],
  );

  const preferences = useMemo(() => resolveHarborPreferences(values), [values]);

  return useMemo(
    () => ({ values, preferences, ready, error, clearError, set }),
    [values, preferences, ready, error, clearError, set],
  );
}
