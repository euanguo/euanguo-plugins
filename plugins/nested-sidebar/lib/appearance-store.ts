/**
 * Where the appearance settings live: one kv row.
 *
 * `bb.storage.kv` rather than a table of this plugin's own. The values are a
 * flat record of primitives that is read and written whole, which is what kv
 * is for; a table would buy nothing and cost a migration. The record is a few
 * hundred bytes against a 256KB cap.
 *
 * There is deliberately no migration from the descriptors these used to be.
 * `bb.settings.get()` answers only for keys the handle still declares, so
 * removing a descriptor makes its stored value unreachable from the plugin —
 * a migration here could only ever find nothing and then report success. The
 * move is therefore a one-time reset to the defaults, which are the values the
 * descriptors declared anyway; a user who had changed one sets it once more.
 */

import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  APPEARANCE_KV_KEY,
  APPEARANCE_KEYS,
  resolveAppearance,
  validAppearanceValue,
  type AppearanceKey,
  type AppearanceValues,
} from "./appearance.ts";

export interface AppearanceStore {
  get(): Promise<AppearanceValues>;
  /**
   * Write the keys present in `patch`; a value that fails validation is
   * dropped rather than written. Returns the record as it now stands.
   */
  set(patch: Partial<Record<AppearanceKey, unknown>>): Promise<AppearanceValues>;
}

export function createAppearanceStore(bb: BbPluginApi): AppearanceStore {
  const read = async () => resolveAppearance(await bb.storage.kv.get(APPEARANCE_KV_KEY));

  return {
    get: read,

    async set(patch) {
      const current = await bb.storage.kv.get(APPEARANCE_KV_KEY);
      const next = resolveAppearance(current);
      for (const [key, value] of Object.entries(patch)) {
        if (!(key in next)) continue;
        const typed = key as AppearanceKey;
        if (value === undefined || !validAppearanceValue(typed, value)) continue;
        (next as Record<string, unknown>)[typed] = value;
      }
      await bb.storage.kv.set(APPEARANCE_KV_KEY, next);
      return next;
    },
  };
}
