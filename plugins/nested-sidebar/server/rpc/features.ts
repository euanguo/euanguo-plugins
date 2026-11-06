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
  planFeatureRemoval,
  type FeatureRemovalSurvey,
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
  readonly materialize: {
    plan: (args: {
      featureId: string;
      projectId: string;
    }) => Promise<
      | {
          featureId: string;
          projectId: string;
          repositoryName: string;
          branch: string;
          decision: { status: "create" | "reuse" | "blocked"; reason?: string };
          path: string;
          hostId: string;
        }
      | { error: string }
    >;
    materialize: (args: {
      featureId: string;
      projectId: string;
    }) => Promise<
      | {
          status: "created" | "reused";
          path: string;
          branch: string;
          hostId: string;
          contextWritten: boolean;
        }
      | { status: "blocked"; reason: string }
    >;
  } | null;
  /**
   * Removes one materialized member's directory.
   *
   * Absent in tests that only exercise the store. When present it is called
   * before the row goes, so a delete cannot leave a worktree behind.
   */
  readonly cleanupMembers?: (
    member: { readonly path: string; readonly hostId: string },
  ) => Promise<boolean>;
  /** Removes the feature's own directory once its members are gone. */
  readonly cleanupFeatureRoot?: (featureId: string) => Promise<boolean>;
  /** What each member directory still holds, for the confirmation. */
  readonly inspectWorktrees?: (
    members: readonly { readonly path: string; readonly hostId: string }[],
  ) => Promise<FeatureRemovalSurvey["worktrees"]>;
  /** How many threads run in this feature's workspaces. */
  readonly countThreads?: (featureId: string) => Promise<number>;
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
  | "planFeatureWorkspace"
  | "materializeFeatureWorkspace"
  | "listFeatureMembers"
  | "openFeatureThread"
  | "inspectFeatureRemoval"
