/**
 * Where the `appearance:v2` settings live: one plugin KV row protected by an
 * in-memory promise serialization queue so concurrent `set()` patches never
 * clobber each other via stale read-modify-write cycles.
 */

import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  APPEARANCE_KEYS,
  APPEARANCE_KV_KEY,
  normalizeAppearanceValue,
  resolveAppearance,
  type AppearanceKey,
  type AppearanceValues,
} from "../domain/appearance.ts";

export interface AppearanceStore {
  get(): Promise<AppearanceValues>;
  /**
   * Write valid keys present in `patch` (dropping unknown or invalid values and
   * clamping bounded values such as `pageSize`). Returns the stored record.
   */
  set(patch: Partial<Record<AppearanceKey, unknown>>): Promise<AppearanceValues>;
}

export function createAppearanceStore(bb: BbPluginApi): AppearanceStore {
  let queue: Promise<void> = Promise.resolve();

  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const run = queue.then(operation, operation);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  return {
    get() {
      return serialize(async () =>
        resolveAppearance(await bb.storage.kv.get(APPEARANCE_KV_KEY)),
      );
    },

    set(patch) {
      return serialize(async () => {
        const current = await bb.storage.kv.get(APPEARANCE_KV_KEY);
        const next = resolveAppearance(current);
        for (const key of APPEARANCE_KEYS) {
          if (!(key in patch)) continue;
          const normalized = normalizeAppearanceValue(key, patch[key]);
          if (normalized === undefined) continue;
          (next as Record<AppearanceKey, string | number | boolean>)[key] =
            normalized;
        }
        await bb.storage.kv.set(APPEARANCE_KV_KEY, next);
        return next;
      });
    },
  };
}
