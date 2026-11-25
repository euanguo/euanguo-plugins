/**
 * Features on the server: thin composition over refresh, provision, removal,
 * metadata, and branch-rename helpers.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { renderFeatureSummary } from "../../lib/domain/feature-context.ts";
import {
  featureBranch,
  featureForPath,
  isFeatureRoot,
  type Feature,
  type FeatureMember,
} from "../../lib/domain/features.ts";
import { FEATURE_CHANNEL } from "../../lib/realtime-channels.ts";
import type { FeatureMetaStore } from "../../lib/stores/feature-meta-store.ts";
import type { FeatureRepository } from "../../lib/stores/feature-repository.ts";
import type { FeatureStore } from "../../lib/stores/feature-store.ts";
import { renameFeatureMemberBranch } from "./branch-rename.ts";
import { createFeatureContainers, type HostCall } from "./containers.ts";
import { createFeatureMetaService } from "./meta-service.ts";
import { createFeatureProvisioner } from "./provision.ts";
import { createFeatureRefresher } from "./refresh.ts";
import { createFeatureRemoval } from "./removal.ts";
import { messageOf } from "./removal-ops.ts";
import {
  FeatureError,
  PROBE_TIMEOUT_MS,
  type FeatureHost,
  type FeatureServiceCore,
  type FeatureSnapshot,
} from "./types.ts";

export type {
  FeatureHost,
  FeatureSnapshot,
  RepositoryResult,
} from "./types.ts";
export { FeatureError } from "./types.ts";

export function createFeatureService(input: {
  readonly bb: BbPluginApi;
  readonly store: FeatureStore;
  readonly metaStore: FeatureMetaStore;
  readonly repository: FeatureRepository;
  readonly host: FeatureHost;
  readonly projectSource: (
    projectId: string,
  ) => Promise<{ path: string; hostId: string } | null>;
}) {
  const { bb, store, metaStore, repository, host, projectSource } = input;
  const publish = () => bb.realtime.publish(FEATURE_CHANNEL, {});

  let cached: FeatureSnapshot = {
    features: store.list(),
    adoptions: store.adoptions(),
    members: [],
    homeProjects: {},
    featureProjectIds: [],
    memberScanFailures: [],
    meta: {},
  };

  const homes = new Map<string, string>();
  const contextWritten = new Set<string>();
  const contextInFlight = new Map<string, Promise<boolean>>();

  const call: HostCall = async (method, payload, hostId, timeoutMs) =>
    (await host.call(method, payload, { hostId, timeoutMs })) as never;

  const homeOf = async (hostId: string): Promise<string> => {
    const known = homes.get(hostId);
    if (known !== undefined) return known;
    const answer = await call<{ home: string }>(
      "readHomeDirectory",
      {},
      hostId,
      PROBE_TIMEOUT_MS,
    );
    const home = answer.home.replace(/[\\/]+$/u, "");
    homes.set(hostId, home);
    return home;
  };

  const ensureDirectory = async (path: string, hostId: string) => {
    const answer = await call<
      { status: "ok" } | { status: "failed"; message: string }
    >("ensureFeatureDirectory", { path }, hostId, PROBE_TIMEOUT_MS);
    if (answer.status === "failed") {
      throw new FeatureError(answer.message, "unavailable");
    }
  };

  const { featuresFolderOf, homeProjectOf } = createFeatureContainers({
    bb,
    store,
    call,
    homeOf,
    ensureDirectory,
    timeoutMs: PROBE_TIMEOUT_MS,
  });

  const pickHost = async (projectIds: readonly string[]): Promise<string> => {
    for (const projectId of projectIds) {
      const source = await projectSource(projectId).catch(() => null);
      if (source !== null) return source.hostId;
    }
    const existing = store.list().find((feature) => feature.hostId !== null)?.hostId;
    if (existing !== undefined && existing !== null) return existing;
    const hosts = await bb.sdk.hosts.list();
    const connected = hosts.find((candidate) => candidate.status === "connected");
    if (connected === undefined) {
      throw new FeatureError("No machine is connected.", "unavailable");
    }
    return connected.id;
  };

  const performWriteContext = async (
    feature: Feature,
    members: readonly FeatureMember[],
  ): Promise<boolean> => {
    if (feature.rootPath === null || feature.hostId === null) return false;
    const answer = await call<
      { status: "ok" } | { status: "failed"; message: string }
    >(
      "writeFeatureContext",
      {
        featureDirectory: feature.rootPath,
        id: feature.id,
        name: feature.name,
        slug: feature.slug,
        suggestedBranch: featureBranch(feature.slug),
        summary: renderFeatureSummary(metaStore.meta(feature.id)),
        members: members.map((member) => ({
          directory: member.directory,
          repository: member.repository,
          branch: member.branch,
          path: member.path,
        })),
      },
      feature.hostId,
      PROBE_TIMEOUT_MS,
    ).catch((error: unknown) => ({
      status: "failed" as const,
      message: messageOf(error),
    }));
    if (answer.status === "failed") {
      bb.log.warn(
        `could not write the context files of ${feature.slug}: ${answer.message}`,
      );
      return false;
    }
    contextWritten.add(feature.id);
    return true;
  };

  const writeContext = (
    feature: Feature,
    members: readonly FeatureMember[],
  ): Promise<boolean> => {
    const running = contextInFlight.get(feature.id);
    if (running !== undefined) return running;
    const active = performWriteContext(feature, members).finally(() => {
      if (contextInFlight.get(feature.id) === active) {
        contextInFlight.delete(feature.id);
      }
    });
    contextInFlight.set(feature.id, active);
    return active;
  };

  const membersOf = (featureId: string) =>
    cached.members.filter((member) => member.featureId === featureId);

  const requireFeature = (featureId: string): Feature => {
    const feature = store.find(featureId);
    if (feature === undefined) {
      throw new FeatureError("That feature no longer exists.", "not-found");
    }
    return feature;
  };

  const core: FeatureServiceCore = {
    bb,
    store,
    metaStore,
    repository,
    projectSource,
    call,
    publish,
    getCached: () => cached,
    setCached: (next) => {
      cached = next;
    },
    membersOf,
    requireFeature,
    writeContext,
    homeOf,
    ensureDirectory,
    featuresFolderOf,
    homeProjectOf,
    pickHost,
  };

  const { refresh, syncContextFiles } = createFeatureRefresher({
    core,
    contextWritten,
  });
  const provisioner = createFeatureProvisioner({ core, refresh });
  const removal = createFeatureRemoval({ core, refresh });
  const metaService = createFeatureMetaService({
    metaStore,
    findFeature: (featureId) => store.find(featureId),
    membersOf,
    writeContext,
    publish,
    setSummary: (featureId, summary) => {
      cached = { ...cached, meta: { ...cached.meta, [featureId]: summary } };
    },
  });

  /**
   * Prime the snapshot at startup and bring active context files up to date.
   */
  const prime = async (attempts: number): Promise<void> => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      const snapshot = await refresh().catch(() => null);
      if (snapshot === null) continue;
      await syncContextFiles();
      if (
        snapshot.features.every(
          (feature) =>
            feature.state !== "active" || contextWritten.has(feature.id),
        )
      ) {
        return;
      }
    }
  };

  return {
    snapshot: () => cached,
    refresh,
    syncContextFiles,
    prime,
    create: provisioner.create,
    plan: provisioner.plan,
    addRepositories: provisioner.addRepositories,
    survey: removal.survey,
    finish: removal.finish,
    reopen: removal.reopen,
    remove: removal.remove,
    removeRepository: removal.removeRepository,
    renameMemberBranch: (args: {
      featureId: string;
      directory: string;
      branch: string;
    }) =>
      renameFeatureMemberBranch(
        {
          store,
          call,
          requireFeature,
          membersOf,
          refresh,
          writeContext,
          publish,
          timeoutMs: PROBE_TIMEOUT_MS,
        },
        args,
      ),
    createdBranchCount: (featureId: string) => store.branches(featureId).length,
    rename: async (featureId: string, name: string) => {
      const ok = store.rename(featureId, name);
      if (!ok) return false;
      await refresh();
      const feature = store.find(featureId);
      if (feature !== undefined) await writeContext(feature, membersOf(featureId));
      publish();
      return true;
    },
    adopt: (environmentId: string, featureId: string | null) => {
      const ok = store.adopt(environmentId, featureId);
      if (ok) {
        cached = { ...cached, adoptions: store.adoptions() };
        publish();
      }
      return ok;
    },
    ...metaService,
    locate: (path: string | null) => {
      const feature = featureForPath(
        cached.features.filter((candidate) => candidate.state === "active"),
        path,
      );
      if (feature === null) return null;
      return {
        feature,
        members: membersOf(feature.id),
        inRoot: isFeatureRoot(feature, path),
      };
    },
  };
}

export type FeatureService = ReturnType<typeof createFeatureService>;
