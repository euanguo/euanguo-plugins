/**
 * Persistent store for Harbor's single three-tier agent access setting (`agentAccess:v1`).
 *
 * All reads, primes, and writes share one serialized promise chain so rapid
 * consecutive updates never clobber each other, and a synchronous `current()`
 * cache stays coherent for `bb.agents.configure`, `contributeInstructions`, and
 * per-tool runtime gating.
 */

import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  AGENT_ACCESS_KV_KEY,
  DEFAULT_AGENT_ACCESS_TIER,
  decodeAgentAccessTier,
  isAgentAccessTier,
  type AgentAccessTier,
} from "../domain/agent-access.ts";

export interface AgentAccessStore {
  /** Read and decode the persisted tier from KV, refreshing the sync cache. */
  get(): Promise<AgentAccessTier>;
  /** Persist a validated tier to KV and update the sync cache. */
  set(tier: AgentAccessTier): Promise<AgentAccessTier>;
  /** Latest known tier for synchronous host callbacks. */
  current(): AgentAccessTier;
  /** Best-effort startup hydration; never rejects. */
  prime(): Promise<AgentAccessTier>;
}

export function createAgentAccessStore(bb: BbPluginApi): AgentAccessStore {
  let cachedTier: AgentAccessTier = DEFAULT_AGENT_ACCESS_TIER;
  let queue: Promise<void> = Promise.resolve();

  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const readFromKv = async (): Promise<AgentAccessTier> => {
    try {
      const raw = await bb.storage.kv.get(AGENT_ACCESS_KV_KEY);
      const next = decodeAgentAccessTier(raw);
      cachedTier = next;
      return next;
    } catch (error) {
      bb.log?.warn?.(`could not read ${AGENT_ACCESS_KV_KEY}: ${String(error)}`);
      return cachedTier;
    }
  };

  const prime = (): Promise<AgentAccessTier> => enqueue(readFromKv);

  // Hydrate at startup without delaying plugin load.
  void prime();

  return {
    get: () => enqueue(readFromKv),

    set: (tier) => {
      if (!isAgentAccessTier(tier)) {
        return Promise.reject(new RangeError(`Invalid agent access tier: ${String(tier)}`));
      }
      return enqueue(async () => {
        await bb.storage.kv.set(AGENT_ACCESS_KV_KEY, { tier });
        cachedTier = tier;
        return tier;
      });
    },

    current: () => cachedTier,

    prime,
  };
}
