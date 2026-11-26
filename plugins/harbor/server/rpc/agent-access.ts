/**
 * Reading and writing Harbor's three-tier agent access mode (`off` | `read-only` | `full`).
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { AGENT_ACCESS_CHANNEL } from "../../lib/domain/agent-access.ts";
import type { AgentAccessStore } from "../../lib/stores/agent-access-store.ts";
import type { HarborRpcHandlers } from "../contract.ts";

export interface AgentAccessHandlerDeps {
  readonly bb: BbPluginApi;
  readonly agentAccess: AgentAccessStore;
}

export function agentAccessHandlers(
  deps: AgentAccessHandlerDeps,
): HarborRpcHandlers<"getAgentAccess" | "setAgentAccess"> {
  const { bb, agentAccess } = deps;

  return {
    async getAgentAccess() {
      return { tier: await agentAccess.get() };
    },

    async setAgentAccess({ tier }) {
      const next = await agentAccess.set(tier);
      bb.realtime.publish(AGENT_ACCESS_CHANNEL, { tier: next });
      bb.rpc?.experimental_invalidate?.(["agentAccess"]);
      return { tier: next };
    },
  };
}
