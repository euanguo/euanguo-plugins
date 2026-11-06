/**
 * Features over RPC.
 *
 * Two rules this file exists to keep.
 *
 * Creating a feature and filing a workspace under one are different writes.
 * A feature is named once; a label moves around as work moves. Keeping them in
 * separate methods keeps the id stable while the name and membership change.
 *
 * Every write publishes a channel, because the tree on another client has no
 * other way to learn that a feature appeared or a label moved. Publishing is
 * done here rather than in the store: the store is called from the agent action
 * layer too, and a store that published would fire twice for one click.
 */

import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";

import type { nestRpcContract } from "../contract.ts";
import type { createFeatureStore } from "../../lib/feature-store.ts";
import {
  featureIdFrom,
  featureNameIntent,
  type Feature,
} from "../../lib/features.ts";
import type { createGroupStore } from "../../lib/group-store.ts";
import { FEATURE_CHANNEL } from "../../lib/realtime-channels.ts";

type Handlers<Method extends keyof typeof nestRpcContract> = Pick<
  PluginRpcHandlers<typeof nestRpcContract>,
  Method
>;

export interface FeatureHandlerDeps {
  readonly bb: BbPluginApi;
  readonly features: ReturnType<typeof createFeatureStore>;
  readonly groups: ReturnType<typeof createGroupStore>;
}

export function featureHandlers(
  deps: FeatureHandlerDeps,
): Handlers<
  | "listFeatures"
  | "createFeature"
  | "renameFeature"
  | "setFeatureState"
  | "setFeatureGroup"
  | "deleteFeature"
  | "setWorkspaceFeature"
> {
  const { bb, features, groups } = deps;
  const publish = () => bb.realtime.publish(FEATURE_CHANNEL, {});
  const knownGroupIds = () => new Set(groups.list().map((group) => group.id));

  return {
    async listFeatures() {
      return { features: features.list(), labels: features.labels() };
    },

    async createFeature({ name, groupId }) {
      const stored = featureNameIntent(name);
      if (stored === null) return { feature: null };
      if (groupId !== null && !knownGroupIds().has(groupId)) {
        return { feature: null };
      }
      const taken = new Set(features.list().map((feature) => feature.id));
      const feature: Feature | null = features.create({
        id: featureIdFrom(stored, taken),
        name: stored,
        groupId,
      });
      if (feature !== null) publish();
      return { feature };
    },

    async renameFeature({ featureId, name }) {
      const ok = features.rename(featureId, name);
      if (ok) publish();
      return { ok };
    },

    async setFeatureState({ featureId, state }) {
      const ok = features.setState(featureId, state);
      if (ok) publish();
      return { ok };
    },

    async setFeatureGroup({ featureId, groupId }) {
      if (groupId !== null && !knownGroupIds().has(groupId)) return { ok: false };
      const ok = features.setGroup(featureId, groupId);
      if (ok) publish();
      return { ok };
    },

    async deleteFeature({ featureId }) {
      const ok = features.remove(featureId);
      if (ok) publish();
      return { ok };
    },

    async setWorkspaceFeature({ environmentId, featureId }) {
      const ok = features.label(environmentId, featureId);
      if (ok) publish();
      return { ok };
    },
  };
}
