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

import type { FeatureAgentPort } from "../../lib/agent/tools-features.ts";
import type { ThreadSpawnPort } from "../../lib/agent/tools-spawn.ts";
import { normalizeFeaturePath } from "../../lib/domain/features.ts";
import { createFeatureMetaStore } from "../../lib/stores/feature-meta-store.ts";
import { createFeatureRepository } from "../../lib/stores/feature-repository.ts";
import { createFeatureStore } from "../../lib/stores/feature-store.ts";
import { featureHandlers } from "../rpc/features.ts";
import { createFeatureService } from "./service.ts";
import type { FeatureHost } from "./types.ts";

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
  const metaStore = createFeatureMetaStore(db);
  const repository = createFeatureRepository(db, metaStore);
  const service = createFeatureService({
    bb,
    store,
    metaStore,
    repository,
    host: worktreeHost,
    projectSource,
  });

  void service.prime(5);

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
    deleteFeature: (args) => service.remove(args),
    removeRepository: (args) =>
      service.removeRepository({
        featureId: args.featureId,
        directory: args.directory,
        force: args.force,
      }),
    meta: (featureId) => service.meta(featureId),
    addDecision: (args) =>
      service.addDecision({
        ...args,
        status: "draft",
        author: "agent",
      }),
    addRef: (args) => service.addRef(args.featureId, args),
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
    homeProject: async (containerPath) =>
      service.snapshot().homeProjects[normalizeFeaturePath(containerPath)] ?? null,
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
      const first = matches[0];
      return matches.length === 1 && first !== undefined
        ? { id: first.id, name: first.name }
        : null;
    },
    spawn: async (args) => {
      const spawned = await bb.sdk.threads.spawn({
        projectId: args.projectId,
        prompt: args.prompt,
        origin: "plugin",
        ...(args.title === undefined ? {} : { title: args.title }),
        ...(args.parentThreadId === undefined
          ? {}
          : { parentThreadId: args.parentThreadId }),
        ...(args.environment === undefined ? {} : { environment: args.environment }),
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
