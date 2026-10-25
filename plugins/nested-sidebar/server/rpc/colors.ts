/**
 * Project colours, as the sidebar's own store holds them.
 *
 * A colour is per-project decoration this plugin owns — bb has no opinion about
 * it — so the whole surface is three calls against one table, and the publish
 * after each write is what makes a second window repaint.
 */
import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import type { nestRpcContract } from "../contract.ts";

/** This module's slice of the contract, with every other method omitted. */
type Handlers<Method extends keyof typeof nestRpcContract> = Pick<
  PluginRpcHandlers<typeof nestRpcContract>,
  Method
>;
import { PROJECT_COLOR_CHANNEL } from "../../lib/realtime-channels.ts";
import type { createProjectColorStore } from "../../lib/project-color-store.ts";

export function projectColorHandlers(
  bb: BbPluginApi,
  projectColors: ReturnType<typeof createProjectColorStore>,
): Handlers<"listProjectColors" | "setProjectColor" | "resetProjectColor"> {

  return {
    async listProjectColors() {
      return { colors: projectColors.list() };
    },

    async setProjectColor({ projectId, color }) {
      await bb.sdk.projects.get({ projectId });
      const stored = projectColors.set(projectId, color);
      bb.realtime.publish(PROJECT_COLOR_CHANNEL, { projectId });
      return stored;
    },

    async resetProjectColor({ projectId }) {
      await bb.sdk.projects.get({ projectId });
      const reset = projectColors.reset(projectId);
      bb.realtime.publish(PROJECT_COLOR_CHANNEL, { projectId });
      return { projectId, reset };
    },
  };
}
