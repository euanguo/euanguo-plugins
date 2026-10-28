import { useCallback, useEffect, useMemo, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { nestRpcContract } from "@/server/contract";
import { APPEARANCE_CHANNEL } from "@/lib/realtime-channels";
import {
  APPEARANCE_DEFAULTS,
  resolveAppearance,
  type AppearanceKey,
  type AppearanceValues,
} from "@/lib/appearance";
import { resolveNestPreferences, type NestPreferences } from "@/lib/preferences";
import { defineStoreSnapshot } from "@/lib/store-snapshot";
import { useCoalescedRealtime } from "@/hooks/use-coalesced-realtime";

/**
 * The last record this page read, held for the frame before the next read
 * lands.
 *
 * Same reason as `use-view-preferences`: bb unmounts the thread list on the way
 * into settings and brings it back with every piece of local state reset, so a
 * hook that starts empty paints the default palette for one round trip and then
 * snaps to the user's. A wrong colour for a frame is a wrong fact, not a wrong
 * order, which is why this one persists rather than only living in module scope.
 */
const appearanceSnapshot = defineStoreSnapshot<AppearanceValues>("appearance", {
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
});

export interface AppearanceApi {
  /** The stored record, already merged over its defaults. */
  readonly values: AppearanceValues;
  /** The same record resolved into what the components actually draw with. */
  readonly preferences: NestPreferences;
  readonly ready: boolean;
  set(patch: Partial<Record<AppearanceKey, unknown>>): void;
}

/**
 * The appearance settings, read once and re-read on the plugin's publish.
 *
 * It mirrors `useSettings` in shape but reads the plugin's own store, so every
 * value is writable from the frontend — which is what lets the settings page
 * and, later, the view menu change a display option where the user sees it.
 */
export function useAppearance(): AppearanceApi {
  const rpc = useRpc<typeof nestRpcContract>();
  const [seed] = useState(() => appearanceSnapshot.read());
  const [values, setValues] = useState<AppearanceValues>(
    () => seed ?? { ...APPEARANCE_DEFAULTS },
  );
  const [ready, setReady] = useState(seed !== undefined);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    rpc
      .call("getAppearance", {})
      .then((result) => {
        if (cancelled) return;
        const resolved = resolveAppearance(result);
        appearanceSnapshot.write(resolved);
        setValues(resolved);
        setReady(true);
      })
      .catch(() => {
        // The defaults are always a drawable answer.
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [nonce, rpc]);

  useCoalescedRealtime(APPEARANCE_CHANNEL, refresh);

  const set = useCallback(
    (patch: Partial<Record<AppearanceKey, unknown>>) => {
      // Optimistic, because every one of these is a control the user is looking
      // at. A rejected value comes back in the answer and replaces the guess.
      setValues((current) => resolveAppearance({ ...current, ...patch }));
      void rpc
        .call("setAppearance", patch as never)
        .then((result) => {
          const resolved = resolveAppearance(result);
          appearanceSnapshot.write(resolved);
          setValues(resolved);
        })
        .catch(() => refresh());
    },
    [rpc, refresh],
  );

  const preferences = useMemo(() => resolveNestPreferences(values), [values]);

  return { values, preferences, ready, set };
}