> {
  const {
    bb,
    features,
    groups,
    materialize,
    cleanupMembers = null,
    cleanupFeatureRoot = null,
    inspectWorktrees = null,
    countThreads = null,
  } = deps;
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

    async inspectFeatureRemoval({ featureId }) {
      const feature = features.list().find((item) => item.id === featureId);
      if (feature === undefined) {
        throw new Error("Feature not found.");
      }
      const members = features.members(featureId);
      const [worktrees, threadCount] = await Promise.all([
        inspectWorktrees === null
          ? Promise.resolve([])
          : inspectWorktrees(members),
        countThreads === null ? Promise.resolve(0) : countThreads(featureId),
      ]);
      const plan = planFeatureRemoval({ worktrees, threadCount });
      return {
        featureName: feature.name,
        worktrees: [...worktrees],
        threadCount,
        warnings: [...plan.warnings],
        requiresConfirmation: plan.requiresConfirmation,
      };
    },

    async deleteFeature({ featureId, acknowledged = false }) {
      /**
       * The survey is repeated here rather than trusted from the dialog. A
       * client that opened the dialog an hour ago, or a second client, would
       * otherwise be able to delete work it never showed anyone.
       */
      const members = features.members(featureId);
      const [worktrees, threadCount] = await Promise.all([
        inspectWorktrees === null
          ? Promise.resolve([])
          : inspectWorktrees(members),
        countThreads === null ? Promise.resolve(0) : countThreads(featureId),
      ]);
      const plan = planFeatureRemoval({ worktrees, threadCount });
      if (plan.requiresConfirmation && !acknowledged) {
        throw new Error(
          `This feature still holds work: ${plan.warnings.join("; ")}.`,
        );
      }
      /**
       * A feature's members are directories this plugin created, so deleting
       * the row and leaving them behind would be the same bug as deleting a
       * worktree row without removing its worktree. Each one is removed through
       * git when it can be, and reported when it cannot.
       */
      const cleanup =
        cleanupMembers === null
          ? []
          : await Promise.all(
              members.map((member) =>
                cleanupMembers(member).catch(() => false),
              ),
            );
      /**
       * The root is taken back before the row goes, because the row is where
       * its path is stored. Removing it first would leave the plugin unable to
       * name the directory it just orphaned.
       */
      const rootCleared =
        cleanupFeatureRoot === null
          ? false
          : await cleanupFeatureRoot(featureId).catch(() => false);
      const ok = features.remove(featureId);
      if (ok) publish();
      return {
        ok,
        removedDirectories: cleanup.filter(Boolean).length,
        leftoverDirectories: cleanup.filter((removed) => !removed).length,
        removedFeatureDirectory: rootCleared,
      };
    },

    async setWorkspaceFeature({ environmentId, featureId }) {
      const ok = features.label(environmentId, featureId);
      if (ok) publish();
      return { ok };
    },

    async planFeatureWorkspace({ featureId, projectId }) {
      if (materialize === null) {
        return { plan: null, error: "物化功能不可用。" };
      }
      const planned = await materialize.plan({ featureId, projectId });
      if ("error" in planned) return { plan: null, error: planned.error };
      return {
        plan: {
          featureId: planned.featureId,
          projectId: planned.projectId,
          repositoryName: planned.repositoryName,
          branch: planned.branch,
          path: planned.path,
          hostId: planned.hostId,
          outcome: planned.decision.status,
          reason:
            planned.decision.status === "blocked"
              ? (planned.decision.reason ?? null)
              : null,
        },
        error: null,
      };
    },

    async materializeFeatureWorkspace({ featureId, projectId }) {
      if (materialize === null) {
        return {
          outcome: "blocked" as const,
          path: null,
          branch: null,
          reason: "物化功能不可用。",
        };
      }
      const result = await materialize.materialize({ featureId, projectId });
      if (result.status === "blocked") {
        return {
          outcome: "blocked" as const,
          path: null,
          branch: null,
          reason: result.reason,
        };
      }
      publish();
      return {
        outcome: result.status,
        path: result.path,
        branch: result.branch,
        reason: null,
      };
    },

    async listFeatureMembers({ featureId }) {
      return { members: features.members(featureId) };
    },

    async openFeatureThread({ featureId, projectId }) {
      const feature = features.list().find((item) => item.id === featureId);
      if (feature === undefined) {
        return { threadId: null, reason: "功能不存在。" };
      }
      if (feature.rootPath === null) {
        return {
          threadId: null,
          reason: "这个功能还没有目录，先添加一个仓库。",
        };
      }
      /**
       * The directory is the environment. bb registers an unmanaged workspace
       * for a path it has not seen, which is what a feature directory is: a
       * directory holding several worktrees and owned by no single repository.
       */
      const spawned = await bb.sdk.threads.spawn({
        projectId,
        /**
         * An unmanaged workspace at the feature directory.
         *
         * bb's `environment` union has no path variant; a directory it did not
         * create is a `host` environment whose workspace is `unmanaged`. bb
         * registers the environment from that path, which is exactly what a
         * feature directory is.
         */
        environment: {
          type: "host",
          ...(feature.hostId === null ? {} : { hostId: feature.hostId }),
          workspace: { type: "unmanaged", path: feature.rootPath },
        },
        title: feature.name,
        prompt: featurePrompt(feature.name, features.members(featureId)),
        origin: "app",
      } as unknown as Parameters<typeof bb.sdk.threads.spawn>[0]);
      return { threadId: spawned.id ?? null, reason: null };
    },
  };
}

/**
 * What the root conversation opens with.
 *
 * Short on purpose. The directory already carries `NEST.md` and
 * `.nest-feature.json`, so the prompt points at them and states the one rule
 * the directory cannot enforce itself: name the subdirectory in every git
 * command, because the feature directory is not a repository.
 */
function featurePrompt(
  name: string,
  members: readonly {
    readonly directory: string;
    readonly repository: string;
    readonly branch: string;
  }[],
): string {
  const rows = members
    .map(
      (member) =>
        `- ${member.directory} (${member.repository}, ${member.branch})`,
    )
    .join("\n");
  return [
    `This directory is the "${name}" feature. It spans ${members.length} repositories.`,
    "",
    "Read NEST.md and .nest-feature.json before acting.",
    "",
    rows,
    "",
    "Run git as `git -C <directory> ...`. The feature directory itself is not a",
    "repository, and `git add -A` here would either fail or reach a repository you",
    "did not mean to touch.",
  ].join("\n");
}
