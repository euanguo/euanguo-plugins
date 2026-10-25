/**
 * The view preferences the sidebar writes itself.
 *
 * These are `bb.settings`-shaped but stored here, because the frontend can read
 * settings and cannot write them — and a sort lens the user changes from the
 * view menu has to be written by something.
 */
import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import type { nestRpcContract } from "../contract.ts";

/** This module's slice of the contract, with every other method omitted. */
type Handlers<Method extends keyof typeof nestRpcContract> = Pick<
  PluginRpcHandlers<typeof nestRpcContract>,
  Method
>;
import { VIEW_PREFERENCE_CHANNEL } from "../../lib/realtime-channels.ts";
import type { createViewPreferenceStore } from "../../lib/view-preference-store.ts";

export interface PreferenceHandlerDeps {
  readonly bb: BbPluginApi;
  readonly viewPreferences: ReturnType<typeof createViewPreferenceStore>;
}

export function preferenceHandlers(
  deps: PreferenceHandlerDeps,
): Handlers<"getViewPreferences" | "setViewPreferences"> {
  const { bb, viewPreferences } = deps;

  return {
    async getViewPreferences() {
      return viewPreferences.get();
    },

    async setViewPreferences(patch) {
      const next = viewPreferences.set(patch);
      bb.realtime.publish(VIEW_PREFERENCE_CHANNEL, {});
      return next;
    },
  };
}
