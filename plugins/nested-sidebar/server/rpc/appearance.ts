/**
 * Reading and writing the appearance settings from the settings page.
 *
 * One method for each direction, both whole-record, because the record is small
 * and the settings page draws every key at once. A patch is per-toggle, which
 * is what a swatch or a checkbox produces.
 */
import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import type { nestRpcContract } from "../contract.ts";

/** This module's slice of the contract, with every other method omitted. */
type Handlers<Method extends keyof typeof nestRpcContract> = Pick<
  PluginRpcHandlers<typeof nestRpcContract>,
  Method
>;
import { APPEARANCE_CHANNEL } from "../../lib/realtime-channels.ts";
import type { AppearanceStore } from "../../lib/appearance-store.ts";

export interface AppearanceHandlerDeps {
  readonly bb: BbPluginApi;
  readonly appearance: AppearanceStore;
}

export function appearanceHandlers(
  deps: AppearanceHandlerDeps,
): Handlers<"getAppearance" | "setAppearance"> {
  const { bb, appearance } = deps;

  return {
    async getAppearance() {
      return appearance.get();
    },

    /**
     * Writes, then publishes. The caller gets the record back rather than
     * `{ ok }`: a rejected value is dropped, and the answer is what lets the
     * control that offered it show what was actually stored.
     */
    async setAppearance(patch) {
      const next = await appearance.set(patch);
      bb.realtime.publish(APPEARANCE_CHANNEL, {});
      return next;
    },
  };
}
