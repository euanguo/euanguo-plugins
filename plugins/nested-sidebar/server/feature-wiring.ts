/**
 * The feature half of the server's assembly, in one place.
 *
 * Features need a store, a host client and the project-source lookup, and the
 * agent tools need the same service the RPC uses. Keeping the assembly here
 * keeps the entry point about what it is for: the order things are created and
 * the one call that registers them.
 */

import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";

import type { FeatureAgentPort } from "../lib/agent/tools-features.ts";
import type { ThreadSpawnPort } from "../lib/agent/tools-spawn.ts";
import { createFeatureStore } from "../lib/feature-store.ts";
import { createFeatureService, type FeatureHost } from "./feature-service.ts";
import { featureHandlers } from "./rpc/features.ts";

export { FEATURE_MIGRATIONS } from "../lib/feature-store.ts";

export function wireFeatures(input: {
  readonly db: Database.Database;
  readonly bb: BbPluginApi;
  readonly worktreeHost: FeatureHost;
  readonly projectSource: (
    projectId: string,
  ) => Promise<{ path: string; hostId: string } | null>;
}) {
  const { db, bb, worktreeHost, projectSource } = input;
  const store = createFeatureStore(db);
  const service = createFeatureService({
    bb,
    store,
    host: worktreeHost,
    projectSource,
  });

  /**
   * Prime the in-memory snapshot the thread-start hook reads.
   *
   * Not awaited: it is a round trip to every machine holding a feature folder,
   * and host calls are refused while the plugin is still registering, so it
   * retries. Until it lands the hook still knows every feature's folder from the
   * store, which is enough to tell a thread where it is; only the member list
   * is missing.
   */
  void service.prime(5);

  /**
   * What the agent tools reach. The thread's own path is read from bb on each
   * call, because the tool context names the thread and not where it runs.
   */
  const agentPort: FeatureAgentPort = {
    locate: service.locate,
    features: () => service.snapshot().features,
    membersOf: (featureId) =>
      service.snapshot().members.filter((member) => member.featureId === featureId),
    threadPath: async (threadId) => {
      const thread = await bb.sdk.threads.get({ threadId });
      const environmentId = "environmentId" in thread ? thread.environmentId : null;
      if (typeof environmentId !== "string") return null;
      const environment = await bb.sdk.environments.get({ environmentId });
      return environment.path ?? null;
    },
    projects: async () =>
      (await bb.sdk.projects.list({})).map((project) => ({ id: project.id, name: project.name })),
    refresh: service.refresh,
    create: ({ name, repositories }) =>
      service.create({
        name,
        repositories: repositories.map((projectId) => ({ projectId, branch: null })),
      }),
    addRepositories: service.addRepositories,
    rename: service.rename,
    reopen: (featureId) => service.reopen(featureId),
    adopt: async (environmentId, featureId) => service.adopt(environmentId, featureId),
    deleteFeature: (input) => service.remove(input),
    removeRepository: (input) =>
      service.removeRepository({
        featureId: input.featureId,
        directory: input.directory,
        force: input.force,
      }),
  };

  const spawnPort: ThreadSpawnPort = {
    locate: agentPort.locate,
    threadPath: agentPort.threadPath,
    environment: async (environmentId) => {
      const environment = await bb.sdk.environments.get({ environmentId });
      return {
        path: environment.path ?? null,
        projectId: environment.projectId,
        hostId: environment.hostId,
      };
    },
    homeProject: async (hostId) => service.snapshot().homeProjects[hostId] ?? null,
    resolveProject: async (nameOrId) => {
      const projects = await bb.sdk.projects.list({});
      const needle = nameOrId.trim().toLowerCase();
      const exact = projects.filter(
        (project) => project.id === nameOrId || project.name.toLowerCase() === needle,
      );
      const matches =
        exact.length > 0
          ? exact
          : projects.filter((project) => project.name.toLowerCase().includes(needle));
      return matches.length === 1
        ? { id: matches[0]!.id, name: matches[0]!.name }
        : null;
    },
    spawn: async (input) => {
      const spawned = await bb.sdk.threads.spawn({
        projectId: input.projectId,
        prompt: input.prompt,
        origin: "plugin",
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.parentThreadId === undefined
          ? {}
          : { parentThreadId: input.parentThreadId }),
        ...(input.environment === undefined ? {} : { environment: input.environment }),
      } as Parameters<typeof bb.sdk.threads.spawn>[0]);
      return spawned.id ?? null;
    },
  };

  return {
    store,
    service,
    agentPort,
    spawnPort,
    handlers: featureHandlers({ service }),
  };
}
